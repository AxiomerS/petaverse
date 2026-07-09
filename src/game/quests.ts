// Квесты — задачи с наградой в Sil. Прогресс выводится из уже существующих полей сейва
// (без отдельного счётчика), поэтому новых полей почти не нужно — храним лишь список забранных.
// ПРИМЕЧАНИЕ: «закрываются у всех при закрытии кем-то одним» — общая для всех игроков логика,
// которая требует бэкенда (Supabase). Пока это локально: забрал/закрыл — исчез только у тебя.
export type QuestMetric = "battleWins" | "level" | "bestScore" | "ownedPets" | "coins";

// reward — в SOL (награда за квесты и весь рынок теперь на SOL).
export const QUESTS = [
  { id: "q-battles", emoji: "⚔️", label: "Win 5 arena battles", metric: "battleWins", goal: 5, reward: 0.05 },
  { id: "q-level", emoji: "⭐", label: "Reach level 8", metric: "level", goal: 8, reward: 0.08 },
  // Возвращено на 30000: трек теперь в 2 раза длиннее (300 нот вместо 150), так что даже с учётом
  // множителя комбо потолок результата вырос вместе с длиной — 30000 больше не требует безупречной игры.
  { id: "q-score", emoji: "🎵", label: "Score 30000 in a run", metric: "bestScore", goal: 30000, reward: 0.03 },
  { id: "q-collect", emoji: "🐣", label: "Own 4 pets", metric: "ownedPets", goal: 4, reward: 0.04 },
  { id: "q-rich", emoji: "🪙", label: "Hold 2500 PV", metric: "coins", goal: 2500, reward: 0.05 },
] as const;

export type Quest = (typeof QUESTS)[number];
