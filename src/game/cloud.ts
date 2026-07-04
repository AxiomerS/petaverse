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
export async function deleteListing(id: string, seller: string): Promise<boolean> {
  if (!isCloudEnabled()) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&seller=eq.${encodeURIComponent(seller)}`, {
      method: "DELETE",
      headers: headers(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
