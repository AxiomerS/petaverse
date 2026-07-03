// Маленькие переиспользуемые UI-компоненты игры.

// Иконка монеты PV (рисуется через CSS, чтобы рендерилась везде — без эмодзи-глифа).
export function Coin() {
  return <span className="sil-coin">PV</span>;
}

export function StatBar({ label, value, color, max = 100 }: { label: string; value: number; color: string; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="stat">
      <div className="stat-head">
        <span>{label}</span>
        <span className="stat-val">{Math.round(value)}{max !== 100 ? ` / ${max}` : ""}</span>
      </div>
      <div className="stat-track">
        <div className="stat-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
