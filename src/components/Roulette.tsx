import { useState } from "react";
import { Coin } from "./ui";
import { playSpinSound, playWinSound, playLoseSound } from "../game/audio";

// Европейское колесо рулетки: порядок карманов (37 штук, один зелёный 0).
const EU_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

type PocketColor = "green" | "red" | "black";
function colorOf(n: number): PocketColor {
  return n === 0 ? "green" : RED.has(n) ? "red" : "black";
}
const POCKETS = EU_ORDER.map((n) => ({ n, color: colorOf(n) }));
const SEG = 360 / POCKETS.length; // угол одного кармана

const COLORS: Record<PocketColor, string> = { green: "#1ea672", red: "#e2453a", black: "#23262e" };
const STAKES = [5, 10, 25, 50, 100, 200];
const SPIN_MS = 4600; // длительность прокрута колеса

// Точка на колесе по углу (градусы по часовой стрелке от верха), viewBox 200×200.
function pt(r: number, angDeg: number) {
  const a = (angDeg * Math.PI) / 180;
  return { x: 100 + r * Math.sin(a), y: 100 - r * Math.cos(a) };
}
// Путь сектора (кармана) k.
function slicePath(k: number, r: number) {
  const p0 = pt(r, k * SEG);
  const p1 = pt(r, (k + 1) * SEG);
  return `M 100 100 L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} Z`;
}
// Индексы карманов, удовлетворяющих условию.
function indicesWhere(f: (p: { n: number; color: PocketColor }) => boolean): number[] {
  const out: number[] = [];
  POCKETS.forEach((p, i) => { if (f(p)) out.push(i); });
  return out;
}

type Bet = "zero" | "red" | "black";

export function Roulette({ coins, onClose, addCoins }: { coins: number; onClose: () => void; addCoins: (delta: number) => void }) {
  const [stake, setStake] = useState<number | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ win: boolean; text: string } | null>(null);

  function spin(bet: Bet) {
    if (spinning || stake == null || coins < stake) return;
    addCoins(-stake); // списываем ставку сразу
    setResult(null);
    setSpinning(true);

    // Сначала решаем исход по заданным шансам, затем подбираем карман для анимации.
    let win: boolean;
    let pool: number[];
    if (bet === "zero") {
      win = Math.random() < 1 / 36;
      pool = win ? indicesWhere((p) => p.n === 0) : indicesWhere((p) => p.n !== 0);
    } else {
      win = Math.random() < 1 / 2;
      pool = win ? indicesWhere((p) => p.color === bet) : indicesWhere((p) => p.color !== bet);
    }
    const k = pool[Math.floor(Math.random() * pool.length)];
    const pocket = POCKETS[k];

    playSpinSound(SPIN_MS / 1000);

    // Докрутить так, чтобы центр кармана k встал под стрелку сверху, плюс 6 полных оборотов.
    const center = k * SEG + SEG / 2;
    const offset = (360 - (center % 360) + 360) % 360;
    const jitter = (Math.random() * 0.6 - 0.3) * SEG; // лёгкий разброс внутри кармана
    setRotation((prev) => Math.ceil(prev / 360) * 360 + 360 * 6 + offset + jitter);

    const payout = win ? (bet === "zero" ? stake * 15 : stake * 2) : 0;
    window.setTimeout(() => {
      if (win) addCoins(payout);
      if (win) playWinSound();
      else playLoseSound();
      const net = payout - stake;
      setResult({
        win,
        text: win
          ? `🎉 ${pocket.n} ${pocket.color} — you won +${net} PV!`
          : `😬 ${pocket.n} ${pocket.color} — you lost ${stake} PV`,
      });
      setSpinning(false);
    }, SPIN_MS);
  }

  const canBet = !spinning && stake != null && coins >= stake;

  return (
    <div className="scrim scrim-top" onClick={() => !spinning && onClose()}>
      <div className="modal roulette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🎰 Roulette</h3>
          <span className="coins"><Coin /> {Math.floor(coins)} PV</span>
        </div>

        <div className="roulette-wrap">
          <div className="rl-pointer" />
          <div className="rl-wheel" style={{ transform: `rotate(${rotation}deg)`, transition: `transform ${SPIN_MS}ms cubic-bezier(.12,.78,.16,1)` }}>
            <svg viewBox="0 0 200 200" width="260" height="260">
              {POCKETS.map((p, k) => (
                <path key={k} d={slicePath(k, 98)} fill={COLORS[p.color]} stroke="#0c0e12" strokeWidth="0.5" />
              ))}
              {POCKETS.map((p, k) => {
                const pos = pt(82, (k + 0.5) * SEG);
                return (
                  <text key={k} x={pos.x} y={pos.y} fill="#fff" fontSize="8" fontWeight="600" textAnchor="middle" dominantBaseline="central">
                    {p.n}
                  </text>
                );
              })}
              <circle cx="100" cy="100" r="34" fill="#15171d" stroke="#2a2e38" strokeWidth="2" />
              <text x="100" y="100" fill="#ffd23f" fontSize="16" fontWeight="700" textAnchor="middle" dominantBaseline="central">PV</text>
            </svg>
          </div>
        </div>

        {result ? (
          <p className={"rl-result " + (result.win ? "rl-win" : "rl-lose")}>{result.text}</p>
        ) : (
          <p className="subtitle" style={{ marginTop: 0 }}>{spinning ? "Spinning…" : "Pick a stake, then bet on a color or 0."}</p>
        )}

        <div className="section-label">Stake</div>
        <div className="rl-stakes">
          {STAKES.map((s) => (
            <button
              key={s}
              className={"rl-stake" + (stake === s ? " rl-stake-on" : "")}
              disabled={spinning || coins < s}
              onClick={() => setStake(s)}
            >
              {s} PV
            </button>
          ))}
        </div>

        <div className="section-label">Bet</div>
        <div className="rl-bets">
          <button className="rl-bet rl-red" disabled={!canBet} onClick={() => spin("red")}>Red ×2</button>
          <button className="rl-bet rl-zero" disabled={!canBet} onClick={() => spin("zero")}>0</button>
          <button className="rl-bet rl-black" disabled={!canBet} onClick={() => spin("black")}>Black ×2</button>
        </div>

        <button className="btn btn-ghost" disabled={spinning} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
