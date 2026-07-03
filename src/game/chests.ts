import { type Rarity, RARITY_ORDER } from "./rarity";

// Минимальная форма, общая для еды и аксессуаров — используется превью сундука.
export type PoolItem = { id: string; emoji: string; label: string; rarity: Rarity };

// Сундуки еды. odds = шанс (%) каждой редкости за открытие.
// Цены сбалансированы по тирам: базовый — дешёвый вход, премиальные стоят заметно дороже,
// но дают ощутимо лучшие шансы на высокие редкости.
export const FOOD_CHESTS = [
  { id: "wood", emoji: "📦", label: "Wooden", cost: 15, odds: { common: 55, rare: 35, epic: 10 } },
  { id: "gold", emoji: "🎁", label: "Golden", cost: 55, odds: { rare: 35, epic: 45, legendary: 18, mythic: 2 } },
  { id: "feast", emoji: "🍱", label: "Feast", cost: 102, odds: { epic: 50, legendary: 47, mythic: 3 } },
] as const;

// Сундуки аксессуаров. odds должны давать в сумме 100. Дороже сундук — лучше шанс mythic.
// Аксессуары постоянные (сила/HP/перки) → премиальные сундуки заметно дороже.
export const ACC_CHESTS = [
  { id: "basic", emoji: "🎁", label: "Basic", cost: 60, odds: { rare: 70, epic: 22, legendary: 7.9, mythic: 0.1 } },
  { id: "premium", emoji: "💎", label: "Premium", cost: 150, odds: { rare: 55, epic: 30, legendary: 14, mythic: 1 } },
  { id: "mythic", emoji: "🌟", label: "Mythic", cost: 272, odds: { rare: 35, epic: 37, legendary: 25, mythic: 3 } },
] as const;

// Сундуки питомцев — дропают новый вид по редкости. Дороже яйцо — лучше шансы.
// Питомцы — самый ценный приз, поэтому яйца самые дорогие сундуки в магазине.
export const PET_CHESTS = [
  { id: "egg", emoji: "🥚", label: "Egg", cost: 150, odds: { rare: 55, epic: 33, legendary: 10, mythic: 2 } },
  { id: "golden-egg", emoji: "🐣", label: "Golden Egg", cost: 340, odds: { rare: 30, epic: 38, legendary: 27, mythic: 5 } },
] as const;

// Самый редкий тир, который может дропнуть сундук (для цвета ранга сундука).
export function bestTier(odds: Partial<Record<Rarity, number>>): Rarity {
  const present = RARITY_ORDER.filter((t) => (odds[t] ?? 0) > 0);
  return present[present.length - 1] ?? "common";
}

// Форматировать шанс дропа конкретного предмета как короткую строку процента.
export function fmtChance(p: number): string {
  if (p >= 10) return p.toFixed(0) + "%";
  if (p >= 1) return p.toFixed(1) + "%";
  return p.toFixed(2) + "%";
}
