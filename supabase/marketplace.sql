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

-- ============================================================================
-- Point E · Phase 1 — server-authoritative PV balance.
-- balances = единственный источник правды по PV. Пишет ТОЛЬКО сервис-роль (edge fn pv/sell/buy).
-- Клиент только читает свою строку; saves.data.coins больше не является авторитетным.
-- ============================================================================
create table if not exists public.balances (
  wallet          text primary key,
  coins           numeric not null default 0,
  last_daily      bigint not null default 0,  -- ms epoch последней выдачи дейли
  last_collect    bigint not null default 0,  -- ms epoch последнего начисления пассива
  last_run_reward bigint not null default 0,  -- ms epoch последней награды за топ лидерборда
  battle_day      bigint not null default 0,  -- номер суток (floor(ms/86400000)) для дневного кэпа арены
  battle_gain     numeric not null default 0, -- сколько PV выиграно на арене за текущие сутки
  updated_at      timestamptz not null default now()
);
alter table public.balances enable row level security;

-- читать: свой баланс — игрок, все — админ. ЗАПИСИ через RLS нет → только сервис-роль (edge fns).
drop policy if exists balances_read on public.balances;
create policy balances_read on public.balances
  for select to authenticated
  using ((auth.jwt() ->> 'wallet') = wallet
      or (auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');

-- РАЗОВЫЙ бэкфилл: перенести текущий баланс из сейвов (выполнить ОДИН раз перед переключением sell/buy).
insert into public.balances (wallet, coins, last_collect, updated_at)
select wallet, floor(coalesce((data->>'coins')::numeric, 0)), (extract(epoch from now()) * 1000)::bigint, now()
from public.saves
on conflict (wallet) do nothing;

-- ============================================================================
-- Point E · Phase 1 hardening — АТОМАРНЫЕ мутации баланса (защита от гонок read-modify-write).
-- Условие проверяется ВНУТРИ одного UPDATE → параллельные запросы не могут задвоить начисление
-- (дейли/пассив/бой) или уйти в минус (spend/рулетка). Вызываются ТОЛЬКО edge-функцией pv через
-- service_role (execute отозван у public). Возврат numeric = новый баланс; NULL = условие не выполнено.
-- ============================================================================

-- Пассив: начислить за прошедшее время (капнуто), атомарно сдвинуть last_collect.
create or replace function public.pv_collect(p_wallet text, p_rate numeric, p_cap_ms bigint, p_now bigint)
returns numeric language sql as $$
  update public.balances
     set coins = coins + floor(least(greatest(p_now - last_collect, 0), p_cap_ms) / 60000.0 * p_rate),
         last_collect = p_now, updated_at = now()
   where wallet = p_wallet
  returning coins;
$$;

-- Дейли: начислить только если кулдаун прошёл (иначе 0 строк → NULL).
create or replace function public.pv_daily(p_wallet text, p_reward numeric, p_cooldown bigint, p_now bigint)
returns numeric language sql as $$
  update public.balances set coins = coins + p_reward, last_daily = p_now, updated_at = now()
   where wallet = p_wallet and (p_now - last_daily) >= p_cooldown
  returning coins;
$$;

-- Трата: списать только если хватает баланса (иначе NULL). Без гонки овердрафта.
create or replace function public.pv_spend(p_wallet text, p_amount numeric)
returns numeric language sql as $$
  update public.balances set coins = coins - p_amount, updated_at = now()
   where wallet = p_wallet and coins >= p_amount
  returning coins;
$$;

-- Универсальный: прибавить delta при условии coins ≥ min (рулетка: min=ставка, delta=выигрыш−ставка).
create or replace function public.pv_add_checked(p_wallet text, p_delta numeric, p_min numeric)
returns numeric language sql as $$
  update public.balances set coins = coins + p_delta, updated_at = now()
   where wallet = p_wallet and coins >= p_min
  returning coins;
$$;

-- Арена: атомарно с дневным кэпом выигрыша (сброс на новых сутках). won доверяем (Phase 1), но капнуто.
create or replace function public.pv_battle(p_wallet text, p_won boolean, p_stake numeric, p_reward numeric, p_day bigint, p_max numeric)
returns numeric language plpgsql as $$
declare c numeric; g numeric; credit numeric;
begin
  select case when battle_day = p_day then battle_gain else 0 end into g
    from public.balances where wallet = p_wallet for update;
  if g is null then return null; end if;
  if p_won then
    credit := least(p_reward + p_stake, greatest(p_max - g, 0));
    update public.balances set coins = coins + credit, battle_gain = g + credit, battle_day = p_day, updated_at = now()
     where wallet = p_wallet returning coins into c;
  else
    update public.balances set coins = greatest(coins - p_stake, 0), battle_gain = g, battle_day = p_day, updated_at = now()
     where wallet = p_wallet returning coins into c;
  end if;
  return c;
end $$;

-- Награда за топ лидерборда: начислить только если кулдаун прошёл (ранг считает edge из scores).
create or replace function public.pv_run_reward(p_wallet text, p_reward numeric, p_cooldown bigint, p_now bigint)
returns numeric language sql as $$
  update public.balances set coins = coins + p_reward, last_run_reward = p_now, updated_at = now()
   where wallet = p_wallet and (p_now - last_run_reward) >= p_cooldown
  returning coins;
$$;

-- Вызывать эти функции может ТОЛЬКО сервис-роль (edge fn pv). Игрокам — запрещено (defense-in-depth;
-- к тому же RLS balances и так без права записи для authenticated).
revoke execute on function public.pv_collect(text,numeric,bigint,bigint) from public;
revoke execute on function public.pv_daily(text,numeric,bigint,bigint) from public;
revoke execute on function public.pv_spend(text,numeric) from public;
revoke execute on function public.pv_add_checked(text,numeric,numeric) from public;
revoke execute on function public.pv_battle(text,boolean,numeric,numeric,bigint,numeric) from public;
revoke execute on function public.pv_run_reward(text,numeric,bigint,bigint) from public;
grant execute on function public.pv_collect(text,numeric,bigint,bigint) to service_role;
grant execute on function public.pv_daily(text,numeric,bigint,bigint) to service_role;
grant execute on function public.pv_spend(text,numeric) to service_role;
grant execute on function public.pv_add_checked(text,numeric,numeric) to service_role;
grant execute on function public.pv_battle(text,boolean,numeric,numeric,bigint,numeric) to service_role;
grant execute on function public.pv_run_reward(text,numeric,bigint,bigint) to service_role;

-- ============================================================================
-- Phase 2 — SERVER-AUTHORITATIVE PET OWNERSHIP (последний блокер для mainnet).
-- pet_ledger = единственный источник правды: КТО каким видом владеет. Пишет ТОЛЬКО сервис-роль
-- (edge fn pets/market-buy). Клиент только читает свою строку. saves.data.ownedSpecies больше
-- не авторитетно (как и coins). Продать пета за SOL можно только если он есть в этой таблице.
-- ============================================================================
create table if not exists public.pet_ledger (
  wallet     text not null,
  species    text not null,
  level      int not null default 1,
  buffs      jsonb not null default '[]'::jsonb,
  name       text,
  source     text not null default 'grant',   -- starter | chest | breed | market | exclusive | backfill
  created_at timestamptz not null default now(),
  primary key (wallet, species)                -- модель игры: один экземпляр на вид у игрока
);
alter table public.pet_ledger enable row level security;

-- читать: свои строки — игрок, все — админ. ЗАПИСИ через RLS нет → только сервис-роль (edge fns).
drop policy if exists pet_ledger_read on public.pet_ledger;
create policy pet_ledger_read on public.pet_ledger
  for select to authenticated
  using ((auth.jwt() ->> 'wallet') = wallet
      or (auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');

-- РАЗОВЫЙ бэкфилл: перенести текущих питомцев из сейвов (доверяем текущему devnet-состоянию ОДИН раз,
-- как бэкфиллу balances в Phase 1). Уровень/баффы активного вида лежат в корне сейва, неактивных — в progress.
insert into public.pet_ledger (wallet, species, level, buffs, name, source)
select s.wallet,
       sp.species,
       greatest(coalesce(
         case when sp.species = s.data->>'species'
              then (s.data->>'level')::int
              else (s.data->'progress'->sp.species->>'level')::int end, 1), 1),
       coalesce(
         case when sp.species = s.data->>'species'
              then s.data->'buffs'
              else s.data->'progress'->sp.species->'buffs' end, '[]'::jsonb),
       s.data->'names'->>sp.species,
       'backfill'
from public.saves s
cross join lateral jsonb_array_elements_text(coalesce(s.data->'ownedSpecies', '[]'::jsonb)) as sp(species)
on conflict (wallet, species) do nothing;

-- Выдать вид игроку, если он им ещё НЕ владеет (идемпотентно). Пусто = уже владеет.
create or replace function public.pet_grant(p_wallet text, p_species text, p_level int, p_buffs jsonb, p_name text, p_source text)
returns setof public.pet_ledger language sql as $$
  insert into public.pet_ledger (wallet, species, level, buffs, name, source)
  values (p_wallet, p_species, greatest(coalesce(p_level, 1), 1), coalesce(p_buffs, '[]'::jsonb), p_name, coalesce(p_source, 'grant'))
  on conflict (wallet, species) do nothing
  returning *;
$$;

-- Атомарно «забрать» вид у игрока (эскроу при выставлении на продажу). Пусто = не владеет/уже забрали.
-- Возвращает строку, чтобы edge fn взял авторитетные данные (или откатил при сбое вставки лота).
create or replace function public.pet_take(p_wallet text, p_species text)
returns setof public.pet_ledger language sql as $$
  delete from public.pet_ledger where wallet = p_wallet and species = p_species returning *;
$$;

-- Вызывать эти функции может ТОЛЬКО сервис-роль (edge fn pets / market-buy). Игрокам — запрещено.
revoke execute on function public.pet_grant(text,text,int,jsonb,text,text) from public;
revoke execute on function public.pet_take(text,text) from public;
grant execute on function public.pet_grant(text,text,int,jsonb,text,text) to service_role;
grant execute on function public.pet_take(text,text) to service_role;

-- Аксессуары, надетые на выставленного пета — уходят покупателю вместе с петом.
alter table public.listings add column if not exists accessories jsonb not null default '[]'::jsonb;

-- Запираем запись в listings: раньше лот создавал/удалял сам клиент (createListing/deleteListing).
-- Теперь лоты пишет ТОЛЬКО сервис-роль (edge fn pets, после проверки pet_take по леджеру). Клиент —
-- только чтение. Имена политик неизвестны (DDL таблицы вне репозитория) → сносим их динамически.
alter table public.listings enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'listings' loop
    execute format('drop policy %I on public.listings', p.policyname);
  end loop;
end $$;
create policy listings_read on public.listings for select using (true);
