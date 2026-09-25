import { useState } from 'react';
import type { Stats } from '../../api/client';
import { linePath, niceMax } from '../../lib/chart';
import { cx } from '../../lib/format';

// Status colours validated as a set (colour-blind separation). Amber is below 3:1 on white,
// so the legend carries totals as text and every day has a tooltip.
const SERIES = [
  { key: 'approved', label: 'Approved', color: '#059669' },
  { key: 'escalated', label: 'Sent to a person', color: '#f59e0b' },
  { key: 'denied', label: 'Denied', color: '#e11d48' },
] as const;

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

const W = 720;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 26, left: 28 };

const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00`).toLocaleDateString('en-US', opts);

export function ActivityChart({ stats, range, onRange }: { stats: Stats | undefined; range: Range; onRange: (r: Range) => void }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="activity-title">
      <header className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <h2 id="activity-title" className="text-sm font-semibold">
          Daily activity
        </h2>
        <div className="ml-auto inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => onRange(r)}
              className={cx('rounded-md px-2.5 py-1 text-xs font-medium transition', range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
            >
              {r}d
            </button>
          ))}
        </div>
      </header>
      <div className="px-5 pt-2 pb-4">{stats ? <Chart daily={stats.daily} /> : <div className="h-[230px] animate-pulse rounded-lg bg-slate-50" />}</div>
    </section>
  );
}

function Chart({ daily }: { daily: Stats['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceMax(Math.max(0, ...daily.flatMap((d) => SERIES.map((s) => d[s.key]))));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (daily.length > 1 ? (i / (daily.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const sums = SERIES.map((s) => daily.reduce((acc, d) => acc + d[s.key], 0));
  const ticks = daily.length <= 7 ? daily.map((_, i) => i) : [0, Math.floor((daily.length - 1) / 2), daily.length - 1];
  const tickFormat: Intl.DateTimeFormatOptions = daily.length <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' };

  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / plotW) * (daily.length - 1));
    setHover(Math.min(daily.length - 1, Math.max(0, i)));
  };

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
        {SERIES.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label} <span className="font-medium text-slate-900 tabular-nums">{sums[i]}</span>
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none"
          role="img"
          aria-label={`Decisions per day over the last ${daily.length} days`}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="approved-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#10b981" stopOpacity="0.14" />
              <stop offset="1" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y((top / 4) * i)} y2={y((top / 4) * i)} stroke="#e2e8f0" strokeDasharray={i ? '2 4' : undefined} />
              <text x={PAD.left - 8} y={y((top / 4) * i) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                {(top / 4) * i}
              </text>
            </g>
          ))}
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={daily.length > 7 ? (i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle') : 'middle'} className="fill-slate-400 text-[10px]">
              {dayLabel(daily[i]!.day, tickFormat)}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="#cbd5e1" />}
          {SERIES.map((s, si) => {
            const pts = daily.map((d, i) => [x(i), y(d[s.key])] as [number, number]);
            const line = linePath(pts);
            return (
              <g key={s.key}>
                {si === 0 && <path d={`${line} L${x(daily.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="url(#approved-fill)" />}
                <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {daily.length <= 7 && hover === null && pts.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="2.5" fill={s.color} />)}
                {hover !== null && <circle cx={pts[hover]![0]} cy={pts[hover]![1]} r="3.5" fill={s.color} stroke="white" strokeWidth="1.5" />}
              </g>
            );
          })}
        </svg>
        {hover !== null && daily[hover] && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg bg-slate-900 px-2.5 py-2 text-xs whitespace-nowrap text-white shadow-lg"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: `translateX(${hover > daily.length / 2 ? 'calc(-100% - 10px)' : '10px'})`,
            }}
          >
            <p className="mb-1 font-medium">{dayLabel(daily[hover]!.day, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
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
