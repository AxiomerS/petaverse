import { type Rarity } from "./rarity";
import { accById } from "./accessories";

// Боевые показатели для Игры №2 (PvP-бой питомцев).
export const BASE_POWER = 50;
export const POWER_PER_LEVEL = 10; // уровень повышает силу
export const BASE_HP = 300;
export const HP_PER_LEVEL = 20; // уровень повышает HP
export const CRIT_CAP = 0.25; // суммарный шанс крита не выше 25%

// Сила и HP от надетого аксессуара по редкости (×1.5 от прежних значений).
const ACC_POWER: Record<Rarity, number> = { common: 0, rare: 15, epic: 30, legendary: 53, mythic: 90 };
const ACC_HP: Record<Rarity, number> = { common: 0, rare: 75, epic: 150, legendary: 270, mythic: 450 };

// Бонус к силе/HP от редкости САМОГО ВИДА питомца (не аксессуаров) — более редкие виды базово крепче.
// Дельта поверх обычного (common) на 1 уровне: common 60/320, rare 80/400, epic 100/460,
// legendary 125/530, mythic 155/600.
const RARITY_POWER: Record<Rarity, number> = { common: 0, rare: 20, epic: 40, legendary: 65, mythic: 95 };
const RARITY_HP: Record<Rarity, number> = { common: 0, rare: 80, epic: 140, legendary: 210, mythic: 280 };

// Модификатор крита (epic и выше): шанс крита и доп. урон крита (доля).
const ACC_CRIT: Partial<Record<Rarity, { chance: number; dmg: number }>> = {
  epic: { chance: 0.1, dmg: 0.5 },
  legendary: { chance: 0.15, dmg: 0.75 },
  mythic: { chance: 0.25, dmg: 1.0 },
};

export type Loadout = { power: number; hp: number; critChance: number; critMult: number };

// Итоговая «сборка»: сила (× бафф еды в %), HP, шанс и множитель крита.
// powerBuffPct — доля (например 0.2 = +20% к силе). rarity — редкость вида питомца (не аксессуаров).
export function loadoutPower(level: number, accessories: string[], powerBuffPct: number, rarity: Rarity): Loadout {
  let base = BASE_POWER + level * POWER_PER_LEVEL + RARITY_POWER[rarity];
  let hp = BASE_HP + level * HP_PER_LEVEL + RARITY_HP[rarity];
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
