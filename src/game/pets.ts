// Виды питомцев. Эмодзи пока — позже заменим на свою графику (маскот feese).
// Три обычных доступны на старте; более редкие приходят из Pet Chest.
// Редкость вида даёт постоянный бонус, когда питомец активен.
export const PETS = [
  { id: "dog", emoji: "🐶", label: "Dog", rarity: "common" },
  { id: "cat", emoji: "🐱", label: "Cat", rarity: "common" },
  { id: "hamster", emoji: "🐹", label: "Hamster", rarity: "common" },
  { id: "rabbit", emoji: "🐰", label: "Rabbit", rarity: "rare" },
  { id: "frog", emoji: "🐸", label: "Frog", rarity: "rare" },
  { id: "penguin", emoji: "🐧", label: "Penguin", rarity: "rare" },
  { id: "fox", emoji: "🦊", label: "Fox", rarity: "epic" },
  { id: "panda", emoji: "🐼", label: "Panda", rarity: "epic" },
  { id: "owl", emoji: "🦉", label: "Owl", rarity: "epic" },
  { id: "lion", emoji: "🦁", label: "Lion", rarity: "legendary" },
  { id: "tiger", emoji: "🐯", label: "Tiger", rarity: "legendary" },
  { id: "unicorn", emoji: "🦄", label: "Unicorn", rarity: "legendary" },
  { id: "dragon", emoji: "🐉", label: "Dragon", rarity: "mythic" },
  { id: "dino", emoji: "🦖", label: "Dino", rarity: "mythic" },
] as const;

export type PetId = (typeof PETS)[number]["id"];
export const petById = (id: string) => PETS.find((p) => p.id === id);
// Базовые (обычные) питомцы — стартовые dog/cat/hamster. Они НЕ могут умереть
// (не уходят в обморок): их здоровье может упасть, но экрана смерти для них нет.
export const isBasePet = (id: string): boolean => petById(id)?.rarity === "common";
// На экране создания предлагаются только обычные виды.
export const STARTER_PETS = PETS.filter((p) => p.rarity === "common");

// У каждого вида ОДИН уникальный перк. Стартовые обычные (dog/cat/hamster) НЕ имеют перка —
// бонусы есть только у питомцев, которых выбивают из сундука (rare и выше).
// Mythic-питомцы получают флагманские перки.
export type PerkKind = "xp" | "sil" | "daily" | "shop" | "acc" | "food" | "decay" | "hunger" | "happy" | "hoard" | "eternal";
export const SPECIES_PERK: Record<string, { kind: PerkKind; value: number; label: string }> = {
  rabbit: { kind: "hunger", value: 0.15, label: "−15% hunger decay" },
  frog: { kind: "food", value: 0.2, label: "+20% food effect" },
  penguin: { kind: "daily", value: 0.2, label: "+20% daily reward" },
  fox: { kind: "shop", value: 0.1, label: "−10% shop prices" },
  panda: { kind: "decay", value: 0.15, label: "−15% all decay" },
  owl: { kind: "xp", value: 0.3, label: "+30% XP from food" },
  lion: { kind: "acc", value: 0.3, label: "+30% accessory bonuses" },
  tiger: { kind: "sil", value: 0.4, label: "+40% PV/min" },
  unicorn: { kind: "daily", value: 0.4, label: "+40% daily reward" },
  // MYTHIC флагманские перки — целый новый уровень мощи:
  dragon: { kind: "hoard", value: 1, label: "🐉 Golden Hoard: ×2 ALL PV income · −25% shop" },
  dino: { kind: "eternal", value: 1, label: "🦖 Eternal: stats never decay" },
};

// Развернуть перк активного вида в каналы эффектов.
export function speciesEffect(speciesId: string) {
  const e = { xp: 0, sil: 0, daily: 0, shop: 0, acc: 0, food: 0, decayF: 0, decayH: 0 };
  const p = SPECIES_PERK[speciesId];
  if (!p) return e;
  if (p.kind === "xp") e.xp = p.value;
  else if (p.kind === "sil") e.sil = p.value;
  else if (p.kind === "daily") e.daily = p.value;
  else if (p.kind === "shop") e.shop = p.value;
  else if (p.kind === "acc") e.acc = p.value;
  else if (p.kind === "food") e.food = p.value;
  else if (p.kind === "decay") { e.decayF = p.value; e.decayH = p.value; }
  else if (p.kind === "hunger") e.decayF = p.value;
  else if (p.kind === "happy") e.decayH = p.value;
  else if (p.kind === "hoard") { e.sil = 1; e.daily = 0.5; e.shop = 0.25; } // ×2 sil, +50% daily, −25% shop
  else if (p.kind === "eternal") { e.decayF = 1; e.decayH = 1; } // без распада
  return e;
}
