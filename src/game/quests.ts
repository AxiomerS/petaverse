// Квесты — задачи с наградой в Sil. Прогресс выводится из уже существующих полей сейва
// (без отдельного счётчика), поэтому новых полей почти не нужно — храним лишь список забранных.
// ПРИМЕЧАНИЕ: «закрываются у всех при закрытии кем-то одним» — общая для всех игроков логика,
// которая требует бэкенда (Supabase). Пока это локально: забрал/закрыл — исчез только у тебя.
export type QuestMetric = "battleWins" | "level" | "bestScore" | "ownedPets" | "coins";

// reward — в SOL (награда за квесты и весь рынок теперь на SOL).
export const QUESTS = [
  { id: "q-battles", emoji: "⚔️", label: "Win 5 arena battles", metric: "battleWins", goal: 5, reward: 0.05 },
  { id: "q-level", emoji: "⭐", label: "Reach level 8", metric: "level", goal: 8, reward: 0.08 },
  { id: "q-score", emoji: "🎵", label: "Score 3000 in a run", metric: "bestScore", goal: 3000, reward: 0.04 },
  { id: "q-collect", emoji: "🐣", label: "Own 4 pets", metric: "ownedPets", goal: 4, reward: 0.1 },
  { id: "q-rich", emoji: "🪙", label: "Hold 5000 PV", metric: "coins", goal: 5000, reward: 0.03 },
] as const;

export type Quest = (typeof QUESTS)[number];
