-- ============================================================================
-- Marketplace v1 — SQL для Supabase (выполнить в SQL editor).
-- Добавляет: таблицу эксклюзивов, защиту от повторов покупок и колонку kind в sell_requests.
-- Все таблицы с RLS. Чтение публичное; запись — только сервис-роль (edge fn) или админ.
-- ============================================================================

-- Кошелёк-админ (тот же, что в App.tsx ADMIN_WALLET / sell-payout ADMIN):
--   EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk

-- 1) Эксклюзивные лоты от казны (лимитированный тираж) ------------------------
create table if not exists public.exclusives (
  id         text primary key,
  species    text not null,
  name       text,
  price      numeric not null,          -- цена в SOL
  stock      int not null default 1,    -- остаток
  sold       int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.exclusives enable row level security;

-- читать могут все
drop policy if exists exclusives_read on public.exclusives;
create policy exclusives_read on public.exclusives for select using (true);

-- писать/менять/удалять — только админ (его wallet-claim в JWT)
drop policy if exists exclusives_admin_write on public.exclusives;
create policy exclusives_admin_write on public.exclusives
  for all to authenticated
  using ((auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk')
  with check ((auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');

-- 2) Защита от повторной обработки покупок на маркете ------------------------
create table if not exists public.market_purchases (
  signature  text primary key,          -- подпись tx (уникальна → защита от повторов)
  buyer      text not null,
  kind       text not null,             -- 'sale' | 'exclusive'
  ref_id     text not null,             -- id лота / эксклюзива
  seller     text,
  lamports   bigint,
  created_at timestamptz not null default now()
);
alter table public.market_purchases enable row level security;
-- политик нет → доступ только у сервис-роли (edge function market-buy)

-- 3) Продажи петов идут в общую очередь выплат sell_requests ------------------
alter table public.sell_requests add column if not exists kind text not null default 'sell';
-- значения: 'sell' (продажа PV → SOL) | 'market' (продажа пета между игроками)

-- 4) Атомарная покупка эксклюзива: один UPDATE уменьшает сток (WHERE stock>0) — защита от оверселла
--    при двух одновременных покупателях. Пустой результат = распродан. Вызывается edge-функцией market-buy.
create or replace function public.buy_exclusive(p_id text)
returns setof public.exclusives
language sql
as $$
  update public.exclusives
     set stock = stock - 1,
         sold = sold + 1,
         active = (stock - 1) > 0
   where id = p_id and active = true and stock > 0
  returning *;
$$;

-- 5) Заявки на награды за квесты. Игрок создаёт свою заявку (wallet=свой), админ видит все и
--    отмечает paid (SOL отправляет вручную). unique(wallet, quest_id) → один квест нельзя забрать дважды.
create table if not exists public.quest_claims (
  id         text primary key,
  wallet     text not null,
  quest_id   text not null,
  status     text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (wallet, quest_id)
);
alter table public.quest_claims enable row level security;

-- читать: свои — игрок, все — админ
drop policy if exists quest_claims_read on public.quest_claims;
create policy quest_claims_read on public.quest_claims
  for select to authenticated
  using ((auth.jwt() ->> 'wallet') = wallet
      or (auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');

-- создавать: только свою заявку (wallet = свой claim в JWT)
drop policy if exists quest_claims_insert on public.quest_claims;
create policy quest_claims_insert on public.quest_claims
  for insert to authenticated
  with check ((auth.jwt() ->> 'wallet') = wallet);

-- менять статус (mark paid): только админ
drop policy if exists quest_claims_admin_update on public.quest_claims;
create policy quest_claims_admin_update on public.quest_claims
  for update to authenticated
  using ((auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk')
  with check ((auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');
