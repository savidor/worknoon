import { useState } from 'react';
import type { Stats } from '../api/client';

// Status colors, validated as a set (CVD separation and normal-vision floor pass).
// Amber is below 3:1 on white, so the legend carries totals as text and every bar has a tooltip.
const SERIES = [
  { key: 'approved', label: 'Approved', color: '#059669' },
  { key: 'escalated', label: 'Escalated', color: '#f59e0b' },
  { key: 'denied', label: 'Denied', color: '#e11d48' },
] as const;

const W = 340;
const H = 170;
const PAD = { top: 12, right: 8, bottom: 24, left: 28 };

export function DecisionsChart({ daily }: { daily: Stats['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = daily.map((d) => d.approved + d.escalated + d.denied);
  const max = Math.max(4, ...totals);
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / daily.length;
  const barW = Math.min(36, band * 0.55);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const sums = SERIES.map((s) => daily.reduce((acc, d) => acc + d[s.key], 0));

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
        {SERIES.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label} <span className="font-medium tabular-nums text-slate-900">{sums[i]}</span>
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Decisions per day over the last 7 days">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(step * i)} y2={y(step * i)} stroke="#e2e8f0" strokeDasharray={i ? '2 3' : undefined} />
              <text x={PAD.left - 6} y={y(step * i) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                {step * i}
              </text>
            </g>
          ))}
          {daily.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            let acc = 0;
            const segs = SERIES.map((s) => {
              const v = d[s.key];
              const seg = { s, v, y0: acc, y1: acc + v };
              acc += v;
              return seg;
            }).filter((seg) => seg.v > 0);
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* Hit target larger than the mark */}
                <rect x={cx - band / 2} y={PAD.top} width={band} height={plotH} fill={hover === i ? '#f1f5f9' : 'transparent'} />
                {segs.map((seg, j) => {
                  const isTop = j === segs.length - 1;
                  const yTop = y(seg.y1);
                  const h = Math.max(0, y(seg.y0) - yTop - (j > 0 ? 2 : 0));
                  return (
                    <path
                      key={seg.s.key}
                      d={roundedTop(cx - barW / 2, yTop, barW, h, isTop ? 4 : 0)}
                      fill={seg.s.color}
                    />
                  );
                })}
                <text x={cx} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[10px]">
                  {new Date(`${d.day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}
                </text>
              </g>
            );
          })}
        </svg>
        {hover !== null && daily[hover] && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg bg-slate-900 px-2.5 py-2 text-xs text-white shadow-lg"
            style={{ left: `${((PAD.left + band * hover + band / 2) / W) * 100}%`, transform: 'translateX(-50%)' }}
          >
            <p className="mb-1 font-medium">{new Date(`${daily[hover]!.day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                {s.label}: <span className="tabular-nums">{daily[hover]![s.key]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Decisions per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            {SERIES.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {daily.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              {SERIES.map((s) => (
                <td key={s.key}>{d[s.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bar path with rounded top corners only, anchored flat to the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
