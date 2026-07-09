import { useEffect, useRef, useState } from "react";
import { PetArt } from "./PetArt";
import { ACCESSORIES, SLOTS } from "../game/accessories";
import { FOODS } from "../game/foods";
import { RARITY, type Rarity } from "../game/rarity";
import { PETS } from "../game/pets";
import { loadoutPower, accPower, accHp, accCrit, type Loadout } from "../game/power";
import { type ArenaRow, type PvpProfile } from "../game/cloud";
import { shortAddress } from "../game/wallet";

const BOT_NAMES = ["Ragefang", "Shadow", "Bolt", "Tank", "Nibbles", "Vortex", "Pixel", "Goliath", "Sneaky", "Turbo", "Mochi", "Crash", "Zephyr", "Onyx"];
const TIPS = [
  "Epic+ accessories add crit chance & crit damage.",
  "Feed epic+ food before a fight for a temporary power boost.",
  "Accessories add HP too — heavier gear survives longer.",
  "Crit chance has diminishing returns and caps at 25%.",
  "Higher level means more power and more HP.",
];

// Ставки на бой (Sil). 0 = дружеский бой без ставки.
const BET_OPTIONS = [0, 25, 50, 100, 200];
const INTRO_MS = 2600; // сколько держим экран "pet1 VS pet2" перед рулеткой (кто бьёт первым)
const FLIP_MS = 4000; // длительность рулетки "кто бьёт первым" — держать в синхроне с .bt-arrow transition в App.css

// Ранкинг арены — топ-игроки (локальный/фейковый; настоящий глобальный лист будет с бэкендом).
// У каждого — винрейт и лучший питомец с его силой.
type ArenaPlayer = { name: string; wins: number; losses: number; species: string; power: number };
const ARENA_PLAYERS: ArenaPlayer[] = [
  { name: "Ragefang", wins: 312, losses: 21, species: "dragon", power: 690 },
  { name: "OnyxKing", wins: 288, losses: 26, species: "dino", power: 655 },
  { name: "VortexPup", wins: 254, losses: 33, species: "tiger", power: 610 },
  { name: "MythicMochi", wins: 240, losses: 40, species: "unicorn", power: 585 },
  { name: "Goliath", wins: 221, losses: 44, species: "lion", power: 560 },
  { name: "ShadowFox", wins: 198, losses: 52, species: "fox", power: 520 },
  { name: "TurboFrog", wins: 176, losses: 58, species: "frog", power: 480 },
  { name: "PixelPanda", wins: 160, losses: 66, species: "panda", power: 455 },
  { name: "SneakyOwl", wins: 143, losses: 71, species: "owl", power: 420 },
  { name: "CrashRabbit", wins: 128, losses: 79, species: "rabbit", power: 390 },
  { name: "ZephyrPenguin", wins: 112, losses: 84, species: "penguin", power: 360 },
  { name: "BoltCat", wins: 98, losses: 90, species: "cat", power: 330 },
  { name: "NibblesDog", wins: 84, losses: 92, species: "dog", power: 300 },
  { name: "TankHamster", wins: 71, losses: 95, species: "hamster", power: 275 },
  { name: "LuckyLion", wins: 63, losses: 101, species: "lion", power: 250 },
  { name: "StormTiger", wins: 52, losses: 108, species: "tiger", power: 225 },
  { name: "MistyFox", wins: 44, losses: 115, species: "fox", power: 200 },
  { name: "EchoOwl", wins: 37, losses: 121, species: "owl", power: 180 },
  { name: "RookiePup", wins: 25, losses: 130, species: "dog", power: 150 },
  { name: "NewbieCat", wins: 12, losses: 140, species: "cat", power: 120 },
];

type Phase = "loadout" | "searching" | "intro" | "flip" | "battle" | "loot" | "done";
type Fighter = { name: string; species: string; level: number; accessories: string[] } & Loadout;
type Loot = { kind: "accessory" | "food"; id: string; label: string; emoji: string; rarity: Rarity };

export function BattleGame({ onClose, onWin, onLose, petName, petSpecies, level, accessories, loadout, powerBuffActive, wins, losses, coins, health, arenaTop, myWallet, onlineEnabled, fetchOpponent }: {
  onClose: () => void;
  onWin: (kind: "accessory" | "food", id: string, bet: number) => void;
  onLose: (bet: number) => void;
  petName: string;
  petSpecies: string;
  level: number;
  accessories: string[];
  loadout: Loadout;
  powerBuffActive: number;
  wins: number;
  losses: number;
  coins: number;
  health: number;
  arenaTop: ArenaRow[] | null; // живой топ арены из Supabase (null → фейковый список)
  myWallet: string | null;
  onlineEnabled: boolean; // доступен ли онлайн-матч (кошелёк + облако)
  fetchOpponent: () => Promise<PvpProfile | null>; // найти реального соперника
}) {
  const [phase, setPhase] = useState<Phase>("loadout");
  const [bot, setBot] = useState<Fighter | null>(null);
  const [pHp, setPHp] = useState(0);
  const [oHp, setOHp] = useState(0);
  const [pMax, setPMax] = useState(1);
  const [oMax, setOMax] = useState(1);
  const [turn, setTurn] = useState(0);
  const [flash, setFlash] = useState<{ attacker: "p" | "o"; side: "p" | "o"; dmg: number; crit: boolean } | null>(null);
  const [win, setWin] = useState(false);
  const [loot, setLoot] = useState<Loot[]>([]);
  const [arrowSpin, setArrowSpin] = useState(0); // угол стрелки «кто бьёт первым»
  const [bet, setBet] = useState(0); // ставка Sil на бой
  const [showRanks, setShowRanks] = useState(false); // показать ли ранкинг арены
  const [onlineMatch, setOnlineMatch] = useState(false); // текущий бой — против реального игрока
  const timerRef = useRef(0);
  const resultedRef = useRef(false);
  const betRef = useRef(0); // зафиксированная ставка на текущий бой
  const searchIdRef = useRef(0); // токен текущего поиска (для отмены/перезапуска)
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

  const MIN_HP = 10; // нужно минимум 10 HP, чтобы выйти на арену
  const canFight = health >= MIN_HP;

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Случайный противник: случайный вид, уровень рядом с твоим и случайное снаряжение.
  function makeBot(): Fighter {
    const lvl = Math.max(1, level + Math.floor(Math.random() * 5) - 2);
    const accs: string[] = [];
    for (const s of SLOTS) {
      if (Math.random() < 0.6) {
        const pool = ACCESSORIES.filter((a) => a.type === s.type);
        accs.push(pool[Math.floor(Math.random() * pool.length)].id);
      }
    }
    const species = PETS[Math.floor(Math.random() * PETS.length)].id;
    const rarity = PETS.find((p) => p.id === species)?.rarity ?? "common";
    const lo = loadoutPower(lvl, accs, Math.random() < 0.3 ? 0.1 : 0, rarity);
    return { name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], species, level: lvl, accessories: accs, ...lo };
  }

  // Построить бойца из профиля реального игрока (его вид, уровень, снаряжение).
  async function buildOnlineFighter(): Promise<Fighter | null> {
    const prof = await fetchOpponent();
    if (!prof) return null;
    const rarity = PETS.find((p) => p.id === prof.species)?.rarity ?? "common";
    const lo = loadoutPower(prof.level, prof.accessories ?? [], 0, rarity);
    return { name: (prof.name && prof.name.trim()) || "Rival", species: prof.species, level: prof.level, accessories: prof.accessories ?? [], ...lo };
  }

  // Показать заставку "pet1 VS pet2" (с их шмотками), затем «бросок стрелки» и сам бой.
  function startFlip(b: Fighter, online: boolean) {
    setOnlineMatch(online);
    setBot(b);
    setPMax(loadout.hp); setPHp(loadout.hp); setOMax(b.hp); setOHp(b.hp);
    setPhase("intro");
    timerRef.current = window.setTimeout(() => {
      const first = Math.random() < 0.5; // кто бьёт первым
      setArrowSpin(0);
      setPhase("flip");
      requestAnimationFrame(() => setArrowSpin(360 * 5 + (first ? 180 : 0)));
      timerRef.current = window.setTimeout(() => startBattle(b, first), FLIP_MS);
    }, INTRO_MS);
  }

  // Найти соперника. Онлайн: ищем реального игрока до 2 минут, потом ТИХО подставляем бота.
  // Без облака: сразу бот (искать негде).
  const ONLINE_TIMEOUT = 120000; // 2 минуты
  function beginMatch() {
    if (!canFight) return;
    betRef.current = Math.min(bet, coins); // фиксируем ставку на этот бой
    const myId = ++searchIdRef.current;
    setPhase("searching");
    if (!onlineEnabled) {
      timerRef.current = window.setTimeout(() => { if (searchIdRef.current === myId) startFlip(makeBot(), false); }, 900);
      return;
    }
    const deadline = Date.now() + ONLINE_TIMEOUT;
    const poll = () => {
      buildOnlineFighter().then((found) => {
        if (searchIdRef.current !== myId) return; // поиск отменён/перезапущен
        if (found) return startFlip(found, true); // нашли реального игрока
        if (Date.now() >= deadline) return startFlip(makeBot(), false); // 2 мин без соперника → бот
        timerRef.current = window.setTimeout(poll, 4000); // подождём и попробуем снова
      });
    };
    poll();
  }

  // Отменить поиск и вернуться в лоадаут.
  function cancelSearch() {
    searchIdRef.current++; // сбрасываем текущий поиск
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase("loadout");
  }

  function startBattle(b: Fighter, first: boolean) {
    let p = loadout.hp;
    let o = b.hp;
    setPMax(p); setOMax(o); setPHp(p); setOHp(o);
    setPhase("battle");
    let playerTurn = first;
    const step = () => {
      const atk = playerTurn ? loadout : b;
      const crit = Math.random() < atk.critChance;
      const dmg = Math.round(atk.power * (crit ? atk.critMult : 1));
      if (playerTurn) { o = Math.max(0, o - dmg); setOHp(o); } else { p = Math.max(0, p - dmg); setPHp(p); }
      setFlash({ attacker: playerTurn ? "p" : "o", side: playerTurn ? "o" : "p", dmg, crit });
      setTurn((t) => t + 1);
      if (p <= 0 || o <= 0) {
        const w = playerTurn;
        timerRef.current = window.setTimeout(() => {
          setWin(w);
          if (w) {
            setLoot(buildLoot(b));
            setPhase("loot");
          } else {
            if (!resultedRef.current) { resultedRef.current = true; onLose(betRef.current); }
            setPhase("done");
          }
        }, 900);
        return;
      }
      playerTurn = !playerTurn;
      timerRef.current = window.setTimeout(step, 850);
    };
    timerRef.current = window.setTimeout(step, 700);
  }

  // Добыча после победы: снаряжение проигравшего + пара случайных блюд.
  function buildLoot(b: Fighter): Loot[] {
    const items: Loot[] = [];
    for (const id of b.accessories) {
      const a = ACCESSORIES.find((x) => x.id === id);
      if (a) items.push({ kind: "accessory", id, label: a.label, emoji: a.emoji, rarity: a.rarity });
    }
    const foods = [...FOODS].sort(() => Math.random() - 0.5).slice(0, 2);
    for (const f of foods) items.push({ kind: "food", id: f.id, label: f.label, emoji: f.emoji, rarity: f.rarity });
    return items;
  }
  function pickLoot(it: Loot) {
    if (resultedRef.current) return;
    resultedRef.current = true;
    onWin(it.kind, it.id, betRef.current);
    setPhase("done");
  }

  const total = wins + losses;
  const winrate = total ? Math.round((wins / total) * 100) : 0;

  const gearRow = (accs: string[]) => (
    <div className="bt-gearrow">
      {ACCESSORIES.filter((a) => accs.includes(a.id)).map((a) => (
        <span key={a.id} className="bt-gearchip" style={{ borderColor: RARITY[a.rarity].color }} title={`${a.label} · ⚔️+${accPower(a.rarity)} ❤️+${accHp(a.rarity)}`}>{a.emoji}</span>
      ))}
      {accs.length === 0 && <span className="bt-gearchip bt-gearchip-empty">—</span>}
    </div>
  );

  return (
    <div className="scrim" onClick={() => phase !== "battle" && onClose()}>
      <div className="modal modal-xl battle-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>⚔️ Battle Arena <span className="wip-badge">{onlineEnabled ? "PvP" : "BOTS"}</span></h3></div>

        {phase === "loadout" && showRanks && (() => {
          const rate = (w: number, l: number) => (w + l ? w / (w + l) : 0);
          type Row = { key: string; name: string; wins: number; losses: number; species: string; power: number; you: boolean };
          let rows: Row[];
          const real = arenaTop !== null; // живой топ из Supabase
          if (arenaTop) {
            // Порядок уже задан запросом (по победам, затем по силе).
            rows = arenaTop.map((p) => ({
              key: p.wallet,
              name: (p.name && p.name.trim()) || shortAddress(p.wallet),
              wins: p.wins, losses: p.losses, species: p.species, power: p.power,
              you: !!myWallet && p.wallet === myWallet,
            }));
            if (myWallet && !rows.some((r) => r.you)) {
              rows.push({ key: myWallet, name: petName, wins, losses, species: petSpecies, power: loadout.power, you: true });
            }
          } else {
            const me: Row = { key: "you", name: petName, wins, losses, species: petSpecies, power: loadout.power, you: true };
            rows = [...ARENA_PLAYERS.map((p) => ({ key: p.name, name: p.name, wins: p.wins, losses: p.losses, species: p.species, power: p.power, you: false })), me]
              .sort((a, b) => b.wins - a.wins || b.power - a.power)
              .slice(0, 20);
          }
          return (
            <div className="bt-ranks">
              <p className="subtitle" style={{ marginTop: -4 }}>
                {real ? "Global top fighters — most wins first." : "Top fighters by wins & pet power."}
              </p>
              <div className="bt-ranklist">
                <div className="bt-rankhead">
                  <span className="bt-rk">#</span>
                  <span className="bt-rn">Player</span>
                  <span className="bt-rw">Winrate</span>
                  <span className="bt-rp">⚔️ Power</span>
                </div>
                {rows.length === 0 ? (
                  <div className="bt-rankrow"><span className="bt-rn">No fighters yet — win a battle! ⚔️</span></div>
                ) : (
                  rows.map((r, i) => (
                    <div key={r.key} className={"bt-rankrow" + (r.you ? " bt-rankrow-you" : "")}>
                      <span className="bt-rk">{i + 1}</span>
                      <span className="bt-rn"><PetArt species={r.species} size={22} /> {r.name}{r.you ? " (you)" : ""}</span>
                      <span className="bt-rw">{Math.round(rate(r.wins, r.losses) * 100)}%</span>
                      <span className="bt-rp">{r.power}</span>
                    </div>
                  ))
                )}
              </div>
              {real && !myWallet && <p className="bt-tip">🔌 Connect your wallet to join the global arena ranking.</p>}
              <button className="btn btn-ghost" onClick={() => setShowRanks(false)}>← Back</button>
            </div>
          );
        })()}

        {phase === "loadout" && !showRanks && (
          <div className="bt-loadout">
            <div className="bt-loadcard">
              <div className="bt-hero">
                <PetArt species={petSpecies} size={104} />
                <div className="bt-name">{petName}</div>
                <div className="bt-lvl">Level {level}</div>
                {powerBuffActive > 0 && <div className="bt-buff">🍖 +{Math.round(powerBuffActive * 100)}% power</div>}
              </div>
              <div className="bt-statbox">
                <div className="bt-bigstat bt-stat-pow"><span>⚔️ Power</span><b>{loadout.power}</b></div>
                <div className="bt-bigstat bt-stat-hp"><span>❤️ HP</span><b>{loadout.hp}</b></div>
                <div className="bt-bigstat bt-stat-crit"><span>💥 Crit</span><b>{Math.round(loadout.critChance * 100)}% · ×{loadout.critMult.toFixed(2)}</b></div>
                <div className="bt-gearlist">
                  {SLOTS.map((s) => {
                    const a = ACCESSORIES.find((x) => x.type === s.type && accessories.includes(x.id));
                    return (
                      <div className="bt-slotrow" key={s.type}>
                        <span className="bt-slotemoji">{a ? a.emoji : s.ghost}</span>
                        <span className="bt-slotname">{a ? a.label : `No ${s.label.toLowerCase()}`}</span>
                        {a && (
                          <span className="bt-slotstat" style={{ color: RARITY[a.rarity].color }}>
                            ⚔️+{accPower(a.rarity)} ❤️+{accHp(a.rarity)}{accCrit(a.rarity) ? ` 💥${Math.round(accCrit(a.rarity)!.chance * 100)}%` : ""}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Ставка на бой */}
            <div className="bt-betbox">
              <span className="bt-betlabel">💰 Bet</span>
              <div className="bt-betopts">
                {BET_OPTIONS.map((b) => (
                  <button
                    key={b}
                    className={"bt-betchip" + (bet === b ? " bt-betchip-on" : "")}
                    disabled={b > coins}
                    onClick={() => setBet(b)}
                  >
                    {b === 0 ? "None" : b}
                  </button>
                ))}
              </div>
            </div>

            {canFight ? (
              <button className="btn btn-primary bt-find" onClick={beginMatch}>
                {onlineEnabled ? "🌐 Find opponent" : "🔍 Find opponent"}{bet > 0 ? ` · bet ${bet}` : ""}
              </button>
            ) : (
              <button className="btn btn-primary bt-find" disabled>❤️ Needs {MIN_HP}+ HP to fight</button>
            )}
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setShowRanks(true)}>🏆 Rankings</button>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
            </div>

            <div className="bt-info">
              <div className="bt-record">
                <div className="bt-rec"><b>{wins}</b><span>Wins</span></div>
                <div className="bt-rec"><b>{losses}</b><span>Losses</span></div>
                <div className="bt-rec"><b>{winrate}%</b><span>Winrate</span></div>
              </div>
              <p className="bt-rewards">🏆 Win: +PV, +XP, loot an item{bet > 0 ? ` & +${bet} bet` : ""} · 💔 Lose: −10 HP{bet > 0 ? ` & −${bet} bet` : ""}</p>
              {!canFight && <p className="bt-tip">❤️ Your pet is too weak to fight — heal it above {MIN_HP} HP first.</p>}
              <p className="bt-tip">💡 {tip}</p>
            </div>
          </div>
        )}

        {phase === "searching" && (
          <div className="bt-searching">
            <div className="bt-spinner">⚔️</div>
            <p className="subtitle">{onlineEnabled ? "Searching for an online opponent…" : "Finding an opponent…"}</p>
            {onlineEnabled && <p className="bt-tip">Matches a real player. A bot only fills in if none appear within 2 min.</p>}
            <button className="btn btn-ghost" onClick={cancelSearch}>Cancel</button>
          </div>
        )}

        {(phase === "intro" || phase === "flip" || phase === "battle" || phase === "done") && bot && (
          <div className="bt-arena">
            <div className="bt-side">
              <span key={`p-${turn}`} className={"bt-petwrap" + (flash?.attacker === "p" ? " bt-lunge-r" : flash?.side === "p" ? " bt-hurt" : "")}><PetArt species={petSpecies} size={84} /></span>
              <div className="bt-name">{petName}</div>
              {gearRow(accessories)}
              <div className="bt-hpbar"><div className="bt-hpfill bt-hp-p" style={{ width: `${(pHp / pMax) * 100}%` }} /></div>
              <div className="bt-hpnum">❤️ {pHp} / {pMax}</div>
              {flash?.side === "p" && <div key={`pd-${turn}`} className={"bt-dmg" + (flash.crit ? " bt-dmg-crit" : "")}>-{flash.dmg}{flash.crit ? " CRIT!" : ""}</div>}
            </div>
            {phase === "flip" ? (
              <svg className="bt-arrow" style={{ transform: `rotate(${arrowSpin}deg)` }} viewBox="0 0 100 40" width="92" height="38" aria-hidden>
                <path d="M8 20 H72 M56 7 L82 20 L56 33" stroke="#ffd23f" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <div className="bt-vs">VS</div>
            )}
            <div className="bt-side">
              <span key={`o-${turn}`} className={"bt-petwrap" + (flash?.attacker === "o" ? " bt-lunge-l" : flash?.side === "o" ? " bt-hurt" : "")}><PetArt species={bot.species} size={84} /></span>
              <div className="bt-name">{bot.name} · Lv {bot.level}{onlineMatch ? " 🌐" : ""}</div>
              {gearRow(bot.accessories)}
              <div className="bt-hpbar"><div className="bt-hpfill bt-hp-o" style={{ width: `${(oHp / oMax) * 100}%` }} /></div>
              <div className="bt-hpnum">❤️ {oHp} / {oMax}</div>
              {flash?.side === "o" && <div key={`od-${turn}`} className={"bt-dmg" + (flash.crit ? " bt-dmg-crit" : "")}>-{flash.dmg}{flash.crit ? " CRIT!" : ""}</div>}
            </div>
          </div>
        )}

        {phase === "intro" && <p className="subtitle bt-flipcap">⚔️ Opponent found!</p>}
        {phase === "flip" && <p className="subtitle bt-flipcap">🎯 Spinning to decide who strikes first…</p>}

        {phase === "loot" && (
          <div className="bt-loot">
            <p className="rg-result">🏆 Victory! Choose your loot:</p>
            <p className="subtitle" style={{ marginTop: -4 }}>Take one item from the defeated pet.</p>
            <div className="bt-lootgrid">
              {loot.map((it, i) => (
                <button key={i} className="bt-lootitem" style={{ borderColor: RARITY[it.rarity].color }} onClick={() => pickLoot(it)}>
                  <span className="rar-dot" style={{ background: RARITY[it.rarity].color }} />
                  <span className="bt-lootemoji">{it.emoji}</span>
                  <span className="bt-lootname">{it.label}</span>
                  <span className="bt-lootkind">{it.kind === "accessory" ? "Accessory" : "Food"}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="bt-resultbox">
            <p className={"rg-result " + (win ? "" : "rg-miss")}>{win ? "🏆 Victory!" : "💔 Defeat"}</p>
            <p className="subtitle">{win ? "You looted an item and gained PV + XP." : `${petName} lost the fight and took 10 damage. Feed it to heal up.`}</p>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
