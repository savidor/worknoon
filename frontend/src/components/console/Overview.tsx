import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { Stats } from '../../api/client';
import { smoothPath } from '../../lib/chart';
import { cx, duration, money } from '../../lib/format';

export type QuickView = 'ESCALATED' | 'flagged' | 'auto';

const RANGE_LABEL: Record<number, string> = { 7: 'previous 7 days', 30: 'previous 30 days', 90: 'previous 90 days' };

/** Headline figures: one large "money" card and three smaller tiles, each a shortcut into the table. */
export function Overview({ stats: s, onPick }: { stats: Stats | undefined; onPick: (view: QuickView) => void }) {
  const autoRate = s && s.total > 0 ? Math.round(((s.total - s.escalated_total) / s.total) * 100) : 0;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
      <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="refunded-title">
        <div>
          <div>
            <h2 id="refunded-title" className="text-sm text-slate-500">
              Refunded to customers
            </h2>
            <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{s ? money(s.refunded_cents) : '...'}</p>
            {s && <Delta current={s.period_refunded_cents} previous={s.previous_refunded_cents} days={s.days} />}
          </div>
        </div>
        <div className="mt-4 min-h-20 flex-1">{s && <Sparkline values={s.daily.map((d) => d.refunded_cents)} />}</div>
        <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
          <Figure label="Approved on its own" value={s ? money(s.refunded_auto_cents) : '...'} />
          <Figure label="Approved by your team" value={s ? money(s.refunded_team_cents) : '...'} />
          <Figure label="Typical decision" value={s ? duration(s.avg_latency_ms) : '...'} />
        </dl>
      </section>

      <div className="grid gap-3">
        <Tile
          label="Waiting for you"
          value={s?.pending_review}
          hint={s ? (s.pending_review ? `${money(s.pending_cents)} on hold` : 'Nothing waiting') : undefined}
          tone={s?.pending_review ? 'amber' : 'emerald'}
          action="Review"
          onClick={() => onPick('ESCALATED')}
        />
        <Tile
          label="Handled on its own"
          value={s ? `${autoRate}%` : undefined}
          hint={s ? `${s.total - s.escalated_total} of ${s.total} cases, no person needed` : undefined}
          tone="emerald"
          action="See them"
          onClick={() => onPick('auto')}
          meter={autoRate}
        />
        <Tile
          label="Flagged for a closer look"
          value={s?.flagged}
          hint="Risk or security signals"
          tone={s?.flagged ? 'rose' : 'emerald'}
          action="Inspect"
          onClick={() => onPick('flagged')}
        />
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Delta({ current, previous, days }: { current: number; previous: number; days: number }) {
  if (previous === 0) {
    return (
      <p className="mt-1.5 text-xs text-slate-500">
        <span className="font-medium text-slate-700 tabular-nums">{money(current)}</span> in the last {days} days
      </p>
    );
  }
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
      {/* Neutral on purpose: more refunds is not good or bad by itself. */}
      <span className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 tabular-nums">
        <Icon className="size-3" aria-hidden />
        {up ? '+' : ''}
        {pct.toFixed(1)}%
      </span>
      vs {RANGE_LABEL[days] ?? 'previous period'}
    </p>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const W = 600;
  const H = 90;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  const pts = values.map((v, i) => [i * step, H - 4 - (v / max) * (H - 8)] as [number, number]);
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full min-h-20 w-full overflow-visible" role="img" aria-label="Refunds per day">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#10b981" stopOpacity="0.18" />
          <stop offset="1" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="#059669" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TONES = {
  amber: { value: 'text-amber-700', dot: 'bg-amber-500', meter: 'bg-amber-500' },
  emerald: { value: 'text-slate-900', dot: 'bg-emerald-500', meter: 'bg-emerald-500' },
  rose: { value: 'text-rose-700', dot: 'bg-rose-500', meter: 'bg-rose-500' },
} as const;

function Tile(props: {
  label: string;
  value: string | number | undefined;
  hint?: string;
  tone: keyof typeof TONES;
  action: string;
  onClick: () => void;
  meter?: number;
}) {
  const t = TONES[props.tone];
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className={cx('size-1.5 rounded-full', t.dot)} aria-hidden />
          {props.label}
        </p>
        <p className={cx('mt-0.5 text-2xl font-semibold tabular-nums', t.value)}>{props.value ?? '...'}</p>
        {props.meter !== undefined && (
          <div className="mt-1 h-1 w-full max-w-40 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className={cx('h-full rounded-full', t.meter)} style={{ width: `${props.meter}%` }} />
          </div>
        )}
        {props.hint && <p className="mt-1 truncate text-[11px] text-slate-500">{props.hint}</p>}
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-slate-400 transition group-hover:text-slate-700">
        {props.action} <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  );
}
