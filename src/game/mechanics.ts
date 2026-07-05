import { type BuffKind, activeMult } from "./buffs";
import { equippedBonuses, mythicAcc, accById } from "./accessories";
import { speciesEffect } from "./pets";

export type Stats = { fullness: number; happiness: number; health: number };

export const clamp = (n: number, max = 100) => Math.max(0, Math.min(max, n));

// XP, нужный, чтобы перейти С данного уровня на следующий. Растёт с каждым уровнем.
export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 50; // L1→2: 100, L2→3: 150, L3→4: 200, …
}

// Максимальная вместимость fullness и happiness растёт с уровнем (+10 за уровень).
export function statCap(level: number): number {
  return 100 + (level - 1) * 10;
}

// Скорости распада статов (в час).
export const FULLNESS_DECAY = 12;
export const HAPPINESS_DECAY = 8;
export const HEALTH_DECAY = 10;
export const HEALTH_RECOVER = 5;

export function decay(stats: Stats, from: number, to: number, mult: { f: number; h: number } = { f: 1, h: 1 }, cap = 100): Stats {
  const hours = Math.max(0, (to - from) / 3_600_000);
  if (hours === 0) return stats;
  const fullness = clamp(stats.fullness - FULLNESS_DECAY * hours * mult.f, cap);
  const happiness = clamp(stats.happiness - HAPPINESS_DECAY * hours * mult.h, cap);
  let health = stats.health;
  if (fullness <= 0 || happiness <= 0) health -= HEALTH_DECAY * hours;
  else if (fullness >= 50 && happiness >= 50) health += HEALTH_RECOVER * hours;
  return { fullness, happiness, health: clamp(health) };
}

// Итоговые множители распада: баффы × перки аксессуаров (усилены видовым "acc") × видовой распад.
export function decayMult(buffs: { kind: BuffKind; expiresAt: number }[], accessories: string[], speciesId: string, now: number): { f: number; h: number } {
  const b = activeMult(buffs, now);
  const e = equippedBonuses(accessories);
  const sp = speciesEffect(speciesId);
  const accBoost = 1 + sp.acc;
  return {
    f: Math.max(0, b.f * (1 - e.fDecay * accBoost) * (1 - sp.decayF)),
    h: Math.max(0, b.h * (1 - e.hDecay * accBoost) * (1 - sp.decayH)),
  };
}

// Пассивный доход Sil в минуту, пока приложение открыто. База 2/мин; каждый ТИП аксессуара
// с надетой легендаркой множит ставку ×1.5. По одной легендарке во всех четырёх типах → ×6 → 12/мин
// (несколько легендарок одного типа не стакаются — по одной на тип).
export const BASE_SIL_PER_MIN = 2;

export function silRate(accessories: string[], speciesId: string): number {
  const legTypes = new Set<string>();
  for (const id of accessories) {
    const a = accById(id);
    if (a && a.rarity === "legendary") legTypes.add(a.type);
  }
  const base = BASE_SIL_PER_MIN * (legTypes.size === 0 ? 1 : 1.5 * legTypes.size);
  return (base + mythicAcc(accessories).silFlat) * (1 + speciesEffect(speciesId).sil);
}

// Множитель дохода PV/min от уровня питомца: L1 = ×1.0, L2 = ×1.1, L3 = ×1.2, … (+10% за уровень).
export function levelSilMult(level: number): number {
  return 1 + (level - 1) * 0.1;
}

// Награды и стартовый баланс.
export const DAILY_REWARD = 50;
export const DAILY_COOLDOWN = 2 * 3_600_000; // награду можно забирать раз в 2 часа
export const START_COINS = 50;
// Версия разовой выдачи монет: повышай, чтобы один раз пополнить существующие сейвы до START_COINS.
export const GRANT_V = 1;
