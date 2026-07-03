import { type Rarity } from "./rarity";
import { accById } from "./accessories";

// Боевые показатели для Игры №2 (PvP-бой питомцев).
export const BASE_POWER = 50;
export const POWER_PER_LEVEL = 10; // уровень повышает силу
export const BASE_HP = 300;
export const HP_PER_LEVEL = 20; // уровень повышает HP
export const CRIT_CAP = 0.25; // суммарный шанс крита не выше 25%

// Сила и HP от надетого аксессуара по редкости.
const ACC_POWER: Record<Rarity, number> = { common: 0, rare: 10, epic: 20, legendary: 35, mythic: 60 };
const ACC_HP: Record<Rarity, number> = { common: 0, rare: 50, epic: 100, legendary: 180, mythic: 300 };

// Модификатор крита (epic и выше): шанс крита и доп. урон крита (доля).
const ACC_CRIT: Partial<Record<Rarity, { chance: number; dmg: number }>> = {
  epic: { chance: 0.1, dmg: 0.5 },
  legendary: { chance: 0.15, dmg: 0.75 },
  mythic: { chance: 0.25, dmg: 1.0 },
};

export type Loadout = { power: number; hp: number; critChance: number; critMult: number };

// Итоговая «сборка»: сила (× бафф еды в %), HP, шанс и множитель крита.
// powerBuffPct — доля (например 0.2 = +20% к силе).
export function loadoutPower(level: number, accessories: string[], powerBuffPct: number): Loadout {
  let base = BASE_POWER + level * POWER_PER_LEVEL;
  let hp = BASE_HP + level * HP_PER_LEVEL;
  const critChances: number[] = [];
  let dmg = 0;
  for (const id of accessories) {
    const a = accById(id);
    if (!a) continue;
    base += ACC_POWER[a.rarity];
    hp += ACC_HP[a.rarity];
    const c = ACC_CRIT[a.rarity];
    if (c) { critChances.push(c.chance); dmg += c.dmg; }
  }
  const power = Math.round(base * (1 + (powerBuffPct || 0)));
  // Крит складывается с уменьшающейся пользой: 1 − произведение(1 − cᵢ), но не выше CRIT_CAP.
  let noCrit = 1;
  for (const c of critChances) noCrit *= 1 - c;
  const critChance = Math.min(CRIT_CAP, 1 - noCrit);
  return { power, hp, critChance, critMult: 1 + dmg };
}

// Активная прибавка силы (в долях) от баффа еды, если ещё не истёк.
export function activePowerBuff(buff: { amount: number; expiresAt: number } | null | undefined, now: number): number {
  return buff && buff.expiresAt > now ? buff.amount : 0;
}

// Для показа в снаряжении.
export function accPower(rarity: Rarity): number {
  return ACC_POWER[rarity];
}
export function accHp(rarity: Rarity): number {
  return ACC_HP[rarity];
}
export function accCrit(rarity: Rarity): { chance: number; dmg: number } | null {
  return ACC_CRIT[rarity] ?? null;
}
