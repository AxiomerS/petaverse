import { useEffect, useRef, useState } from "react";
import { PetArt } from "./PetArt";
import { ACCESSORIES, SLOTS } from "../game/accessories";
import { FOODS } from "../game/foods";
import { RARITY, type Rarity } from "../game/rarity";
import { PETS } from "../game/pets";
import { loadoutPower, accPower, accHp, accCrit, type Loadout } from "../game/power";

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

type Phase = "loadout" | "searching" | "flip" | "battle" | "loot" | "done";
type Fighter = { name: string; species: string; level: number; accessories: string[] } & Loadout;
type Loot = { kind: "accessory" | "food"; id: string; label: string; emoji: string; rarity: Rarity };

export function BattleGame({ onClose, onWin, onLose, petName, petSpecies, level, accessories, loadout, powerBuffActive, wins, losses, coins, health }: {
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
  const timerRef = useRef(0);
  const resultedRef = useRef(false);
  const betRef = useRef(0); // зафиксированная ставка на текущий бой
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
    const lo = loadoutPower(lvl, accs, Math.random() < 0.3 ? 0.1 : 0);
    const species = PETS[Math.floor(Math.random() * PETS.length)].id;
    return { name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], species, level: lvl, accessories: accs, ...lo };
  }

  function findOpponent() {
    if (!canFight) return;
    betRef.current = Math.min(bet, coins); // фиксируем ставку на этот бой
    setPhase("searching");
    timerRef.current = window.setTimeout(() => {
      const b = makeBot();
      const first = Math.random() < 0.5; // кто бьёт первым
      setBot(b);
      // полные HP-полоски на время «броска» стрелки
      setPMax(loadout.hp); setPHp(loadout.hp); setOMax(b.hp); setOHp(b.hp);
      setArrowSpin(0);
      setPhase("flip");
      // на следующем кадре запускаем вращение: стрелка укажет на первого бойца
      requestAnimationFrame(() => setArrowSpin(360 * 5 + (first ? 180 : 0)));
      timerRef.current = window.setTimeout(() => startBattle(b, first), 2000);
    }, 1300);
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
        <div className="modal-head"><h3>⚔️ Battle Arena <span className="wip-badge">BOTS</span></h3></div>

        {phase === "loadout" && showRanks && (() => {
          // Ранкинг арены: боты + сам игрок, отсортированные по винрейту, затем по силе.
          const rate = (w: number, l: number) => (w + l ? w / (w + l) : 0);
          const me = { name: `${petName} (you)`, wins, losses, species: petSpecies, power: loadout.power, you: true };
          const rows = [...ARENA_PLAYERS.map((p) => ({ ...p, you: false })), me]
            .sort((a, b) => rate(b.wins, b.losses) - rate(a.wins, a.losses) || b.power - a.power)
            .slice(0, 20);
          return (
            <div className="bt-ranks">
              <p className="subtitle" style={{ marginTop: -4 }}>Top 20 fighters by winrate &amp; pet power.</p>
              <div className="bt-ranklist">
                <div className="bt-rankhead">
                  <span className="bt-rk">#</span>
                  <span className="bt-rn">Player</span>
                  <span className="bt-rw">Winrate</span>
                  <span className="bt-rp">⚔️ Power</span>
                </div>
                {rows.map((r, i) => (
                  <div key={r.name} className={"bt-rankrow" + (r.you ? " bt-rankrow-you" : "")}>
                    <span className="bt-rk">{i + 1}</span>
                    <span className="bt-rn"><PetArt species={r.species} size={22} /> {r.name}</span>
                    <span className="bt-rw">{Math.round(rate(r.wins, r.losses) * 100)}%</span>
                    <span className="bt-rp">{r.power}</span>
                  </div>
                ))}
              </div>
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
              <button className="btn btn-primary bt-find" onClick={findOpponent}>
                🔍 Find opponent{bet > 0 ? ` · bet ${bet}` : ""}
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
          <div className="bt-searching"><div className="bt-spinner">⚔️</div><p className="subtitle">Searching for an opponent…</p></div>
        )}

        {(phase === "flip" || phase === "battle" || phase === "done") && bot && (
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
              <div className="bt-name">{bot.name} · Lv {bot.level}</div>
              {gearRow(bot.accessories)}
              <div className="bt-hpbar"><div className="bt-hpfill bt-hp-o" style={{ width: `${(oHp / oMax) * 100}%` }} /></div>
              <div className="bt-hpnum">❤️ {oHp} / {oMax}</div>
              {flash?.side === "o" && <div key={`od-${turn}`} className={"bt-dmg" + (flash.crit ? " bt-dmg-crit" : "")}>-{flash.dmg}{flash.crit ? " CRIT!" : ""}</div>}
            </div>
          </div>
        )}

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
