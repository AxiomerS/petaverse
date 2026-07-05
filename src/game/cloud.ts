// Облачные сейвы через Supabase (прямые запросы к REST — без тяжёлых библиотек).
// Прогресс питомца хранится по адресу кошелька: таблица public.saves (wallet, data, updated_at).
// Если переменные окружения не заданы — облако выключено, игра работает чисто локально.
import { type SavedPet } from "./save";
import { type BuffKind } from "./buffs";

const RAW_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
// Базовый адрес проекта без лишнего хвоста: убираем завершающие слэши и случайный /rest/v1.
const URL = RAW_URL ? RAW_URL.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "") : undefined;

// Настроено ли облако (заданы ли URL и ключ).
export function isCloudEnabled(): boolean {
  return !!(URL && KEY);
}

// Токен сессии (JWT из auth-функции). Пока его нет — работаем анонимным ключом.
let sessionToken: string | null = null;
export function setSessionToken(t: string | null) { sessionToken = t; }
export function isVerified(): boolean { return !!sessionToken; }

function headers(extra?: Record<string, string>): Record<string, string> {
  return { apikey: KEY!, Authorization: `Bearer ${sessionToken ?? KEY!}`, "Content-Type": "application/json", ...extra };
}

// Подтвердить покупку: серверная функция проверит транзакцию в блокчейне и начислит PV.
// Возвращает новый баланс coins или null.
export async function confirmPurchase(wallet: string, signature: string): Promise<{ coins: number; credited: number } | { error: string }> {
  if (!isCloudEnabled()) return { error: "cloud off" };
  try {
    const res = await fetch(`${URL}/functions/v1/buy`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ wallet, signature }),
    });
    const data = (await res.json().catch(() => ({}))) as { coins?: number; credited?: number; error?: string };
    if (res.ok && typeof data.coins === "number") return { coins: data.coins, credited: data.credited ?? 0 };
    return { error: data.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { error: String(e) };
  }
}

// Запрос на продажу PV → SOL: сервер списывает PV и создаёт заявку (pending). Выплата — после
// ручного подтверждения. Возвращает новый баланс coins и сумму SOL, либо ошибку.
export async function requestSell(pv: number): Promise<{ coins: number; sol: number } | { error: string }> {
  if (!isCloudEnabled()) return { error: "cloud off" };
  try {
    const res = await fetch(`${URL}/functions/v1/sell`, { method: "POST", headers: headers(), body: JSON.stringify({ pv }) });
    const data = (await res.json().catch(() => ({}))) as { coins?: number; sol?: number; error?: string };
    if (res.ok && typeof data.coins === "number") return { coins: data.coins, sol: data.sol ?? 0 };
    return { error: data.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { error: String(e) };
  }
}

// Заявка на продажу (для админ-панели).
export type SellRequest = { id: string; wallet: string; pv: number; sol: number; status: string; sig?: string; kind?: string; created_at?: string };

// Список заявок по статусу (видит свои — обычный игрок; все — админ, по RLS-политике).
export async function fetchSellRequests(status = "pending"): Promise<SellRequest[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/sell_requests?status=eq.${status}&select=*&order=created_at.asc`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as SellRequest[];
  } catch {
    return null;
  }
}

// Застрявшие заявки (сбой выплаты: status error/paying) — для админа, чтобы разобрать/повторить.
export async function fetchStuckSellRequests(): Promise<SellRequest[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/sell_requests?status=in.(error,paying)&select=*&order=created_at.asc`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as SellRequest[];
  } catch {
    return null;
  }
}

// Подтвердить (approve → выплата SOL с казны), отклонить (reject → возврат PV для kind='sell') или
// вернуть застрявшую заявку в очередь (reset → error/paying обратно в pending). Только админ.
export async function payoutSell(id: string, action: "approve" | "reject" | "reset"): Promise<{ ok: true; status: string; sig?: string } | { error: string }> {
  if (!isCloudEnabled()) return { error: "cloud off" };
  try {
    const res = await fetch(`${URL}/functions/v1/sell-payout`, { method: "POST", headers: headers(), body: JSON.stringify({ id, action }) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; sig?: string; error?: string };
    if (res.ok && data.ok) return { ok: true, status: data.status ?? "", sig: data.sig };
    return { error: data.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { error: String(e) };
  }
}

// Верификация кошелька: шлём подпись в Edge Function, получаем JWT. Возвращает токен или null.
export async function signIn(wallet: string, message: string, signatureHex: string): Promise<string | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/functions/v1/auth`, {
      method: "POST",
      headers: { apikey: KEY!, Authorization: `Bearer ${KEY!}`, "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, message, signature: signatureHex }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    if (!data.token) return null;
    setSessionToken(data.token);
    return data.token;
  } catch {
    return null;
  }
}

// Загрузить сейв по адресу кошелька. null — если записи нет или облако выключено/ошибка.
export async function loadCloudSave(wallet: string): Promise<SavedPet | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/saves?wallet=eq.${encodeURIComponent(wallet)}&select=data`, { headers: headers() });
    if (!res.ok) return null;
    const rows = (await res.json()) as { data: SavedPet }[];
    return rows[0]?.data ?? null;
  } catch {
    return null;
  }
}

// Сохранить (upsert) сейв по адресу кошелька. true — если успешно.
export async function saveCloudSave(wallet: string, data: SavedPet): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/saves`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ wallet, data, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ===== Глобальный лидерборд (таблица public.scores) =====
export type ScoreRow = { wallet: string; name: string; score: number };

// Отправить лучший счёт игрока (upsert по адресу). Счёт монотонно растёт → просто перезаписываем.
export async function submitScore(wallet: string, name: string, score: number): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/scores`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ wallet, name, score, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Топ игроков по счёту. null — если облако выключено/ошибка (например, таблицы ещё нет).
export async function fetchTopScores(limit = 20): Promise<ScoreRow[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/scores?select=wallet,name,score&order=score.desc&limit=${limit}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as ScoreRow[];
  } catch {
    return null;
  }
}

// ===== Рейтинг арены (таблица public.arena) =====
export type ArenaRow = { wallet: string; name: string; species: string; power: number; wins: number; losses: number };

// Отправить статистику арены игрока (upsert по адресу).
export async function submitArena(row: ArenaRow): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/arena`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Топ бойцов: сначала по победам, затем по силе. null — если облако выключено/ошибка.
export async function fetchTopArena(limit = 20): Promise<ArenaRow[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/arena?select=wallet,name,species,power,wins,losses&order=wins.desc,power.desc&limit=${limit}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as ArenaRow[];
  } catch {
    return null;
  }
}

// ===== Онлайн PvP (таблица public.pvp) — профиль бойца для матчмейкинга =====
export type PvpProfile = { wallet: string; name: string; species: string; level: number; accessories: string[] };

// Обновить свой боевой профиль (вид, уровень, снаряжение) — чтобы другие могли на тебя матчиться.
export async function upsertPvpProfile(p: PvpProfile): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/pvp`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ ...p, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Найти случайного онлайн-соперника (не себя). null — если облако выключено/нет соперников.
export async function findPvpOpponent(myWallet: string): Promise<PvpProfile | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/pvp?wallet=neq.${encodeURIComponent(myWallet)}&select=wallet,name,species,level,accessories&order=updated_at.desc&limit=25`, { headers: headers() });
    if (!res.ok) return null;
    const rows = (await res.json()) as PvpProfile[];
    if (!rows.length) return null;
    return rows[Math.floor(Math.random() * rows.length)];
  } catch {
    return null;
  }
}

// ===== Живой рынок (таблица public.listings) — общие лоты питомцев =====
export type Listing = {
  id: string;
  seller: string;
  kind: "sale" | "auction";
  species: string;
  level: number;
  buffs: { kind: BuffKind; expiresAt: number }[];
  price: number;
  name?: string;
  created_at?: string;
};

// Все лоты выбранного типа (продажа/аукцион), новые сверху. null — облако выключено/ошибка.
export async function fetchListings(kind: "sale" | "auction", limit = 100): Promise<Listing[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/listings?kind=eq.${kind}&select=*&order=created_at.desc&limit=${limit}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as Listing[];
  } catch {
    return null;
  }
}

// Выставить лот.
export async function createListing(l: Listing): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/listings`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(l),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Снять свой лот (только свой — по id и адресу продавца).
// Возвращает удалённые строки: пустой массив = лот уже продан/снят (нечего возвращать), null = ошибка.
export async function deleteListing(id: string, seller: string): Promise<Listing[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&seller=eq.${encodeURIComponent(seller)}`, {
      method: "DELETE",
      headers: headers({ Prefer: "return=representation" }),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => [])) as Listing[];
  } catch {
    return null;
  }
}

// ===== Покупка на маркете (реальный SOL) — серверная функция проверяет tx и проводит сделку =====
// type 'sale' — купить лот игрока (refId = listing.id); 'exclusive' — купить эксклюзив (refId = exclusive.id).
// Возвращает обновлённый сейв покупателя (для setPet) или ошибку.
export async function confirmMarketBuy(type: "sale" | "exclusive", refId: string, signature: string, wallet: string): Promise<{ save: SavedPet } | { error: string }> {
  if (!isCloudEnabled()) return { error: "cloud off" };
  try {
    const res = await fetch(`${URL}/functions/v1/market-buy`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ wallet, signature, type, refId }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; save?: SavedPet; error?: string };
    if (res.ok && data.ok && data.save) return { save: data.save };
    return { error: data.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { error: String(e) };
  }
}

// ===== Эксклюзивные лоты (таблица public.exclusives) — продаёт казна лимитированным тиражом =====
export type Exclusive = { id: string; species: string; name?: string; price: number; stock: number; sold?: number; active?: boolean; created_at?: string };

// Активные эксклюзивы, новые сверху. null — облако выключено/ошибка.
export async function fetchExclusives(limit = 50): Promise<Exclusive[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/exclusives?active=eq.true&select=*&order=created_at.desc&limit=${limit}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as Exclusive[];
  } catch {
    return null;
  }
}

// Добавить эксклюзив (только админ — RLS пропустит запись лишь для админского wallet-claim в JWT).
export async function createExclusive(e: Exclusive): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/exclusives`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({ ...e, created_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Убрать эксклюзив с витрины (только админ).
export async function deleteExclusive(id: string): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/exclusives?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}

// ===== Заявки на награды за квесты (таблица public.quest_claims) — выплата SOL вручную админом =====
// Сумму НЕ храним в строке (клиенту не доверяем) — админ берёт её из QUESTS по quest_id.
export type QuestClaim = { id: string; wallet: string; quest_id: string; status: string; created_at?: string };

// Игрок запрашивает награду за выполненный квест. true = заявка создана ИЛИ уже существовала (409).
export async function createQuestClaim(wallet: string, questId: string): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/quest_claims`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({ id: `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`, wallet, quest_id: questId, status: "pending", created_at: new Date().toISOString() }),
    });
    return res.ok || res.status === 409; // 409 = уже заявлял этот квест → считаем забранным
  } catch {
    return false;
  }
}

// Все заявки на награды по статусу (админ видит все — по RLS-политике). null — облако выключено/ошибка.
export async function fetchQuestClaims(status = "pending"): Promise<QuestClaim[] | null> {
  if (!isCloudEnabled()) return null;
  try {
    const res = await fetch(`${URL}/rest/v1/quest_claims?status=eq.${status}&select=*&order=created_at.asc`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as QuestClaim[];
  } catch {
    return null;
  }
}

// Отметить заявку выплаченной (только админ). SOL админ отправляет вручную из своего кошелька.
export async function markQuestClaimPaid(id: string): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/quest_claims?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({ status: "paid" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
