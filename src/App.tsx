import { useState, useEffect, useRef } from "react";
import "./App.css";
import { RARITY, rollRarity, XP_BY_RARITY, type Rarity } from "./game/rarity";
import { PETS, STARTER_PETS, SPECIES_PERK, speciesEffect, isBasePet, type PetId } from "./game/pets";
import { FOODS, rollFood, foodTitle, FOOD_BUFF, FOOD_POWER, type Food } from "./game/foods";
import { loadoutPower, activePowerBuff, accPower, accHp, accCrit } from "./game/power";
import { ACCESSORIES, accById, SLOTS, STARTER_ACCESSORIES, equippedBonuses, accDesc, mythicAcc } from "./game/accessories";
import { BUFFS, type BuffKind } from "./game/buffs";
import { FOOD_CHESTS, ACC_CHESTS, PET_CHESTS, bestTier, fmtChance, type PoolItem } from "./game/chests";
import { type Stats, clamp, xpForLevel, decay, decayMult, silRate, statCap, DAILY_REWARD, DAILY_COOLDOWN, START_COINS, GRANT_V } from "./game/mechanics";
import { POTIONS, potionById, potionEffects, potionTitle, type Potion } from "./game/potions";
import { QUESTS } from "./game/quests";
import { type SavedPet, STORAGE_KEY, loadPet, type MarketListing } from "./game/save";
import { getPhantom, shortAddress, signMessageHex, PHANTOM_INSTALL_URL } from "./game/wallet";
import { isCloudEnabled, loadCloudSave, saveCloudSave, submitScore, fetchTopScores, submitArena, fetchTopArena, upsertPvpProfile, findPvpOpponent, fetchListings, createListing, deleteListing, confirmMarketBuy, fetchExclusives, createExclusive, deleteExclusive, signIn, setSessionToken, confirmPurchase, requestSell, fetchSellRequests, payoutSell, type ScoreRow, type ArenaRow, type Listing, type Exclusive, type SellRequest } from "./game/cloud";
import { sendSolPayment, SOL_PV_RATE, SOL_BUY_PACKS, SOL_SELL_RATE, SOL_SELL_PACKS, SOL_MARKET_FEE_BPS } from "./game/pay";
import { SPIN_MS, playSpinSound, playWinSound } from "./game/audio";
import { Coin, StatBar } from "./components/ui";
import { PetArt } from "./components/PetArt";
import { Roulette } from "./components/Roulette";
import { RhythmGame } from "./components/RhythmGame";
import { BattleGame } from "./components/BattleGame";

// Игровая валюта: PV (внутриигровая валюта и крипто-токен $PV).
const SIL = "PV";

// Соперники в лидерборде — лучшие забеги в ритм-игре (локальные/фейковые;
// для настоящего глобального борда «от игроков» нужен бэкенд — следующий большой шаг).
const LEADERBOARD_BOTS = [
  { name: "RhythmKing", score: 18420 },
  { name: "DragonLord", score: 15240 },
  { name: "feese_whale", score: 12980 },
  { name: "MoonPup", score: 10120 },
  { name: "PixelFox", score: 8270 },
  { name: "SolHamster", score: 6150 },
  { name: "TinyDino", score: 4300 },
  { name: "LuckyFrog", score: 2710 },
  { name: "NoobPenguin", score: 1180 },
  { name: "Starter123", score: 540 },
];

// Почасовая награда за топ-забег по рангу в лидерборде.
const RUN_REWARD_COOLDOWN = 3_600_000; // 1 час
function runRewardForRank(rank: number): number {
  if (rank <= 3) return 500;
  if (rank <= 8) return 200;
  if (rank <= 10) return 100;
  return 50; // ниже топ-10 (если счёт совсем мал) — небольшой утешительный приз
}

type Modal = null | "shop" | "inventory" | "accessories" | "pets" | "leaderboard" | "roulette" | "play" | "breed" | "buysil" | "market" | "playmenu" | "pumpfun" | "battle" | "potions" | "admin";

// Кошелёк-админ: только он видит и подтверждает заявки на продажу PV.
const ADMIN_WALLET = "EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk";

// Внешние ссылки проекта (TODO: заменить на финальные).
const LINK_GITHUB = "https://github.com/AxiomerS/petaverse";
const LINK_TWITTER = "https://x.com/PetaVerseSol";
const LINK_PUMPFUN = "https://pump.fun/";
const TOKEN_CA = ""; // адрес контракта токена; пусто = ещё не запущен

// Реальная покупка PV за SOL — курс и пакеты заданы в game/pay.ts (devnet).

// Сессия верификации кошелька (JWT из auth-функции), хранится локально для бесшовного входа.
const SESSION_KEY = "petaverse.session";
function jwtExpMs(token: string): number {
  try { return (JSON.parse(atob(token.split(".")[1])).exp ?? 0) * 1000; } catch { return 0; }
}

// Воскрешение: цена лекарства = база + за каждый уровень питомца.
const REVIVE_BASE = 50;
const REVIVE_PER_LEVEL = 100;

// Скрещивание: открыто, когда есть два питомца уровня BREED_LEVEL+. Стоит BREED_COST,
// даёт случайного нового питомца (rare+) с хорошими шансами на высокие редкости.
const BREED_LEVEL = 5;
const BREED_COST = 1000;
const BREED_ODDS: Partial<Record<Rarity, number>> = { rare: 25, epic: 40, legendary: 27, mythic: 8 };

export default function App() {
  const [pet, setPet] = useState<SavedPet | null>(() => loadPet());
  const [picked, setPicked] = useState<PetId | null>(null);
  const [name, setName] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [accPicker, setAccPicker] = useState<string | null>(null); // accessory slot type being edited
  const [breedSel, setBreedSel] = useState<string[]>([]); // выбранные родители для скрещивания
  const [bred, setBred] = useState<{ id: string; rarity: Rarity } | null>(null); // результат скрещивания
  const [namePet, setNamePet] = useState<string | null>(null); // вид, которому задаём имя перед выбором
  const [petNameInput, setPetNameInput] = useState("");
  const [petMenu, setPetMenu] = useState(false); // панель взаимодействия с питомцем
  const [showBuffs, setShowBuffs] = useState(false); // раскрыта ли панель баффов (когда их >2)
  const [questsOpen, setQuestsOpen] = useState(true); // раскрыт ли список квестов
  const [wallet, setWallet] = useState<string | null>(null); // адрес подключённого кошелька Phantom (= ID игрока)
  const [walletMenu, setWalletMenu] = useState(false); // открыт ли попап кошелька
  const [cloudLoading, setCloudLoading] = useState(false); // идёт ли загрузка облачного сейва
  const [verified, setVerified] = useState(false); // подтверждён ли кошелёк подписью
  const [buying, setBuying] = useState(false); // идёт ли покупка PV за SOL
  const [adminReqs, setAdminReqs] = useState<SellRequest[] | null>(null); // pending-заявки на продажу (для админа)
  const [payoutBusy, setPayoutBusy] = useState(false); // идёт обработка выплаты (блок от двойного клика Approve/Reject)
  const [listBusy, setListBusy] = useState(false); // идёт выставление лота (блок от двойного клика List)
  const isAdmin = wallet === ADMIN_WALLET;
  const [topScores, setTopScores] = useState<ScoreRow[] | null>(null); // глобальный топ лидерборда
  const [lbLoaded, setLbLoaded] = useState(false); // загрузили ли топ (чтобы отличить загрузку от «пусто»)
  const [arenaTop, setArenaTop] = useState<ArenaRow[] | null>(null); // глобальный топ арены
  const [marketListings, setMarketListings] = useState<Listing[] | null>(null); // общие лоты рынка
  const [marketLoaded, setMarketLoaded] = useState(false); // загрузили ли лоты
  const [marketTab, setMarketTab] = useState<"exclusive" | "player" | "auction">("exclusive");
  const [listSpecies, setListSpecies] = useState<string>(""); // выбранный питомец для листинга
  const [listPrice, setListPrice] = useState<string>(""); // цена (SOL) для листинга
  const [exclusives, setExclusives] = useState<Exclusive[] | null>(null); // эксклюзивы от казны
  const [exLoaded, setExLoaded] = useState(false); // загрузили ли эксклюзивы
  const [exSpecies, setExSpecies] = useState<string>(""); // админ-форма: вид эксклюзива
  const [exPrice, setExPrice] = useState<string>(""); // админ-форма: цена SOL
  const [exStock, setExStock] = useState<string>("1"); // админ-форма: тираж
  const [toast, setToast] = useState("");
  // Chest opening: a roulette strip of emojis that scrolls and lands on the won one.
  // Display-only — the won item is already added to inventory/owned when the chest opens.
  type WonItem = { emoji: string; label: string; rarity: Rarity; rarityLabel?: string; rarityColor?: string };
  const [chest, setChest] = useState<{ won: WonItem; strip: string[]; colors: string[]; winIdx: number; revealed: boolean } | null>(null);
  const [reelOffset, setReelOffset] = useState(0);
  // Chest preview: shown when a chest is clicked, before spending. Lists possible drops.
  const [preview, setPreview] = useState<
    | { kind: "food"; chest: (typeof FOOD_CHESTS)[number] }
    | { kind: "accessory"; chest: (typeof ACC_CHESTS)[number] }
    | { kind: "pet"; chest: (typeof PET_CHESTS)[number] }
    | null
  >(null);

  useEffect(() => {
    if (pet) localStorage.setItem(STORAGE_KEY, JSON.stringify(pet));
    else localStorage.removeItem(STORAGE_KEY);
  }, [pet]);

  const petRef = useRef(pet);
  petRef.current = pet;
  useEffect(() => {
    const iv = setInterval(() => {
      const cur = petRef.current;
      // Мёртвый питомец заморожен — оживить лекарством. НО базовые питомцы не умирают,
      // поэтому их тик работает всегда (здоровье само восстанавливается при сытости/счастье ≥50).
      if (!cur || (cur.stats.health <= 0 && !isBasePet(cur.species))) return;
      const now = Date.now();
      const buffs = cur.buffs.filter((b) => b.expiresAt > now);
      const potions = cur.potions.filter((p) => p.expiresAt > now); // активные зелья
      const potEff = potionEffects(potions, now);
      const hours = (now - cur.updatedAt) / 3_600_000;
      const mr = mythicAcc(cur.accessories);
      // Пассивный Sil копится ТОЛЬКО пока приложение активно тикает: засчитываем не больше
      // одного интервала тика (≤5с) — так доход не набегает за фон/оффлайн. Зелье Sil усиливает доход.
      const earnMs = Math.min(now - cur.updatedAt, 5000);
      const earned = (earnMs / 60000) * silRate(cur.accessories, cur.species) * (1 + potEff.sil);
      // Decay, then add mythic regen (leash→fullness, toy→happiness). Cap растёт с уровнем.
      // Зелье Vitality замедляет распад (множим итоговый decayMult на (1 − potEff.decay)).
      const cap = statCap(cur.level);
      const dm = decayMult(buffs, cur.accessories, cur.species, now);
      let stats = decay(cur.stats, cur.updatedAt, now, { f: dm.f * (1 - potEff.decay), h: dm.h * (1 - potEff.decay) }, cap);
      stats = { ...stats, fullness: clamp(stats.fullness + mr.fRegen * hours, cap), happiness: clamp(stats.happiness + mr.hRegen * hours, cap) };
      // Passive XP from a mythic cap → level up while enough.
      let xp = cur.xp + mr.xpHr * hours;
      let level = cur.level;
      while (xp >= xpForLevel(level)) { xp -= xpForLevel(level); level++; }
      setPet({ ...cur, coins: cur.coins + earned, stats, xp, level, buffs, potions, updatedAt: now });
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Кошелёк Phantom: тихое авто-переподключение (если уже разрешён) + слежение за сменой аккаунта.
  useEffect(() => {
    const provider = getPhantom();
    if (!provider) return;
    provider.connect({ onlyIfTrusted: true })
      .then((res) => setWallet(res.publicKey.toString()))
      .catch(() => {}); // не разрешён — просто ждём ручного нажатия Connect
    const onConnect = () => provider.publicKey && setWallet(provider.publicKey.toString());
    const onDisconnect = () => setWallet(null);
    const onAccountChanged = (pk: unknown) => setWallet(pk ? String((pk as { toString(): string }).toString()) : null);
    provider.on("connect", onConnect);
    provider.on("disconnect", onDisconnect);
    provider.on("accountChanged", onAccountChanged);
    return () => {
      provider.removeAllListeners("connect");
      provider.removeAllListeners("disconnect");
      provider.removeAllListeners("accountChanged");
    };
  }, []);

  // Сессия верификации: при смене кошелька восстанавливаем сохранённый токен (если валиден).
  useEffect(() => {
    if (!wallet) { setSessionToken(null); setVerified(false); return; }
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { wallet: string; token: string };
        if (s.wallet === wallet && jwtExpMs(s.token) > Date.now()) {
          setSessionToken(s.token);
          setVerified(true);
          return;
        }
      }
    } catch { /* игнорируем */ }
    setSessionToken(null);
    setVerified(false);
  }, [wallet]);

  // Облако: при подключении кошелька грузим его сейв. Если у кошелька его ещё нет —
  // заливаем текущего локального питомца (чтобы прогресс не потерялся).
  useEffect(() => {
    if (!wallet || !isCloudEnabled()) return;
    let cancelled = false;
    setCloudLoading(true);
    loadCloudSave(wallet)
      .then((cloud) => {
        if (cancelled) return;
        if (cloud) setPet(cloud); // облачный питомец этого кошелька — источник правды
        else if (petRef.current) saveCloudSave(wallet, petRef.current); // у кошелька сейва нет → заливаем локального
        const p = cloud ?? petRef.current;
        if (p && p.bestScore > 0) submitScore(wallet, p.name, p.bestScore); // засветиться в лидерборде
        if (p && p.battleWins + p.battleLosses > 0)
          submitArena({ wallet, name: p.name, species: p.species, power: loadoutPower(p.level, p.accessories, 0).power, wins: p.battleWins, losses: p.battleLosses });
        if (p) upsertPvpProfile({ wallet, name: p.name, species: p.species, level: p.level, accessories: p.accessories }); // профиль для PvP
      })
      .finally(() => { if (!cancelled) setCloudLoading(false); });
    return () => { cancelled = true; };
  }, [wallet]);

  // Лидерборд: подгружаем глобальный топ при открытии модалки Ranks.
  useEffect(() => {
    if (modal !== "leaderboard" || !isCloudEnabled()) return;
    let cancelled = false;
    setLbLoaded(false);
    fetchTopScores(20).then((rows) => {
      if (cancelled) return;
      setTopScores(rows);
      setLbLoaded(true);
    });
    return () => { cancelled = true; };
  }, [modal]);

  // Арена: подгружаем глобальный рейтинг при открытии Battle Arena.
  useEffect(() => {
    if (modal !== "battle" || !isCloudEnabled()) return;
    let cancelled = false;
    setArenaTop(null);
    fetchTopArena(20).then((rows) => { if (!cancelled) setArenaTop(rows); });
    return () => { cancelled = true; };
  }, [modal]);

  // Админ: подгружаем pending-заявки на продажу при открытии админ-панели.
  useEffect(() => {
    if (modal !== "admin" || !isAdmin) return;
    let cancelled = false;
    setAdminReqs(null);
    fetchSellRequests("pending").then((rows) => { if (!cancelled) setAdminReqs(rows ?? []); });
    return () => { cancelled = true; };
  }, [modal, isAdmin]);

  // Рынок: подгружаем лоты игроков (вкладка Player) или эксклюзивы (вкладка Exclusive).
  useEffect(() => {
    if (modal !== "market" || !isCloudEnabled()) return;
    let cancelled = false;
    if (marketTab === "player") {
      setMarketLoaded(false);
      fetchListings("sale").then((rows) => {
        if (cancelled) return;
        setMarketListings(rows);
        setMarketLoaded(true);
      });
    } else if (marketTab === "exclusive") {
      setExLoaded(false);
      fetchExclusives().then((rows) => {
        if (cancelled) return;
        setExclusives(rows);
        setExLoaded(true);
      });
    }
    return () => { cancelled = true; };
  }, [modal, marketTab]);

  // Облако: периодически сохраняем прогресс + обновляем боевой профиль для PvP (раз в 20с).
  useEffect(() => {
    if (!wallet || !isCloudEnabled()) return;
    const iv = setInterval(() => {
      const p = petRef.current;
      if (!p) return;
      saveCloudSave(wallet, p);
      upsertPvpProfile({ wallet, name: p.name, species: p.species, level: p.level, accessories: p.accessories });
    }, 20000);
    return () => clearInterval(iv);
  }, [wallet]);

  function createPet() {
    if (!picked || !name.trim()) return;
    setPet({
      species: picked,
      name: name.trim(),
      names: { [picked]: name.trim() },
      stats: { fullness: 100, happiness: 100, health: 100 },
      coins: START_COINS,
      sol: 0,
      inventory: {},
      ownedSpecies: [picked],
      ownedAccessories: [...STARTER_ACCESSORIES],
      accessories: [],
      xp: 0,
      level: 1,
      buffs: [],
      powerBuff: null,
      potionInv: {},
      potions: [],
      questClaimed: [],
      listings: [],
      progress: {},
      lastDaily: 0,
      totalScore: 0,
      bestScore: 0,
      lastRunReward: 0,
      battleWins: 0,
      battleLosses: 0,
      grantV: GRANT_V,
      updatedAt: Date.now(),
    });
  }


  // Effective price after the active species' shop discount (if any).
  function price(base: number): number {
    return Math.ceil(base * (pet ? 1 - speciesEffect(pet.species).shop : 1));
  }

  // Buy a food → goes into the inventory (does NOT feed immediately).
  function buyFood(food: Food) {
    if (!pet) return;
    const cost = price(food.cost);
    if (pet.coins < cost) return setToast(`Not enough ${SIL}`);
    setPet({
      ...pet,
      coins: pet.coins - cost,
      inventory: { ...pet.inventory, [food.id]: (pet.inventory[food.id] ?? 0) + 1 },
    });
    setToast(`Bought ${food.label} ${food.emoji}`);
  }

  // Open a chest → build a roulette strip, scroll it, then drop the food into the inventory.
  const REEL_LEN = 40;
  const REEL_WIN = 34; // winning item sits near the end so there's a run-up
  // Build a roulette strip with the won item at the winning index, plus a color per
  // cell (its rarity color) so the spinning reel is colorful.
  function buildStrip(pool: readonly { emoji: string; rarity: Rarity }[], won: { emoji: string; rarity: Rarity }): { strip: string[]; colors: string[] } {
    const strip: string[] = [];
    const colors: string[] = [];
    for (let i = 0; i < REEL_LEN; i++) {
      const it = i === REEL_WIN ? won : pool[Math.floor(Math.random() * pool.length)];
      strip.push(it.emoji);
      colors.push(RARITY[it.rarity].color);
    }
    return { strip, colors };
  }

  // Food chest.
  function openChest(c: (typeof FOOD_CHESTS)[number]) {
    if (!pet) return;
    const cost = price(c.cost);
    if (pet.coins < cost) return setToast(`Not enough ${SIL}`);
    const won = rollFood(c.odds);
    setPet({
      ...pet,
      coins: pet.coins - cost,
      inventory: { ...pet.inventory, [won.id]: (pet.inventory[won.id] ?? 0) + 1 },
    });
    setReelOffset(0);
    const reel = buildStrip(FOODS, won);
    setChest({
      won: { emoji: won.emoji, label: won.label, rarity: won.rarity, rarityLabel: RARITY[won.rarity].label, rarityColor: RARITY[won.rarity].color },
      strip: reel.strip,
      colors: reel.colors,
      winIdx: REEL_WIN,
      revealed: false,
    });
  }

  // Accessory chest → roll a rarity by the chest's odds, then a random unowned accessory.
  function openAccessoryChest(c: (typeof ACC_CHESTS)[number]) {
    if (!pet) return;
    const cost = price(c.cost);
    if (pet.coins < cost) return setToast(`Not enough ${SIL}`);
    const missing = ACCESSORIES.filter((a) => !pet.ownedAccessories.includes(a.id));
    if (missing.length === 0) return setToast("You own every accessory! 🎉");
    // Roll a rarity; if nothing of that rarity is left, fall back to any unowned.
    const rarity = rollRarity(c.odds);
    const pool = missing.filter((a) => a.rarity === rarity);
    const from = pool.length ? pool : missing;
    const won = from[Math.floor(Math.random() * from.length)];
    setPet({
      ...pet,
      coins: pet.coins - cost,
      ownedAccessories: [...pet.ownedAccessories, won.id],
    });
    setReelOffset(0);
    const reel = buildStrip(ACCESSORIES, won);
    setChest({
      won: { emoji: won.emoji, label: won.label, rarity: won.rarity, rarityLabel: RARITY[won.rarity].label, rarityColor: RARITY[won.rarity].color },
      strip: reel.strip,
      colors: reel.colors,
      winIdx: REEL_WIN,
      revealed: false,
    });
  }

  // Animate the roulette: start at 0, then slide so the winning item lands under the pointer.
  useEffect(() => {
    if (!chest || chest.revealed) return;
    const ITEM = 80; // px, must match .reel-item width in CSS
    const CENTER = 100; // (viewport 280 / 2) − (item 80 / 2)
    const target = -(chest.winIdx * ITEM - CENTER);
    const start = setTimeout(() => setReelOffset(target), 50); // let it render at 0 first, then transition
    const epicPlus = chest.won.rarity === "epic" || chest.won.rarity === "legendary" || chest.won.rarity === "mythic";
    const done = setTimeout(() => {
      setChest((c) => (c ? { ...c, revealed: true } : c));
      if (epicPlus) playWinSound(); // на редкий дроп — звук как при выигрыше в рулетке
    }, SPIN_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(done);
    };
  }, [chest]);

  // Pet chest → roll a rarity by odds, then a random species the player doesn't own.
  function openPetChest(c: (typeof PET_CHESTS)[number]) {
    if (!pet) return;
    const cost = price(c.cost);
    if (pet.coins < cost) return setToast(`Not enough ${SIL}`);
    // Common starter pets (dog/cat/hamster) are never dropped by chests.
    const missing = PETS.filter((p) => p.rarity !== "common" && !pet.ownedSpecies.includes(p.id));
    if (missing.length === 0) return setToast("You own every pet! 🎉");
    const rarity = rollRarity(c.odds);
    const pool = missing.filter((p) => p.rarity === rarity);
    const from = pool.length ? pool : missing;
    const won = from[Math.floor(Math.random() * from.length)];
    setPet({ ...pet, coins: pet.coins - cost, ownedSpecies: [...pet.ownedSpecies, won.id] });
    setReelOffset(0);
    const reel = buildStrip(PETS, won);
    setChest({
      won: { emoji: won.emoji, label: won.label, rarity: won.rarity, rarityLabel: RARITY[won.rarity].label, rarityColor: RARITY[won.rarity].color },
      strip: reel.strip,
      colors: reel.colors,
      winIdx: REEL_WIN,
      revealed: false,
    });
  }

  // Spin the previewed chest (pay + roll + animation), then close the preview.
  function spinPreview() {
    if (!preview) return;
    playSpinSound(SPIN_MS / 1000); // user gesture → audio allowed
    if (preview.kind === "food") openChest(preview.chest);
    else if (preview.kind === "accessory") openAccessoryChest(preview.chest);
    else openPetChest(preview.chest);
    setPreview(null);
  }

  // Feed the pet from the inventory → consumes one item, applies stats, XP and buffs.
  function feedFromInventory(food: Food) {
    if (!pet || (pet.inventory[food.id] ?? 0) <= 0) return;
    const now = Date.now();

    // XP gain — boosted by equipped caps (amplified by species "acc" perk), species "xp" perk
    // и зельем мудрости (potEff.xp).
    const sp = speciesEffect(pet.species);
    const potEff = potionEffects(pet.potions, now);
    const xpMult = equippedBonuses(pet.accessories).xpMult * (1 + sp.acc) + sp.xp + potEff.xp;
    const xpGain = Math.round(XP_BY_RARITY[food.rarity] * (1 + xpMult));
    let xp = pet.xp + xpGain;
    let level = pet.level;
    let leveled = false;
    while (xp >= xpForLevel(level)) {
      xp -= xpForLevel(level);
      level++;
      leveled = true;
    }

    // Свой бафф конкретной еды (refreshes if same buff already active).
    const bk = FOOD_BUFF[food.id];
    let buffs = pet.buffs.filter((b) => b.expiresAt > now);
    if (bk) buffs = [...buffs.filter((b) => b.kind !== bk), { kind: bk, expiresAt: now + BUFFS[bk].durationMs }];

    // Макс вместимость растёт с (возможно новым) уровнем.
    const cap = statCap(level);

    // Еда epic+ даёт временную прибавку боевой силы (Игра №2).
    const pw = FOOD_POWER[food.rarity];
    const powerBuff = pw > 0
      ? { amount: Math.max(pw, activePowerBuff(pet.powerBuff, now)), expiresAt: now + 3_600_000 }
      : pet.powerBuff;

    setPet({
      ...pet,
      inventory: { ...pet.inventory, [food.id]: pet.inventory[food.id] - 1 },
      // Mythic food fully restores every stat (до текущего cap); otherwise add the food's effect.
      stats:
        food.rarity === "mythic"
          ? { fullness: cap, happiness: cap, health: 100 }
          : {
              ...pet.stats,
              fullness: clamp(pet.stats.fullness + food.fullness * (1 + sp.food), cap),
              happiness: clamp(pet.stats.happiness + food.happiness * (1 + sp.food), cap),
            },
      xp,
      level,
      buffs,
      powerBuff,
      updatedAt: now,
    });
    setToast(
      leveled
        ? `🎉 ${pet.name} reached level ${level}!`
        : bk
        ? `Yum! ${BUFFS[bk].emoji} ${BUFFS[bk].label} active`
        : `Yum! ${pet.name} ate a ${food.label.toLowerCase()} ${food.emoji}`,
    );
  }

  // Изменить баланс Sil на delta (функционально — чтобы не затирать пассивный доход тика).
  // Используется рулеткой: списание ставки и начисление выигрыша.
  function addCoins(delta: number) {
    setPet((prev) => (prev ? { ...prev, coins: Math.max(0, prev.coins + delta), updatedAt: Date.now() } : prev));
  }

  // Подключить кошелёк Phantom (по кнопке). Нет расширения → отправляем на установку.
  async function connectWallet() {
    const provider = getPhantom();
    if (!provider) {
      window.open(PHANTOM_INSTALL_URL, "_blank", "noopener");
      return setToast("Install Phantom to connect");
    }
    try {
      const res = await provider.connect();
      const addr = res.publicKey.toString();
      setWallet(addr);
      setToast("👛 Wallet connected");
      // Авто-верификация при первом подключении (если нет валидного сохранённого токена).
      let hasValid = false;
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        const s = raw ? (JSON.parse(raw) as { wallet: string; token: string }) : null;
        hasValid = !!(s && s.wallet === addr && jwtExpMs(s.token) > Date.now());
      } catch { /* нет токена */ }
      if (!hasValid && isCloudEnabled()) verifyWallet(addr);
    } catch {
      setToast("Connection cancelled");
    }
  }
  async function disconnectWallet() {
    if (wallet && petRef.current) await saveCloudSave(wallet, petRef.current); // сохраняем последнее состояние
    try {
      await getPhantom()?.disconnect();
    } catch {
      /* игнорируем */
    }
    setWallet(null);
    setWalletMenu(false);
    setToast("Wallet disconnected");
  }

  // Верификация: подписываем сообщение кошельком → получаем токен (доказывает, что адрес твой).
  async function verifyWallet(addr?: string) {
    const provider = getPhantom();
    const w = addr ?? wallet;
    if (!provider || !w) return;
    const message = `Sign in to Petaverse\nwallet: ${w}\nts:${Date.now()}`;
    try {
      const sigHex = await signMessageHex(provider, message);
      const token = await signIn(w, message, sigHex);
      if (token) {
        setVerified(true);
        setWalletMenu(false);
        localStorage.setItem(SESSION_KEY, JSON.stringify({ wallet: w, token }));
        setToast("✅ Wallet verified");
      } else {
        setToast("Verification failed — is the auth function deployed?");
      }
    } catch {
      setToast("Signature cancelled");
    }
  }

  // Реальная покупка PV за SOL: Phantom отправляет SOL на treasury → сервер проверяет и начисляет PV.
  async function buyPvReal(sol: number) {
    if (!wallet) return setToast("Connect wallet first");
    setBuying(true);
    setToast("Confirm the payment in Phantom…");
    try {
      const sig = await sendSolPayment(sol);
      if (!sig) { setBuying(false); return setToast("Payment cancelled"); }
      setToast("Verifying payment on-chain…");
      const res = await confirmPurchase(wallet, sig);
      if ("coins" in res) {
        setPet((p) => (p ? { ...p, coins: res.coins, updatedAt: Date.now() } : p));
        setToast(`✅ +${res.credited.toLocaleString()} ${SIL} added!`);
      } else {
        setToast(`Paid, but crediting failed: ${res.error}`);
      }
    } catch {
      setToast("Purchase failed");
    }
    setBuying(false);
  }

  // Запрос на продажу PV → SOL: сервер держит PV, выплата после ручного подтверждения.
  async function sellPvReq(pv: number) {
    if (!wallet) return setToast("Connect wallet first");
    if (!pet || Math.floor(pet.coins) < pv) return setToast(`Not enough ${SIL}`);
    setBuying(true);
    const res = await requestSell(pv);
    if ("coins" in res) {
      setPet((p) => (p ? { ...p, coins: res.coins, updatedAt: Date.now() } : p));
      setToast(`📨 Sell request: ${pv.toLocaleString()} ${SIL} → ◎${res.sol} (awaiting approval)`);
    } else {
      setToast(`Sell failed: ${res.error}`);
    }
    setBuying(false);
  }

  // Админ подтверждает (выплата SOL с казны) или отклоняет (возврат PV) заявку.
  async function doPayout(id: string, action: "approve" | "reject") {
    if (payoutBusy) return; // защита от двойного клика (сервер тоже атомарно защищён)
    setPayoutBusy(true);
    setToast(action === "approve" ? "Sending SOL from treasury…" : "Rejecting…");
    const res = await payoutSell(id, action);
    if ("ok" in res) {
      setToast(action === "approve" ? `✅ Paid out${res.sig ? ` (${shortAddress(res.sig)})` : ""}` : "↩️ Rejected — PV refunded");
      fetchSellRequests("pending").then((rows) => setAdminReqs(rows ?? []));
    } else {
      setToast(`Failed: ${res.error}`);
    }
    setPayoutBusy(false);
  }

  // Цена лекарства для воскрешения = база + за уровень питомца.
  function reviveCostFor(level: number): number {
    return REVIVE_BASE + REVIVE_PER_LEVEL * level;
  }

  // Сколько fullness тратит игра: 5 при заходе <7с, иначе 5 + 5 за каждые 20с игры.
  function playFullnessCost(durationMs: number): number {
    const sec = durationMs / 1000;
    return sec < 7 ? 5 : 5 + 5 * Math.floor(sec / 20);
  }

  // Итог боя в Игре №2. Победа → Sil + XP + забрать вещь + выигрыш ставки.
  function battleWin(kind: "accessory" | "food", id: string, bet: number) {
    if (!pet) return;
    const now = Date.now();
    const stake = Math.min(Math.max(0, bet), pet.coins); // выигрыш ставки (столько же, сколько поставил)
    const silReward = 40 + pet.level * 10;
    let xp = pet.xp + 60;
    let level = pet.level;
    while (xp >= xpForLevel(level)) { xp -= xpForLevel(level); level++; }
    let inventory = pet.inventory;
    let ownedAccessories = pet.ownedAccessories;
    let lootLabel = "loot";
    if (kind === "accessory") {
      if (!pet.ownedAccessories.includes(id)) ownedAccessories = [...pet.ownedAccessories, id];
      lootLabel = ACCESSORIES.find((a) => a.id === id)?.label ?? "an accessory";
    } else {
      inventory = { ...pet.inventory, [id]: (pet.inventory[id] ?? 0) + 1 };
      lootLabel = FOODS.find((f) => f.id === id)?.label ?? "food";
    }
    setPet({ ...pet, coins: pet.coins + silReward + stake, xp, level, battleWins: pet.battleWins + 1, inventory, ownedAccessories, updatedAt: now });
    if (wallet) submitArena({ wallet, name: pet.name, species: pet.species, power: loadoutPower(pet.level, pet.accessories, 0).power, wins: pet.battleWins + 1, losses: pet.battleLosses });
    setToast(`🏆 Victory! +${silReward}${stake ? `+${stake} bet` : ""} ${SIL}, +60 XP, looted ${lootLabel}`);
  }

  // Поражение: питомец теряет 10 HP (в обморок НЕ падает) и проигрывает ставку.
  function battleLose(bet: number) {
    if (!pet) return;
    const now = Date.now();
    const stake = Math.min(Math.max(0, bet), pet.coins);
    const health = Math.max(0, pet.stats.health - 10);
    setPet({ ...pet, stats: { ...pet.stats, health }, coins: pet.coins - stake, battleLosses: pet.battleLosses + 1, updatedAt: now });
    if (wallet) submitArena({ wallet, name: pet.name, species: pet.species, power: loadoutPower(pet.level, pet.accessories, 0).power, wins: pet.battleWins, losses: pet.battleLosses + 1 });
    setToast(`💔 Defeat! ${pet.name} took 10 damage${stake ? ` and lost ${stake} ${SIL}` : ""}`);
  }

  // Погладить питомца — даёт бафф «Cuddled»: −10% к распаду сытости и счастья на 1 час.
  function pat() {
    if (!pet || pet.stats.health <= 0) return;
    const now = Date.now();
    const buffs = [
      ...pet.buffs.filter((b) => b.kind !== "cuddled" && b.expiresAt > now),
      { kind: "cuddled" as BuffKind, expiresAt: now + BUFFS.cuddled.durationMs },
    ];
    setPet({ ...pet, buffs, updatedAt: now });
    setToast(`🤚 ${pet.name} feels loved — 🤚 Cuddled: −10% decay for 1h`);
  }
  // Воскресить мёртвого питомца за лекарство (покупается в магазине).
  function revivePet() {
    if (!pet || pet.stats.health > 0) return;
    const cost = reviveCostFor(pet.level);
    if (pet.coins < cost) return setToast(`Need ${cost} ${SIL} for medicine`);
    setPet({ ...pet, coins: pet.coins - cost, stats: { fullness: 60, happiness: 60, health: 60 }, updatedAt: Date.now() });
    setToast(`💊 ${pet.name} is back on its paws!`);
    setModal(null);
  }

  // Уровень любого питомца игрока (активного — из level, остальных — из progress).
  function petLevel(id: string): number {
    if (!pet) return 1;
    if (id === pet.species) return pet.level;
    return pet.progress[id]?.level ?? 1;
  }

  // Скрестить двух выбранных питомцев → новый случайный питомец (rare+), которого ещё нет.
  function breed() {
    if (!pet || breedSel.length !== 2) return;
    if (pet.coins < BREED_COST) return setToast(`Need ${BREED_COST} ${SIL}`);
    const missing = PETS.filter((p) => p.rarity !== "common" && !pet.ownedSpecies.includes(p.id));
    if (missing.length === 0) return setToast("You own every pet! 🎉");
    const rarity = rollRarity(BREED_ODDS);
    const pool = missing.filter((p) => p.rarity === rarity);
    const won = (pool.length ? pool : missing)[Math.floor(Math.random() * (pool.length ? pool.length : missing.length))];
    setPet({ ...pet, coins: pet.coins - BREED_COST, ownedSpecies: [...pet.ownedSpecies, won.id], updatedAt: Date.now() });
    setBred({ id: won.id, rarity: won.rarity });
  }
  function closeBreed() {
    setModal(null);
    setBreedSel([]);
    setBred(null);
  }

  // Switch the active species. Each pet keeps its OWN progress (level/xp/stats/buffs):
  // the current pet's progress is snapshotted, and the target's saved progress is loaded
  // (a freshly-won pet has none yet → starts at level 1).
  function switchSpecies(id: string) {
    // Переключиться можно только на питомца, которым уже владеешь. Стартовый базовый выбран при
    // создании — остальные базовые остаются недоступными.
    if (!pet || !pet.ownedSpecies.includes(id) || id === pet.species) return;
    if (!pet.names[id]) { setNamePet(id); setPetNameInput(""); return; } // нового пета сначала надо назвать
    doSwitch(id, pet.names);
  }
  // Собственно переключение активного питомца (имя берём из карты names).
  function doSwitch(id: string, names: Record<string, string>) {
    if (!pet) return;
    const now = Date.now();
    const progress = { ...pet.progress, [pet.species]: { stats: pet.stats, xp: pet.xp, level: pet.level, buffs: pet.buffs } };
    const saved = progress[id];
    const next = saved ?? { stats: { fullness: 100, happiness: 100, health: 100 }, xp: 0, level: 1, buffs: [] };
    delete progress[id]; // it's the active pet now
    setPet({ ...pet, species: id as PetId, name: names[id], names, stats: next.stats, xp: next.xp, level: next.level, buffs: next.buffs, progress, updatedAt: now });
  }
  // Назвать нового пета и сразу выбрать его.
  function confirmPetName() {
    if (!pet || !namePet || !petNameInput.trim()) return;
    const names = { ...pet.names, [namePet]: petNameInput.trim() };
    doSwitch(namePet, names);
    setNamePet(null);
    setPetNameInput("");
  }

  // Equip / unequip an owned accessory. Only one per type (one cap, one leash, etc.).
  function toggleAccessory(id: string) {
    if (!pet) return;
    const acc = accById(id);
    if (!acc) return;
    const worn = pet.accessories.includes(id);
    let next: string[];
    if (worn) {
      next = pet.accessories.filter((a) => a !== id);
    } else {
      // Remove any other equipped accessory of the same type, then add this one.
      const sameType: string[] = ACCESSORIES.filter((a) => a.type === acc.type).map((a) => a.id);
      next = [...pet.accessories.filter((a) => !sameType.includes(a)), id];
    }
    setPet({ ...pet, accessories: next });
  }

  const dailyReady = pet ? Date.now() - pet.lastDaily >= DAILY_COOLDOWN : false;
  function claimDaily() {
    if (!pet || !dailyReady) return;
    const sp = speciesEffect(pet.species);
    const potEff = potionEffects(pet.potions, Date.now());
    const dailyMult = equippedBonuses(pet.accessories).daily * (1 + sp.acc) + sp.daily + potEff.daily;
    const amount = Math.round(DAILY_REWARD * (1 + dailyMult));
    setPet({ ...pet, coins: pet.coins + amount, lastDaily: Date.now(), updatedAt: Date.now() });
    setToast(`Daily reward: +${amount} ${SIL}`);
  }

  // Купить зелье → в инвентарь зелий (не выпивается сразу).
  function buyPotion(p: Potion) {
    if (!pet) return;
    const cost = price(p.cost);
    if (pet.coins < cost) return setToast(`Not enough ${SIL}`);
    setPet({ ...pet, coins: pet.coins - cost, potionInv: { ...pet.potionInv, [p.id]: (pet.potionInv[p.id] ?? 0) + 1 } });
    setToast(`Bought ${p.label} ${p.emoji}`);
  }
  // Выпить зелье → активирует временный бафф (обновляет таймер, если такое уже активно).
  function drinkPotion(id: string) {
    if (!pet || (pet.potionInv[id] ?? 0) <= 0) return;
    const p = potionById(id);
    if (!p) return;
    const now = Date.now();
    const potions = [...pet.potions.filter((x) => x.id !== id && x.expiresAt > now), { id, expiresAt: now + p.durationMs }];
    setPet({ ...pet, potionInv: { ...pet.potionInv, [id]: pet.potionInv[id] - 1 }, potions, updatedAt: now });
    setToast(`${p.emoji} ${p.label} active — ${p.desc}`);
  }

  // Забрать награду за выполненный квест (в SOL) и убрать его из списка.
  function claimQuest(id: string, reward: number) {
    if (!pet || pet.questClaimed.includes(id)) return;
    setPet({ ...pet, sol: +(pet.sol + reward).toFixed(4), questClaimed: [...pet.questClaimed, id], updatedAt: Date.now() });
    setToast(`✅ Quest complete! +◎${reward} SOL`);
  }
  // Закрыть (скрыть) квест локально. Общее для всех игроков закрытие — с бэкендом.
  function dismissQuest(id: string) {
    if (!pet || pet.questClaimed.includes(id)) return;
    setPet({ ...pet, questClaimed: [...pet.questClaimed, id] });
  }

  // Выставить своего питомца на продажу. Ключевая механика: листинг = ЭСКРОУ — пета сразу
  // изымаем из инвентаря продавца (локально + сразу в облако), его данные хранит сам лот.
  // Так автосейв продавца не «вернёт» проданного пета. Активного пета выставлять нельзя.
  async function listPet() {
    if (!pet) return;
    const species = listSpecies;
    const askPrice = parseFloat(listPrice);
    if (!species || !pet.ownedSpecies.includes(species)) return setToast("Pick a pet to list");
    if (species === pet.species) return setToast("Switch to another pet before listing this one");
    if (!(askPrice > 0)) return setToast("Enter a valid SOL price");
    if (wallet && isCloudEnabled() && !verified) return setToast("Verify your wallet first (wallet menu)");
    if (listBusy) return; // защита от двойного клика (иначе один пет уйдёт в два лота)
    setListBusy(true);
    const lvl = pet.progress[species]?.level ?? 1;
    const buffs = pet.progress[species]?.buffs ?? [];
    const name = pet.names[species] ?? "";
    const id = `l${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    setListSpecies("");
    setListPrice("");
    // Изымаем пета из инвентаря продавца (species остаётся в names — пригодится при возврате).
    const progress = { ...pet.progress };
    delete progress[species];
    const base = { ...pet, ownedSpecies: pet.ownedSpecies.filter((s) => s !== species), progress, updatedAt: Date.now() };
    if (wallet && isCloudEnabled()) {
      setPet(base);
      saveCloudSave(wallet, base); // сразу фиксируем изъятие, чтобы автосейв не вернул пета
      await createListing({ id, seller: wallet, kind: "sale", species, level: lvl, buffs, price: askPrice, name });
      fetchListings("sale").then(setMarketListings);
    } else {
      // Локальный лот (без облака) — виден только тебе.
      setPet({ ...base, listings: [...base.listings, { id, kind: "sale", species, level: lvl, buffs, price: askPrice, createdAt: Date.now() } as MarketListing] });
    }
    setToast("🏷️ Pet listed for sale");
    setListBusy(false);
  }

  // Вернуть эскроу-пета продавцу (в ownedSpecies/progress/names). Имя берём из лота или из своей карты.
  function restorePet(species: string, level: number, buffs: { kind: BuffKind; expiresAt: number }[], name?: string) {
    if (!pet || pet.ownedSpecies.includes(species)) return;
    const nm = name || pet.names[species];
    const updated = {
      ...pet,
      ownedSpecies: [...pet.ownedSpecies, species],
      progress: { ...pet.progress, [species]: { stats: { fullness: 100, happiness: 100, health: 100 }, xp: 0, level: level || 1, buffs: buffs ?? [] } },
      names: nm ? { ...pet.names, [species]: nm } : pet.names,
      updatedAt: Date.now(),
    };
    setPet(updated);
    if (wallet && isCloudEnabled()) saveCloudSave(wallet, updated);
  }

  // Снять свой лот с продажи и вернуть пета. Если лот уже куплен — вернуть нечего.
  async function cancelListing(id: string) {
    if (!pet) return;
    if (wallet && isCloudEnabled()) {
      const deleted = await deleteListing(id, wallet);
      fetchListings("sale").then(setMarketListings);
      if (deleted && deleted.length > 0) {
        const lot = deleted[0];
        restorePet(lot.species, lot.level, lot.buffs ?? [], lot.name);
      } else if (deleted && deleted.length === 0) {
        setToast("This pet was already sold");
      }
    } else {
      const lot = pet.listings.find((l) => l.id === id);
      setPet({ ...pet, listings: pet.listings.filter((l) => l.id !== id) });
      if (lot) restorePet(lot.species, lot.level, lot.buffs ?? []);
    }
  }

  // Купить пета с рынка игроков за реальный SOL (оплата в казну → сервер проверяет tx и передаёт пета).
  async function buyPet(listing: { id: string; species: string; price: number; seller: string }) {
    if (!wallet) return setToast("Connect wallet first");
    if (!verified) return setToast("Verify your wallet first (wallet menu)");
    if (listing.seller === wallet) return setToast("That's your own listing");
    if (pet && pet.ownedSpecies.includes(listing.species)) return setToast("You already own this pet");
    const label = PETS.find((p) => p.id === listing.species)?.label ?? "pet";
    setBuying(true);
    setToast("Confirm the payment in Phantom…");
    try {
      const sig = await sendSolPayment(listing.price);
      if (!sig) { setBuying(false); return setToast("Payment cancelled"); }
      setToast("Verifying payment on-chain…");
      const res = await confirmMarketBuy("sale", listing.id, sig, wallet);
      if ("save" in res) {
        // Берём из ответа только смену владения — свой локальный прогресс (монеты и т.п.) сохраняем.
        setPet((p) => {
          if (!p) return res.save;
          const merged = { ...p, ownedSpecies: res.save.ownedSpecies, progress: res.save.progress, names: res.save.names, updatedAt: Date.now() };
          if (wallet) saveCloudSave(wallet, merged);
          return merged;
        });
        setToast(`✅ Bought ${label}! It's in your collection.`);
        fetchListings("sale").then(setMarketListings);
      } else {
        setToast(`Paid, but transfer failed: ${res.error}`);
      }
    } catch {
      setToast("Purchase failed");
    }
    setBuying(false);
  }

  // Купить эксклюзивного пета у казны за реальный SOL.
  async function buyExclusive(ex: Exclusive) {
    if (!wallet) return setToast("Connect wallet first");
    if (!verified) return setToast("Verify your wallet first (wallet menu)");
    if (pet && pet.ownedSpecies.includes(ex.species)) return setToast("You already own this pet");
    const label = PETS.find((p) => p.id === ex.species)?.label ?? "pet";
    setBuying(true);
    setToast("Confirm the payment in Phantom…");
    try {
      const sig = await sendSolPayment(ex.price);
      if (!sig) { setBuying(false); return setToast("Payment cancelled"); }
      setToast("Verifying payment on-chain…");
      const res = await confirmMarketBuy("exclusive", ex.id, sig, wallet);
      if ("save" in res) {
        setPet((p) => {
          if (!p) return res.save;
          const merged = { ...p, ownedSpecies: res.save.ownedSpecies, progress: res.save.progress, names: res.save.names, updatedAt: Date.now() };
          if (wallet) saveCloudSave(wallet, merged);
          return merged;
        });
        setToast(`✨ Bought exclusive ${label}!`);
        fetchExclusives().then(setExclusives);
      } else {
        setToast(`Paid, but grant failed: ${res.error}`);
      }
    } catch {
      setToast("Purchase failed");
    }
    setBuying(false);
  }

  // Админ: добавить эксклюзивного пета на витрину (лимитированный тираж).
  async function addExclusive() {
    if (!isAdmin) return;
    if (!verified) return setToast("Verify your admin wallet first");
    const species = exSpecies;
    const price = parseFloat(exPrice);
    const stock = Math.max(1, parseInt(exStock) || 1);
    if (!species) return setToast("Pick a species");
    if (!(price > 0)) return setToast("Enter a valid SOL price");
    const id = `x${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const ok = await createExclusive({ id, species, name: "", price, stock, sold: 0, active: true });
    if (ok) {
      setToast("✨ Exclusive added");
      setExSpecies("");
      setExPrice("");
      setExStock("1");
      fetchExclusives().then(setExclusives);
    } else {
      setToast("Failed to add exclusive");
    }
  }

  // Админ: убрать эксклюзив с витрины.
  async function removeExclusive(id: string) {
    if (!isAdmin) return;
    const ok = await deleteExclusive(id);
    if (ok) fetchExclusives().then(setExclusives);
    else setToast("Failed to remove");
  }

  const pickedInfo = PETS.find((p) => p.id === picked);
  // Базовые (обычные) питомцы не умирают — экран смерти только для rare+ питомцев.
  const dead = !!pet && pet.stats.health <= 0 && !isBasePet(pet.species);
  const reviveCost = pet ? reviveCostFor(pet.level) : 0;
  const cap = pet ? statCap(pet.level) : 100; // макс fullness/happiness (растёт с уровнем)
  // Питомцы игрока уровня BREED_LEVEL+ — кандидаты в родители для скрещивания.
  const breedEligible = pet ? pet.ownedSpecies.filter((id) => petLevel(id) >= BREED_LEVEL) : [];
  // Активные эффекты зелий (для показа ставки Sil/мин и силы арены).
  const potEff = pet ? potionEffects(pet.potions, Date.now()) : { sil: 0, power: 0, decay: 0, xp: 0, daily: 0 };
  const silPerMin = pet ? silRate(pet.accessories, pet.species) * (1 + potEff.sil) : 0;
  // Прогресс квеста по его метрике (выводится из полей сейва).
  function questValue(metric: string): number {
    if (!pet) return 0;
    if (metric === "battleWins") return pet.battleWins;
    if (metric === "level") return pet.level;
    if (metric === "bestScore") return pet.bestScore;
    if (metric === "ownedPets") return pet.ownedSpecies.length;
    if (metric === "coins") return Math.floor(pet.coins);
    return 0;
  }
  const activeQuests = pet ? QUESTS.filter((q) => !pet.questClaimed.includes(q.id)) : [];

  function mood(s: Stats): string {
    if (s.health <= 0) return "is very sick… take care of me!";
    if (s.fullness <= 20) return "is hungry 🍖";
    if (s.happiness <= 20) return "is bored 🥺";
    if (s.fullness >= 70 && s.happiness >= 70) return "is happy and healthy! 💛";
    return "is doing okay.";
  }

  function dailyLeft(): string {
    if (!pet) return "";
    const ms = pet.lastDaily + DAILY_COOLDOWN - Date.now();
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }

  // Inventory entries the pet actually owns (qty > 0).
  const ownedItems = pet
    ? FOODS.filter((f) => (pet.inventory[f.id] ?? 0) > 0).map((f) => ({ food: f, qty: pet.inventory[f.id] }))
    : [];
  const ownedAcc = pet ? ACCESSORIES.filter((a) => pet.ownedAccessories.includes(a.id)) : [];
  // Питомцы для коллекции/переключения: только выбиваемые из сундука (rare и выше).
  // Стартовые обычные (dog/cat/hamster) в этот список не попадают.
  const collectiblePets = PETS.filter((p) => p.rarity !== "common");
  // Базовые питомцы, которыми игрок уже владеет — их тоже показываем в списке переключения.
  // Все базовые питомцы (dog/cat/hamster) всегда доступны для переключения — не только стартовый.
  const basePets = PETS.filter((p) => p.rarity === "common");

  // Preview data: the pool of possible drops + per-item chance for the clicked chest.
  const previewData = (() => {
    if (!preview) return null;
    const odds = preview.chest.odds as Partial<Record<Rarity, number>>;
    const all = (preview.kind === "food" ? FOODS : preview.kind === "accessory" ? ACCESSORIES : PETS) as readonly PoolItem[];
    const pool = all.filter((i) => (odds[i.rarity] ?? 0) > 0);
    const counts: Partial<Record<Rarity, number>> = {};
    pool.forEach((i) => { counts[i.rarity] = (counts[i.rarity] ?? 0) + 1; });
    const chanceOf = (i: PoolItem) => ((odds[i.rarity] ?? 0) / (counts[i.rarity] || 1));
    return { pool, chanceOf };
  })();

  // Подсказка для предмета в превью сундука: те же характеристики, что и в инвентаре.
  function chestItemTitle(i: PoolItem): string {
    if (!preview) return i.label;
    if (preview.kind === "food") {
      const f = FOODS.find((x) => x.id === i.id);
      return f ? foodTitle(f) : i.label;
    }
    if (preview.kind === "accessory") {
      const a = accById(i.id);
      const crit = accCrit(i.rarity);
      const critTxt = crit ? ` · 💥 ${Math.round(crit.chance * 100)}% crit` : "";
      return `${RARITY[i.rarity].label} · ${a ? accDesc(a.type, i.rarity) : ""} · ⚔️+${accPower(i.rarity)} ❤️+${accHp(i.rarity)}${critTxt}`;
    }
    // pet
    const perk = SPECIES_PERK[i.id]?.label;
    return `${RARITY[i.rarity].label}${perk ? ` · ✨ ${perk}` : " · Starter pet"}`;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">Petaverse</span>
          <span className="tagline">your onchain pet world</span>
        </div>
        <div className="topbar-right">
          <div className="wallet-wrap">
            {wallet ? (
              <button className="wallet-btn wallet-on" onClick={() => setWalletMenu((v) => !v)} title={verified ? "Verified" : "Connected (not verified)"}>
                <span className={"wallet-dot" + (verified ? "" : " wallet-dot-unverified")} /> {shortAddress(wallet)}
              </button>
            ) : (
              <button className="wallet-btn" onClick={connectWallet}>Connect wallet</button>
            )}
            {wallet && walletMenu && (
              <>
                <div className="wallet-scrim" onClick={() => setWalletMenu(false)} />
                <div className="wallet-menu">
                  <div className="wallet-addr" title={wallet}>{shortAddress(wallet)}</div>
                  {verified ? (
                    <div className="wallet-verified">✓ Verified</div>
                  ) : (
                    <button className="wallet-menu-btn" onClick={() => verifyWallet()}>🔏 Verify wallet</button>
                  )}
                  {isAdmin && (
                    <button className="wallet-menu-btn" onClick={() => { setWalletMenu(false); setModal("admin"); }}>🛠️ Sell requests</button>
                  )}
                  <button className="wallet-menu-btn" onClick={() => { navigator.clipboard?.writeText(wallet); setToast("Address copied"); setWalletMenu(false); }}>Copy address</button>
                  <button className="wallet-menu-btn wallet-disc" onClick={disconnectWallet}>Disconnect</button>
                </div>
              </>
            )}
          </div>
          {pet && (
            <span className="balance-pill" title={`+${+silPerMin.toFixed(2)} ${SIL}/min passive`}>
              <Coin />
              <span className="balance-amt">{Math.floor(pet.coins).toLocaleString()}</span>
              <span className="balance-cur">{SIL}</span>
              <span className="rate">+{+silPerMin.toFixed(2)}/min</span>
            </span>
          )}
          {pet && (
            <button className="buy-sil-btn" title="Exchange PV ↔ SOL" onClick={() => setModal("buysil")}>+</button>
          )}
          {pet && (
            <button className="market-btn" title="Marketplace — trade items for SOL" onClick={() => setModal("market")}>🛍️ Market</button>
          )}
        </div>
      </header>

      {cloudLoading && !pet ? (
        // ===== Cloud sync loading =====
        <main className="stage">
          <h1 className="title">Syncing…</h1>
          <p className="subtitle">Loading your pet from the cloud ☁️</p>
        </main>
      ) : !pet ? (
        // ===== Create screen =====
        <main className="stage">
          <h1 className="title">Choose your pet</h1>
          <p className="subtitle">Who will you raise?</p>

          <div className="pet-grid">
            {STARTER_PETS.map((p) => (
              <button
                key={p.id}
                className={"pet-card" + (picked === p.id ? " pet-card-on" : "")}
                onClick={() => setPicked(p.id)}
              >
                <span className="pet-emoji"><PetArt species={p.id} size={56} /></span>
                <span className="pet-label">{p.label}</span>
              </button>
            ))}
          </div>

          {picked && (
            <div className="name-row">
              <input
                className="name-input"
                placeholder={`Name your ${pickedInfo?.label.toLowerCase()}`}
                value={name}
                maxLength={20}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createPet()}
              />
              <button className="btn btn-primary" disabled={!name.trim()} onClick={createPet}>
                Create
              </button>
            </div>
          )}
        </main>
      ) : (
        // ===== Pet screen =====
        <main className="stage">
          <div className={"pet-view" + (dead ? " pet-view-dead" : "")}>
            {dead ? (
              // ===== Death screen =====
              <div className="death-screen">
                <div className="death-art">
                  <span className="death-art-pet"><PetArt species={pet.species} size={120} /></span>
                  <span className="death-skull">💀</span>
                </div>
                <h2 className="death-title">Fainted</h2>
                <p className="death-name">{pet.name}</p>
                <p className="subtitle">{pet.name} collapsed from neglect… 💔</p>
                <div className="death-revive">
                  <span className="death-cost">💊 Revive medicine — {reviveCost} {SIL}</span>
                  <button className="btn btn-primary" disabled={pet.coins < reviveCost} onClick={revivePet}>
                    {pet.coins >= reviveCost ? `💊 Revive ${pet.name}` : `Need ${reviveCost} ${SIL}`}
                  </button>
                </div>
                <div className="actions">
                  <button className="btn btn-secondary" onClick={() => setModal("shop")}>🛒 Shop</button>
                  <button className="btn btn-secondary" onClick={() => setModal("pets")}>🔄 Switch pet</button>
                </div>
              </div>
            ) : (
              <>
                <button className="pet-emoji-big pet-emoji-btn" onClick={() => setPetMenu(true)} title={`Interact with ${pet.name}`}>
                  <PetArt species={pet.species} size={110} />
                </button>

                <div className="slots">
                  {SLOTS.map((s) => {
                    const equipped = ACCESSORIES.find((a) => a.type === s.type && pet.accessories.includes(a.id));
                    return (
                      <button
                        key={s.type}
                        className={"slot" + (equipped ? " slot-filled" : " slot-empty")}
                        onClick={() => setAccPicker(s.type)}
                        title={equipped ? equipped.label : `Empty ${s.label} slot`}
                      >
                        <span className="slot-emoji">{equipped ? equipped.emoji : s.ghost}</span>
                      </button>
                    );
                  })}
                </div>

                <h2 className="pet-name">{pet.name}</h2>
                <p className="subtitle">{pet.name} {mood(pet.stats)}</p>
                {SPECIES_PERK[pet.species] && <p className="perk-line">✨ {SPECIES_PERK[pet.species].label}</p>}

                <div className="stats">
                  <StatBar label="Fullness" value={pet.stats.fullness} max={cap} color="#ffb020" />
                  <StatBar label="Happiness" value={pet.stats.happiness} max={cap} color="#ff7ac8" />
                  <StatBar label="Health" value={pet.stats.health} color="#1ad17a" />
                  {/* XP / level */}
                  <div className="stat">
                    <div className="stat-head">
                      <span>Level {pet.level}</span>
                      <span className="stat-val">{Math.floor(pet.xp)} / {xpForLevel(pet.level)} XP</span>
                    </div>
                    <div className="stat-track">
                      <div className="stat-fill" style={{ width: `${(pet.xp / xpForLevel(pet.level)) * 100}%`, background: "#7aa2ff" }} />
                    </div>
                  </div>
                </div>

                {(() => {
                  const active = pet.buffs.filter((b) => b.expiresAt > Date.now());
                  if (active.length === 0) return null;
                  const chip = (b: { kind: BuffKind; expiresAt: number }) => {
                    const m = BUFFS[b.kind];
                    const left = Math.max(0, b.expiresAt - Date.now());
                    const mm = Math.floor(left / 60000);
                    const ss = Math.floor((left % 60000) / 1000);
                    return (
                      <span key={b.kind} className="buff-chip" title={`${m.label}`}>
                        {m.emoji} {m.label} {mm}:{String(ss).padStart(2, "0")}
                      </span>
                    );
                  };
                  // До 2 баффов — показываем сразу; больше — прячем под стрелку.
                  if (active.length <= 2) return <div className="buffs">{active.map(chip)}</div>;
                  return (
                    <div className="buffs-wrap">
                      <button className="buffs-arrow" onClick={() => setShowBuffs((s) => !s)}>
                        ✨ {active.length} buffs <span className={"buffs-caret" + (showBuffs ? " open" : "")}>▾</span>
                      </button>
                      {showBuffs && <div className="buff-pop">{active.map(chip)}</div>}
                    </div>
                  );
                })()}

                <div className="actions">
                  <button className="btn btn-primary" onClick={() => setModal("inventory")}>🎒 Inventory</button>
                  <button className="btn btn-secondary" onClick={() => setModal("shop")}>🛒 Shop</button>
                  <button className="btn btn-secondary" onClick={() => setModal("playmenu")}>🎾 Play</button>
                  <button className="btn btn-secondary" onClick={() => setModal("roulette")}>🎰 Roulette</button>
                  <button className="btn btn-secondary" onClick={() => setModal("breed")}>🧬 Breed</button>
                  <button className="btn btn-secondary" onClick={() => setModal("leaderboard")}>🏆 Ranks</button>
                </div>

                <button className="btn btn-daily" disabled={!dailyReady} onClick={claimDaily}>
                  {dailyReady ? `🎁 Claim daily +${DAILY_REWARD} ${SIL}` : `🎁 Daily in ${dailyLeft()}`}
                </button>
              </>
            )}
          </div>
        </main>
      )}

      <footer className="footer">Petaverse · made on Solana</footer>

      {/* ===== Social links (bottom-left) ===== */}
      <div className="social-bar">
        <a className="social-btn" href={LINK_GITHUB} target="_blank" rel="noreferrer" title="GitHub" aria-label="GitHub">
          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 012-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
        <a className="social-btn" href={LINK_TWITTER} target="_blank" rel="noreferrer" title="X (Twitter)" aria-label="X">𝕏</a>
        <button className="social-btn social-pump" title="pump.fun" onClick={() => setModal("pumpfun")}>💊</button>
      </div>

      {/* ===== Quests (bottom-right, collapsible) ===== */}
      {pet && !dead && !modal && !petMenu && activeQuests.length > 0 && (
        <div className={"quest-panel" + (questsOpen ? "" : " quest-panel-closed")}>
          <button className="quest-head" onClick={() => setQuestsOpen((o) => !o)} title={questsOpen ? "Hide quests" : "Show quests"}>
            <span>📋 Quests ({activeQuests.length})</span>
            <span className={"quest-caret" + (questsOpen ? " open" : "")}>▾</span>
          </button>
          {questsOpen && activeQuests.map((q) => {
            const val = questValue(q.metric);
            const done = val >= q.goal;
            const pct = Math.min(100, (val / q.goal) * 100);
            return (
              <div key={q.id} className="quest-row">
                <div className="quest-top">
                  <span className="quest-label">{q.emoji} {q.label}</span>
                  <button className="quest-x" onClick={() => dismissQuest(q.id)} title="Hide quest">✕</button>
                </div>
                {done ? (
                  <button className="quest-claim" onClick={() => claimQuest(q.id, q.reward)}>✅ Claim ◎{q.reward} SOL</button>
                ) : (
                  <>
                    <div className="quest-track"><div className="quest-fill" style={{ width: `${pct}%` }} /></div>
                    <div className="quest-prog">{Math.min(val, q.goal).toLocaleString()} / {q.goal.toLocaleString()} · ◎{q.reward} SOL</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== Shop ===== */}
      {modal === "shop" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Shop</h3>
              <span className="coins"><Coin /> {Math.floor(pet.coins)} {SIL}</span>
            </div>

            <div className="section-label">Medicine</div>
            <div className="shop-list">
              <div className="shop-item shop-item-rare" title="Revive a fainted pet">
                <span className="shop-emoji">💊</span>
                <div className="shop-info">
                  <span className="shop-name">Revive Potion</span>
                  <span className="shop-effect">{dead ? `Bring ${pet.name} back to life` : "Only works when your pet has fainted"}</span>
                </div>
                <button className="btn btn-primary btn-buy" disabled={!dead || pet.coins < reviveCost} onClick={revivePet}>
                  <Coin /> {reviveCost}
                </button>
              </div>
            </div>

            <div className="section-label">Food chests</div>
            <div className="chest-row">
              {FOOD_CHESTS.map((c) => (
                <button key={c.id} className="chest-card" onClick={() => setPreview({ kind: "food", chest: c })}>
                  <span className="chest-emoji">{c.emoji}</span>
                  <span className="chest-name" style={{ color: RARITY[bestTier(c.odds)].color }}>{c.label}</span>
                </button>
              ))}
            </div>

            <div className="section-label">Accessory chests</div>
            <div className="chest-row">
              {ACC_CHESTS.map((c) => (
                <button key={c.id} className="chest-card" onClick={() => setPreview({ kind: "accessory", chest: c })}>
                  <span className="chest-emoji">{c.emoji}</span>
                  <span className="chest-name" style={{ color: RARITY[bestTier(c.odds)].color }}>{c.label}</span>
                </button>
              ))}
            </div>

            <div className="section-label">Pet chests</div>
            <div className="chest-row">
              {PET_CHESTS.map((c) => (
                <button key={c.id} className="chest-card" onClick={() => setPreview({ kind: "pet", chest: c })}>
                  <span className="chest-emoji">{c.emoji}</span>
                  <span className="chest-name" style={{ color: RARITY[bestTier(c.odds)].color }}>{c.label}</span>
                </button>
              ))}
            </div>

            <div className="section-label">Food</div>
            <div className="shop-list">
              {FOODS.map((f) => (
                <div className={"shop-item" + (f.rarity !== "common" ? " shop-item-rare" : "")} key={f.id} title={foodTitle(f)}>
                  <span className="shop-emoji">{f.emoji}</span>
                  <div className="shop-info">
                    <span className="shop-name">
                      {f.label}
                      {f.rarity !== "common" && (
                        <span className="rare-badge" style={{ background: RARITY[f.rarity].color, color: "#1a1205" }}>
                          {RARITY[f.rarity].label}
                        </span>
                      )}
                    </span>
                    <span className="shop-effect">
                      +{f.fullness} fullness{f.happiness ? ` · +${f.happiness} happy` : ""}
                    </span>
                  </div>
                  <button className="btn btn-primary btn-buy" disabled={pet.coins < price(f.cost)} onClick={() => buyFood(f)}>
                    <Coin /> {price(f.cost)}
                  </button>
                </div>
              ))}
            </div>

            <div className="section-label">Potions — temporary boosts</div>
            <div className="shop-list">
              {POTIONS.map((p) => (
                <div className="shop-item shop-item-rare" key={p.id} title={potionTitle(p)}>
                  <span className="shop-emoji">{p.emoji}</span>
                  <div className="shop-info">
                    <span className="shop-name">{p.label}</span>
                    <span className="shop-effect">{p.desc} · {Math.round(p.durationMs / 60000)}m</span>
                  </div>
                  <button className="btn btn-primary btn-buy" disabled={pet.coins < price(p.cost)} onClick={() => buyPotion(p)}>
                    <Coin /> {price(p.cost)}
                  </button>
                </div>
              ))}
            </div>

            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Potions (drink) ===== */}
      {modal === "potions" && pet && (() => {
        const now = Date.now();
        const active = pet.potions.filter((x) => x.expiresAt > now);
        const owned = POTIONS.filter((p) => (pet.potionInv[p.id] ?? 0) > 0);
        return (
          <div className="scrim" onClick={() => setModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>🧪 Potions</h3>
                <span className="coins"><Coin /> {Math.floor(pet.coins)} {SIL}</span>
              </div>
              <p className="subtitle" style={{ marginTop: -4 }}>Drink potions for temporary boosts. Buy more in the Shop 🛒</p>

              {active.length > 0 && (
                <>
                  <div className="section-label">Active</div>
                  <div className="buffs">
                    {active.map((a) => {
                      const p = potionById(a.id);
                      if (!p) return null;
                      const left = Math.max(0, a.expiresAt - now);
                      const mm = Math.floor(left / 60000);
                      const ss = Math.floor((left % 60000) / 1000);
                      return <span key={a.id} className="buff-chip" title={p.desc}>{p.emoji} {p.desc} {mm}:{String(ss).padStart(2, "0")}</span>;
                    })}
                  </div>
                </>
              )}

              <div className="section-label">Your potions</div>
              {owned.length === 0 ? (
                <p className="empty">No potions yet — buy some in the Shop 🛒</p>
              ) : (
                <div className="inv-grid">
                  {owned.map((p) => (
                    <button key={p.id} className="inv-item inv-item-rare" onClick={() => drinkPotion(p.id)} title={potionTitle(p)}>
                      <span className="inv-qty">×{pet.potionInv[p.id]}</span>
                      <span className="inv-emoji">{p.emoji}</span>
                      <span className="inv-name">{p.label}</span>
                      <span className="inv-feed">Drink</span>
                    </button>
                  ))}
                </div>
              )}
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* ===== Inventory ===== */}
      {modal === "inventory" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Inventory</h3>
              <span className="coins"><Coin /> {Math.floor(pet.coins)} {SIL}</span>
            </div>

            <div className="catalog">
              <div className="section-label">Food</div>
              {ownedItems.length === 0 ? (
                <p className="empty">No food yet — buy some or open a chest 🎁</p>
              ) : (
                <div className="inv-grid">
                  {ownedItems.map(({ food, qty }) => (
                    <button
                      key={food.id}
                      className={"inv-item" + (food.rarity !== "common" ? " inv-item-rare" : "")}
                      onClick={() => feedFromInventory(food)}
                      title={foodTitle(food)}
                    >
                      <span className="inv-qty">×{qty}</span>
                      <span className="rar-dot" style={{ background: RARITY[food.rarity].color }} />
                      <span className="inv-emoji">{food.emoji}</span>
                      <span className="inv-name">{food.label}</span>
                      <span className="inv-feed">Feed</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="section-label">Accessories</div>
              {ownedAcc.length === 0 ? (
                <p className="empty">No accessories yet — win some from a chest 🎀</p>
              ) : (
                <div className="inv-grid">
                  {ownedAcc.map((a) => {
                    const worn = pet.accessories.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        className={"inv-item" + (worn ? " inv-item-rare" : "")}
                        onClick={() => toggleAccessory(a.id)}
                        title={`${RARITY[a.rarity].label} · ${accDesc(a.type, a.rarity)}`}
                      >
                        <span className="rar-dot" style={{ background: RARITY[a.rarity].color }} />
                        <span className="inv-emoji">{a.emoji}</span>
                        <span className="inv-name">{a.label}</span>
                        <span className="inv-feed">{worn ? "Worn ✓" : "Wear"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Leaderboard ===== */}
      {modal === "leaderboard" && pet && (() => {
        const cloud = isCloudEnabled();
        const loading = cloud && !lbLoaded;
        const realMode = cloud && lbLoaded && topScores !== null; // есть живой топ из Supabase
        // Строки для показа + ранг игрока (0 = вне топа / нет счёта).
        let rows: { key: string; name: string; score: number; you: boolean }[];
        let myRank: number;
        if (realMode) {
          rows = topScores!.map((r) => ({
            key: r.wallet,
            name: (r.name && r.name.trim()) || shortAddress(r.wallet),
            score: r.score,
            you: !!wallet && r.wallet === wallet,
          }));
          const idx = wallet ? topScores!.findIndex((r) => r.wallet === wallet) : -1;
          myRank = idx >= 0 ? idx + 1 : 0;
        } else {
          rows = [
            ...LEADERBOARD_BOTS.map((b) => ({ key: b.name, name: b.name, score: b.score, you: false })),
            { key: "you", name: pet.name, score: pet.bestScore, you: true },
          ].sort((a, b) => b.score - a.score);
          myRank = rows.findIndex((r) => r.you) + 1;
        }
        const inTop = myRank > 0;
        const reward = inTop ? runRewardForRank(myRank) : pet.bestScore > 0 ? 50 : 0;
        const left = pet.lastRunReward + RUN_REWARD_COOLDOWN - Date.now();
        const canReward = realMode ? !!wallet && pet.bestScore > 0 : pet.bestScore > 0;
        const rewardReady = canReward && left <= 0;
        const showMyRow = realMode && !!wallet && pet.bestScore > 0 && !inTop; // в игре, но не в топ-20
        function claimRunReward() {
          if (!rewardReady) return;
          addCoins(reward);
          setPet((p) => (p ? { ...p, lastRunReward: Date.now(), updatedAt: Date.now() } : p));
          setToast(`🏆 Run reward${inTop ? ` (rank #${myRank})` : ""}: +${reward} ${SIL}`);
        }
        const hh = Math.max(0, Math.floor(left / 3_600_000));
        const mm = Math.max(0, Math.floor((left % 3_600_000) / 60_000));
        return (
          <div className="scrim" onClick={() => setModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>🏆 {realMode ? "Global top runs" : "Top runs"}</h3>
              </div>
              <p className="subtitle" style={{ marginTop: -4 }}>
                {realMode ? "Best rhythm scores across all players. Top runs earn PV every hour." : "Best Play scores. Top runs earn PV every hour."}
              </p>
              {loading ? (
                <p className="empty">Loading the leaderboard… ⏳</p>
              ) : (
                <div className="lb-list">
                  {rows.length === 0 ? (
                    <p className="empty">No scores yet — be the first! 🎵</p>
                  ) : (
                    rows.map((r, i) => (
                      <div key={r.key} className={"lb-row" + (r.you ? " lb-you" : "")}>
                        <span className="lb-rank">{i + 1}</span>
                        <span className="lb-name">{r.name}{r.you ? " (you)" : ""}</span>
                        <span className="lb-sil">♪ {r.score.toLocaleString()}</span>
                      </div>
                    ))
                  )}
                  {showMyRow && (
                    <div className="lb-row lb-you">
                      <span className="lb-rank">—</span>
                      <span className="lb-name">{pet.name} (you)</span>
                      <span className="lb-sil">♪ {pet.bestScore.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}
              {realMode && !wallet && (
                <p className="empty">🔌 Connect your wallet to join the global leaderboard and earn PV.</p>
              )}
              <button className="btn btn-daily" disabled={!rewardReady} onClick={claimRunReward}>
                {!canReward
                  ? realMode && !wallet
                    ? "🔌 Connect wallet to earn"
                    : "🏆 Play a run to earn rewards"
                  : rewardReady
                  ? `🏆 Claim ${inTop ? `rank #${myRank} ` : ""}reward +${reward} ${SIL}`
                  : `🏆 Next reward in ${hh}h ${mm}m`}
              </button>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* ===== Sil Roulette ===== */}
      {modal === "roulette" && pet && (
        <Roulette coins={pet.coins} onClose={() => setModal(null)} addCoins={addCoins} />
      )}

      {/* ===== Play: rhythm mini-game ===== */}
      {modal === "play" && pet && (
        <RhythmGame
          petName={pet.name}
          petSpecies={pet.species}
          petEmoji={PETS.find((p) => p.id === pet.species)?.emoji ?? "🐾"}
          onClose={() => setModal(null)}
          onFinish={(score, happy, durationMs) => {
            const cost = playFullnessCost(durationMs);
            const prevBest = petRef.current?.bestScore ?? 0;
            setPet((p) =>
              p
                ? {
                    ...p,
                    stats: { ...p.stats, happiness: clamp(p.stats.happiness + happy), fullness: clamp(p.stats.fullness - cost) },
                    totalScore: p.totalScore + score,
                    bestScore: Math.max(p.bestScore, score),
                    updatedAt: Date.now(),
                  }
                : p,
            );
            // Новый личный рекорд → отправляем в глобальный лидерборд (если кошелёк подключён).
            if (wallet && score > prevBest && petRef.current) submitScore(wallet, petRef.current.name, score);
            setToast(`🎵 Score ${score} · +${happy} happy · −${cost} fullness`);
          }}
        />
      )}

      {/* ===== Marketplace ===== */}
      {modal === "market" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>🛍️ Marketplace</h3>
              <span className="coins">◎ {pet.sol} SOL</span>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>Buy and sell pets for real <b>SOL</b> — paid straight from your Phantom wallet (devnet).</p>
            <div className="market-tabs">
              <button className={"market-tab" + (marketTab === "exclusive" ? " market-tab-on" : "")} onClick={() => setMarketTab("exclusive")}>✨ Exclusive</button>
              <button className={"market-tab" + (marketTab === "player" ? " market-tab-on" : "")} onClick={() => setMarketTab("player")}>👥 Player</button>
              <button className={"market-tab" + (marketTab === "auction" ? " market-tab-on" : "")} onClick={() => setMarketTab("auction")}>🔨 Auction</button>
            </div>

            {marketTab === "exclusive" && (() => {
              const cloud = isCloudEnabled();
              const loading = cloud && !exLoaded;
              const rows = exclusives ?? [];
              return (
                <>
                  {isAdmin && (
                    <>
                      <div className="section-label">Add an exclusive (admin)</div>
                      <p className="subtitle" style={{ marginTop: -4 }}>Drop a limited pet the community can only buy here, for SOL.</p>
                      <div className="list-controls">
                        <select className="name-input list-select" value={exSpecies} onChange={(e) => setExSpecies(e.target.value)}>
                          <option value="">Choose a species…</option>
                          {PETS.map((p) => <option key={p.id} value={p.id}>{p.label} · {RARITY[p.rarity].label}</option>)}
                        </select>
                        <input className="name-input list-price" type="number" min="0" step="0.01" placeholder="Price ◎" value={exPrice} onChange={(e) => setExPrice(e.target.value)} />
                        <input className="name-input list-price" type="number" min="1" step="1" placeholder="Qty" value={exStock} onChange={(e) => setExStock(e.target.value)} />
                        <button className="btn btn-primary" onClick={addExclusive}>✨ Add</button>
                      </div>
                    </>
                  )}

                  <div className="section-label">Exclusive pets</div>
                  <p className="subtitle" style={{ marginTop: -4 }}>Limited pets sold for <b>SOL</b> by Petaverse — grab them before they're gone.</p>
                  {loading ? (
                    <p className="empty">Loading exclusives… ⏳</p>
                  ) : rows.length === 0 ? (
                    <p className="empty">No exclusives right now — check back soon. ✨</p>
                  ) : (
                    <div className="inv-grid">
                      {rows.map((ex) => {
                        const info = PETS.find((p) => p.id === ex.species)!;
                        const owned = !!pet && pet.ownedSpecies.includes(ex.species);
                        const soldOut = (ex.stock ?? 0) <= 0;
                        return (
                          <div key={ex.id} className="inv-item inv-item-tall market-listing">
                            {isAdmin && <button className="mini-x" onClick={() => removeExclusive(ex.id)} title="Remove exclusive">✕</button>}
                            <span className="rar-dot" style={{ background: RARITY[info.rarity].color }} />
                            <span className="inv-emoji"><PetArt species={ex.species} size={34} /></span>
                            <span className="inv-name">{ex.name || info.label}</span>
                            <span className="inv-perk">{soldOut ? "sold out" : `${ex.stock} left`}</span>
                            <span className="inv-feed">◎ {ex.price}</span>
                            {cloud && (
                              <button className="btn btn-primary market-buy" disabled={buying || soldOut || owned} onClick={() => buyExclusive(ex)}>
                                {owned ? "Owned" : soldOut ? "Sold out" : "Buy"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {cloud && !wallet && <p className="empty" style={{ marginTop: 8 }}>🔌 Connect your wallet to buy exclusives.</p>}
                </>
              );
            })()}

            {marketTab === "player" && (() => {
              const cloud = isCloudEnabled();
              const loading = cloud && !marketLoaded;
              type Row = { id: string; species: string; level: number; price: number; buffs: { kind: BuffKind; expiresAt: number }[]; seller: string; mine: boolean };
              // Общие лоты из Supabase (видны всем) или локальные (без облака — только свои).
              const listings: Row[] = cloud
                ? (marketListings ?? []).map((l) => ({ id: l.id, species: l.species, level: l.level, price: l.price, buffs: l.buffs ?? [], seller: l.seller, mine: !!wallet && l.seller === wallet }))
                : pet.listings.filter((l) => l.kind === "sale").map((l) => ({ id: l.id, species: l.species, level: l.level, price: l.price, buffs: l.buffs, seller: "you", mine: true }));
              // Питомцев для листинга можно выставить только НЕактивных (активного продавать нельзя).
              const listable = pet.ownedSpecies.filter((id) => id !== pet.species);
              const netPct = (10000 - SOL_MARKET_FEE_BPS) / 100;
              return (
                <>
                  <div className="section-label">Sell a pet</div>
                  <p className="subtitle" style={{ marginTop: -4 }}>
                    List a pet for a fixed SOL price. Listing escrows it — it leaves your collection until sold or cancelled. You receive {netPct}% (a {SOL_MARKET_FEE_BPS / 100}% fee goes to the treasury).
                  </p>
                  {cloud && !wallet ? (
                    <p className="empty">🔌 Connect your wallet to list a pet on the market.</p>
                  ) : listable.length === 0 ? (
                    <p className="empty">Switch to another pet first — you can't sell your active one.</p>
                  ) : (
                    <div className="list-controls">
                      <select className="name-input list-select" value={listSpecies} onChange={(e) => setListSpecies(e.target.value)}>
                        <option value="">Choose a pet…</option>
                        {listable.map((id) => {
                          const info = PETS.find((p) => p.id === id)!;
                          const lvl = pet.progress[id]?.level ?? 1;
                          return <option key={id} value={id}>{info.label} · Lv {lvl}</option>;
                        })}
                      </select>
                      <input
                        className="name-input list-price"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Price ◎"
                        value={listPrice}
                        onChange={(e) => setListPrice(e.target.value)}
                      />
                      <button className="btn btn-primary" disabled={listBusy} onClick={listPet}>🏷️ List</button>
                    </div>
                  )}

                  <div className="section-label">Pets for sale</div>
                  {loading ? (
                    <p className="empty">Loading the market… ⏳</p>
                  ) : listings.length === 0 ? (
                    <p className="empty">No listings yet — be the first to list a pet!</p>
                  ) : (
                    <div className="inv-grid">
                      {listings.map((l) => {
                        const info = PETS.find((p) => p.id === l.species)!;
                        const activeBuffs = l.buffs.filter((b) => b.expiresAt > Date.now()).length;
                        const owned = !l.mine && !!pet && pet.ownedSpecies.includes(l.species);
                        return (
                          <div key={l.id} className="inv-item inv-item-tall market-listing">
                            {l.mine && <button className="mini-x" onClick={() => cancelListing(l.id)} title="Cancel listing">✕</button>}
                            <span className="rar-dot" style={{ background: RARITY[info.rarity].color }} />
                            <span className="inv-emoji"><PetArt species={l.species} size={34} /></span>
                            <span className="inv-name">{info.label}</span>
                            <span className="inv-perk">Lv {l.level}{activeBuffs ? ` · ✨${activeBuffs}` : ""}</span>
                            <span className="inv-feed">◎ {l.price}</span>
                            {l.mine ? (
                              <span className="market-seller">your listing</span>
                            ) : cloud ? (
                              <button className="btn btn-primary market-buy" disabled={buying || owned} onClick={() => buyPet(l)}>{owned ? "Owned" : "Buy"}</button>
                            ) : (
                              <span className="market-seller">you</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}

            {marketTab === "auction" && (
              <div className="market-empty">
                <div className="market-empty-emoji">🔨</div>
                <p className="empty">Live SOL auctions are coming soon — bid on rare pets and win them. Stay tuned!</p>
              </div>
            )}

            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Pet interaction menu ===== */}
      {petMenu && pet && (
        <div className="scrim" onClick={() => setPetMenu(false)}>
          <div className="pet-menu" onClick={(e) => e.stopPropagation()}>
            <div className="pet-menu-title">{PETS.find((p) => p.id === pet.species)?.emoji} {pet.name}</div>
            {dead ? (
              <>
                <button className="pet-menu-btn" onClick={() => { setPetMenu(false); setModal("shop"); }}>💊 Revive in Shop</button>
                <button className="pet-menu-btn" onClick={() => { setPetMenu(false); setModal("pets"); }}>🔄 Switch pet</button>
              </>
            ) : (
              <>
                <button className="pet-menu-btn" onClick={pat}>🤚 Pet</button>
                <button className="pet-menu-btn" onClick={() => { setPetMenu(false); setModal("potions"); }}>🧪 Potions</button>
                <button className="pet-menu-btn" onClick={() => { setPetMenu(false); setModal("pets"); }}>🔄 Switch pet</button>
              </>
            )}
            <button className="btn btn-ghost" onClick={() => setPetMenu(false)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Game 2: Battle Arena ===== */}
      {modal === "battle" && pet && (
        <BattleGame
          onClose={() => setModal(null)}
          onWin={battleWin}
          onLose={battleLose}
          petName={pet.name}
          petSpecies={pet.species}
          level={pet.level}
          accessories={pet.accessories}
          loadout={loadoutPower(pet.level, pet.accessories, activePowerBuff(pet.powerBuff, Date.now()) + potEff.power)}
          powerBuffActive={activePowerBuff(pet.powerBuff, Date.now()) + potEff.power}
          wins={pet.battleWins}
          losses={pet.battleLosses}
          coins={pet.coins}
          health={pet.stats.health}
          arenaTop={arenaTop}
          myWallet={wallet}
          onlineEnabled={!!wallet && isCloudEnabled()}
          fetchOpponent={() => (wallet ? findPvpOpponent(wallet) : Promise.resolve(null))}
        />
      )}

      {/* ===== Play: game picker ===== */}
      {modal === "playmenu" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>🎾 Play</h3></div>
            <p className="subtitle" style={{ marginTop: -4 }}>Choose a game.</p>
            <button className="btn btn-primary" onClick={() => setModal("play")}>🎵 Rhythm</button>
            <button className="btn btn-battle" onClick={() => setModal("battle")}>⚔️ Battle Arena</button>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== pump.fun ===== */}
      {modal === "pumpfun" && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>💊 pump.fun</h3></div>
            <p className="subtitle" style={{ marginTop: -4 }}>Our token <b>$PV</b> lives on pump.fun.</p>
            <a className="btn btn-primary" href={LINK_PUMPFUN} target="_blank" rel="noreferrer">Open on pump.fun ↗</a>
            <div className="ca-bar">
              <span className="ca-label">CA:</span>
              <span className="ca-addr">{TOKEN_CA || "not launched yet"}</span>
              {TOKEN_CA && (
                <button className="ca-copy" onClick={() => { navigator.clipboard?.writeText(TOKEN_CA); setToast("CA copied"); }}>Copy</button>
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Exchange Sil ↔ SOL ===== */}
      {modal === "buysil" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>💰 Buy PV</h3>
              <span className="coins"><Coin /> {Math.floor(pet.coins).toLocaleString()} {SIL}</span>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>Buy PV with real SOL — ◎1 SOL = {SOL_PV_RATE.toLocaleString()} PV. <b>Devnet</b> (test SOL).</p>

            {!wallet ? (
              <p className="empty">🔌 Connect your wallet to buy PV with SOL.</p>
            ) : (
              <div className="sil-packs">
                {SOL_BUY_PACKS.map((s) => (
                  <button key={s} className="sil-pack" disabled={buying} onClick={() => buyPvReal(s)}>
                    <span className="sil-pack-amt"><Coin /> {(s * SOL_PV_RATE).toLocaleString()}</span>
                    <span className="sil-pack-price">◎ {s} SOL</span>
                  </button>
                ))}
              </div>
            )}

            {wallet && (
              <>
                <div className="section-label">Sell PV — {SOL_SELL_RATE.toLocaleString()} PV → ◎1 SOL</div>
                <div className="sil-packs">
                  {SOL_SELL_PACKS.map((s) => (
                    <button key={s} className="sil-pack" disabled={buying || Math.floor(pet.coins) < s} onClick={() => sellPvReq(s)}>
                      <span className="sil-pack-amt">◎ {+(s / SOL_SELL_RATE).toFixed(4)} SOL</span>
                      <span className="sil-pack-price"><Coin /> {s.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
                <p className="empty">📨 Selling creates a request — SOL is paid out after manual approval.</p>
              </>
            )}

            {buying && <p className="subtitle" style={{ textAlign: "center" }}>⏳ Processing…</p>}
            <p className="empty">💡 Running on Solana <b>devnet</b> for testing — pay with free test SOL (faucet.solana.com). Real mainnet SOL comes after testing.</p>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Admin: sell requests ===== */}
      {modal === "admin" && isAdmin && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>🛠️ Payout requests</h3></div>
            <p className="subtitle" style={{ marginTop: -4 }}>Approve to pay SOL from the treasury. PV sells can be rejected (refunds PV); pet sales are final.</p>
            {adminReqs === null ? (
              <p className="empty">Loading…</p>
            ) : adminReqs.length === 0 ? (
              <p className="empty">No pending requests 🎉</p>
            ) : (
              <div className="lb-list">
                {adminReqs.map((r) => {
                  const isMarket = r.kind === "market";
                  return (
                    <div key={r.id} className="admin-req">
                      <div className="admin-req-info">
                        <span className="admin-req-amt">{isMarket ? `🏷️ Pet sale → ◎${r.sol}` : <><Coin /> {r.pv.toLocaleString()} → ◎{r.sol}</>}</span>
                        <span className="admin-req-who" title={r.wallet}>{shortAddress(r.wallet)}</span>
                      </div>
                      <div className="admin-req-btns">
                        <button className="btn btn-primary admin-ok" disabled={payoutBusy} onClick={() => doPayout(r.id, "approve")}>Approve</button>
                        {!isMarket && <button className="btn btn-ghost admin-no" disabled={payoutBusy} onClick={() => doPayout(r.id, "reject")}>Reject</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Breed ===== */}
      {modal === "breed" && pet && (
        <div className="scrim" onClick={closeBreed}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>🧬 Breed</h3>
              <span className="coins"><Coin /> {Math.floor(pet.coins)} {SIL}</span>
            </div>

            {bred ? (
              <div style={{ textAlign: "center" }}>
                <p className="subtitle">A new friend was born! 🐣</p>
                <div style={{ margin: "10px 0" }}><PetArt species={bred.id} size={96} /></div>
                <p className="rg-result" style={{ color: RARITY[bred.rarity].color }}>
                  {PETS.find((p) => p.id === bred.id)?.label} · {RARITY[bred.rarity].label}
                </p>
                <button className="btn btn-primary" onClick={() => { setBred(null); setBreedSel([]); }}>Collect</button>
              </div>
            ) : breedEligible.length < 2 ? (
              <p className="empty">
                Breeding unlocks when you have two pets at level {BREED_LEVEL}. You have {breedEligible.length}. Level pets up by feeding them 🍖
              </p>
            ) : (
              <>
                <p className="subtitle" style={{ marginTop: -4 }}>Pick two level-{BREED_LEVEL}+ pets — breed a new one (rare → mythic).</p>
                <div className="inv-grid">
                  {breedEligible.map((id) => {
                    const info = PETS.find((p) => p.id === id)!;
                    const sel = breedSel.includes(id);
                    return (
                      <button
                        key={id}
                        className={"inv-item" + (sel ? " inv-item-rare" : "")}
                        onClick={() => setBreedSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : cur))}
                        title={info.label}
                      >
                        <span className="rar-dot" style={{ background: RARITY[info.rarity].color }} />
                        <span className="inv-emoji"><PetArt species={id} size={34} /></span>
                        <span className="inv-name">{info.label}</span>
                        <span className="inv-feed">Lv {petLevel(id)}{sel ? " ✓" : ""}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="actions">
                  <button className="btn btn-ghost" onClick={closeBreed}>Close</button>
                  <button className="btn btn-primary" disabled={breedSel.length !== 2 || pet.coins < BREED_COST} onClick={breed}>
                    Breed · <Coin /> {BREED_COST}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Name a new pet (before selecting it) ===== */}
      {namePet && pet && (() => {
        const info = PETS.find((p) => p.id === namePet);
        return (
          <div className="scrim scrim-top" onClick={() => setNamePet(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head"><h3>Name your new {info?.label}</h3></div>
              <div style={{ textAlign: "center", margin: "8px 0" }}><PetArt species={namePet} size={80} /></div>
              <div className="name-row">
                <input
                  className="name-input"
                  placeholder={`Name your ${info?.label.toLowerCase()}`}
                  value={petNameInput}
                  maxLength={20}
                  autoFocus
                  onChange={(e) => setPetNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirmPetName()}
                />
                <button className="btn btn-primary" disabled={!petNameInput.trim()} onClick={confirmPetName}>Name & select</button>
              </div>
              <button className="btn btn-ghost" onClick={() => setNamePet(null)}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* ===== Pets ===== */}
      {modal === "pets" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Your pets</h3>
              <span className="coins">{collectiblePets.filter((p) => pet.ownedSpecies.includes(p.id)).length}/{collectiblePets.length}</span>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>Tap to switch. Each pet has a unique perk — locked ones drop from the Pet Chest 🥚</p>
            <div className="inv-grid">
              {[...basePets, ...collectiblePets].map((p) => {
                // Доступен только тот, которым владеешь: стартовый базовый выбран при создании,
                // остальные базовые заблокированы; rare+ — открываются из сундука.
                const owned = pet.ownedSpecies.includes(p.id);
                const active = pet.species === p.id;
                const perk = SPECIES_PERK[p.id]?.label ?? (p.rarity === "common" ? "Starter pet" : "");
                return (
                  <button
                    key={p.id}
                    className={"inv-item inv-item-tall" + (active ? " inv-item-rare" : "") + (owned ? "" : " inv-locked")}
                    onClick={() => (owned ? switchSpecies(p.id) : setToast(p.rarity === "common" ? "You already chose your starter pet 🔒" : "Win it from the Pet Chest 🥚"))}
                    title={`${RARITY[p.rarity].label} · ${perk}`}
                  >
                    <span className="rar-dot" style={{ background: RARITY[p.rarity].color }} />
                    <span className="inv-emoji"><PetArt species={p.id} size={34} /></span>
                    <span className="inv-name">{p.label}</span>
                    <span className="inv-perk">{perk}</span>
                    <span className="inv-feed">{!owned ? "🔒 Locked" : active ? "Active ✓" : "Select"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== Accessories ===== */}
      {modal === "accessories" && pet && (
        <div className="scrim" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Accessories</h3>
              <span className="coins">{pet.ownedAccessories.length}/{ACCESSORIES.length}</span>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>All accessories — locked ones drop from the Accessory Chest 🎀</p>

            <div className="catalog">
              {SLOTS.map((s) => (
                <div key={s.type}>
                  <div className="section-label">{s.label}</div>
                  <div className="inv-grid">
                    {ACCESSORIES.filter((a) => a.type === s.type).map((a) => {
                      const owned = pet.ownedAccessories.includes(a.id);
                      const worn = pet.accessories.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          className={"inv-item" + (worn ? " inv-item-rare" : "") + (owned ? "" : " inv-locked")}
                          onClick={() => (owned ? toggleAccessory(a.id) : setToast("Win it from a chest 🎀"))}
                          title={`${RARITY[a.rarity].label} · ${accDesc(a.type, a.rarity)}`}
                        >
                          <span className="rar-dot" style={{ background: RARITY[a.rarity].color }} />
                          <span className="inv-emoji">{a.emoji}</span>
                          <span className="inv-name">{a.label}</span>
                          <span className="inv-feed">{!owned ? "🔒 Locked" : worn ? "Worn ✓" : "Wear"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Accessory slot picker (only owned of the clicked type) ===== */}
      {accPicker && pet && (() => {
        const slot = SLOTS.find((s) => s.type === accPicker);
        const owned = ACCESSORIES.filter((a) => a.type === accPicker && pet.ownedAccessories.includes(a.id));
        const equipped = ACCESSORIES.find((a) => a.type === accPicker && pet.accessories.includes(a.id));
        return (
          <div className="scrim" onClick={() => setAccPicker(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>{slot?.ghost} {slot?.label}</h3>
              </div>
              {owned.length === 0 ? (
                <p className="empty">No {slot?.label.toLowerCase()} yet — win one from the Accessory Chest 🎀</p>
              ) : (
                <div className="inv-grid">
                  {owned.map((a) => {
                    const worn = pet.accessories.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        className={"inv-item" + (worn ? " inv-item-rare" : "")}
                        onClick={() => toggleAccessory(a.id)}
                        title={`${RARITY[a.rarity].label} · ${accDesc(a.type, a.rarity)}`}
                      >
                        <span className="rar-dot" style={{ background: RARITY[a.rarity].color }} />
                        <span className="inv-emoji">{a.emoji}</span>
                        <span className="inv-name">{a.label}</span>
                        <span className="inv-feed">{worn ? "Worn ✓" : "Wear"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {equipped && (
                <button className="btn btn-ghost" onClick={() => toggleAccessory(equipped.id)}>Take off {equipped.label}</button>
              )}
              <button className="btn btn-ghost" onClick={() => setAccPicker(null)}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* ===== Chest preview ===== */}
      {preview && previewData && pet && (
        <div className="scrim scrim-top" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{preview.chest.emoji} {preview.chest.label} chest</h3>
              <span className="coins"><Coin /> {price(preview.chest.cost)}</span>
            </div>
            <p className="subtitle" style={{ marginTop: -4 }}>Possible drops — hover an item to see its chance.</p>
            <div className="inv-grid">
              {previewData.pool.map((i) => (
                <div className="inv-item preview-item" key={i.id} title={chestItemTitle(i)}>
                  <span className="rar-dot" style={{ background: RARITY[i.rarity].color }} />
                  <span className="inv-emoji">{i.emoji}</span>
                  <span className="inv-name">{i.label}</span>
                  <span className="pchance" style={{ color: RARITY[i.rarity].color }}>{fmtChance(previewData.chanceOf(i))}</span>
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>Exit</button>
              <button className="btn btn-primary" disabled={pet.coins < price(preview.chest.cost)} onClick={spinPreview}>
                Spin · <Coin /> {price(preview.chest.cost)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Chest opening (roulette) ===== */}
      {chest && (
        <div className="scrim scrim-top" onClick={() => chest.revealed && setChest(null)}>
          <div className="chest-open" onClick={(e) => e.stopPropagation()}>
            <div className="reel-viewport">
              <div className="reel-pointer" />
              <div className="reel-track" style={{ transform: `translateX(${reelOffset}px)` }}>
                {chest.strip.map((em, i) => (
                  <div
                    className={"reel-item" + (chest.revealed && i === chest.winIdx ? " reel-item-won" : "")}
                    key={i}
                    style={{ background: `${chest.colors[i]}26`, borderBottom: `3px solid ${chest.colors[i]}` }}
                  >
                    {em}
                  </div>
                ))}
              </div>
            </div>
            {chest.revealed ? (
              <>
                <p className="won-text">
                  You got <b>{chest.won.label}</b> {chest.won.emoji}
                  {chest.won.rarityLabel && (
                    <span className="rare-badge" style={{ background: chest.won.rarityColor, color: "#1a1205" }}>
                      {chest.won.rarityLabel}
                    </span>
                  )}
                </p>
                <button className="btn btn-primary" onClick={() => setChest(null)}>Collect</button>
              </>
            ) : (
              <p className="subtitle">Opening…</p>
            )}
          </div>
        </div>
      )}

      {/* ===== Toast ===== */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
