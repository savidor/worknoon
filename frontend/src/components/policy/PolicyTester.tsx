import { useMutation } from '@tanstack/react-query';
import { ArrowRight, FlaskConical, History, Play } from 'lucide-react';
import { useState } from 'react';
import { api, type EvaluationView, type PolicyDraft, type PolicyStudioData } from '../../api/client';
import { cx, humanize, money } from '../../lib/format';
import { Button, ErrorNote, OUTCOME_STYLE, OutcomeBadge, Pill } from '../ui';

const selectCls = 'w-full rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500';

function amountOf(v: EvaluationView) {
  if (v.decision === 'APPROVED') return money(v.refundAmountCents);
  if (v.decision === 'ESCALATED') return `${money(v.reviewAmountCents)} on hold`;
  return 'no refund';
}

function EvaluationCard({ title, view, highlight }: { title: string; view: EvaluationView; highlight?: boolean }) {
  return (
    <div className={cx('rounded-lg p-3 ring-1', highlight ? 'bg-brand-50/50 ring-brand-300' : 'ring-slate-200')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">{title}</span>
        <OutcomeBadge outcome={view.decision} />
      </div>
      <p className="mt-1 text-sm font-semibold tabular-nums">{amountOf(view)}</p>
      <ul className="mt-2 space-y-1">
        {view.lines.map((l) => (
          <li key={l.itemId} className="flex items-center gap-1.5 text-xs">
            <span className={cx('size-1.5 shrink-0 rounded-full', { APPROVED: 'bg-emerald-500', DENIED: 'bg-rose-500', ESCALATED: 'bg-amber-500' }[l.decision])} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <span className="text-slate-500">{OUTCOME_STYLE[l.decision].label}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2">
        {view.rules.map((r, i) => (
          <li key={i} className="text-[11px] text-slate-600">
            <span className={cx('font-medium', r.custom && 'text-brand-700')}>{r.title}</span>
            {r.custom && (
              <span className="ml-1">
                <Pill tone="brand">custom</Pill>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PolicyTester({ draft, catalog, dirty }: { draft: PolicyDraft; catalog: PolicyStudioData['catalog']; dirty: boolean }) {
  const [orderNumber, setOrderNumber] = useState(catalog.orders[0]?.order_number ?? '');
  const [reason, setReason] = useState('changed_mind');
  const [skus, setSkus] = useState<string[]>([]);
  const order = catalog.orders.find((o) => o.order_number === orderNumber);

  const simulate = useMutation({
    mutationFn: () =>
      api<{ active: EvaluationView; draft: EvaluationView }>('/admin/policy/simulate', {
        method: 'POST',
        role: 'admin',
        body: { draft, orderNumber, reason, itemSkus: skus.length ? skus : undefined },
      }),
  });
  const impact = useMutation({
    mutationFn: () =>
      api<{ replayed: number; changedCount: number; changed: Array<{ reference: string; customerName: string; orderNumber: string; before: EvaluationView; after: EvaluationView }> }>(
        '/admin/policy/impact',
        { method: 'POST', role: 'admin', body: { draft, limit: 100 } },
      ),
  });

  const sim = simulate.data;
  const outcomeChanged = sim && (sim.active.decision !== sim.draft.decision || amountOf(sim.active) !== amountOf(sim.draft));

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <FlaskConical className="size-4 text-slate-400" aria-hidden /> Try an order
        </h3>
        <p className="mb-3 text-xs text-slate-500">Runs one request through the active policy and your draft. Nothing is saved or refunded.</p>
        <div className="space-y-2">
          <select
            className={selectCls}
            value={orderNumber}
            onChange={(e) => {
              setOrderNumber(e.target.value);
              setSkus([]);
            }}
            aria-label="Order"
          >
            {catalog.orders.map((o) => (
              <option key={o.order_number} value={o.order_number}>
                {o.order_number} · {o.customer_name} · {o.status}
              </option>
            ))}
          </select>
          <select className={selectCls} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
            {catalog.reasons.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </select>
          {order && order.items.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {order.items.map((i) => (
                <button
                  key={i.sku}
                  type="button"
                  aria-pressed={skus.includes(i.sku)}
                  onClick={() => setSkus((s) => (s.includes(i.sku) ? s.filter((x) => x !== i.sku) : [...s, i.sku]))}
                  className={cx(
                    'rounded-full px-2 py-0.5 text-xs ring-1 ring-inset',
                    skus.includes(i.sku) ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-300',
                  )}
                >
                  {i.name}
                </button>
              ))}
              <span className="self-center text-[11px] text-slate-400">{skus.length ? '' : 'all items'}</span>
            </div>
          )}
          <Button variant="secondary" className="w-full" onClick={() => simulate.mutate()} loading={simulate.isPending}>
            <Play className="size-4" aria-hidden /> Run simulation
          </Button>
        </div>
        <div className="mt-3">
          <ErrorNote error={simulate.error} />
        </div>
        {sim && (
          <div className="mt-3 space-y-2">
            <p className={cx('rounded-lg px-3 py-2 text-xs font-medium', outcomeChanged ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600')}>
              {outcomeChanged ? 'Your draft changes the outcome of this request.' : 'Same outcome under both policies.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <EvaluationCard title="Active" view={sim.active} />
              <EvaluationCard title="Draft" view={sim.draft} highlight={!!outcomeChanged} />
            </div>
          </div>
        )}
      </section>

      <section className="border-t border-slate-100 pt-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <History className="size-4 text-slate-400" aria-hidden /> Impact on recent cases
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Replays up to 100 recent cases as they were at the time, through the active policy and your draft.
        </p>
        <Button variant="secondary" className="w-full" onClick={() => impact.mutate()} loading={impact.isPending} disabled={!dirty}>
          Replay recent cases
        </Button>
        {!dirty && <p className="mt-1 text-center text-[11px] text-slate-400">Make a change to compare it with the active policy.</p>}
        <div className="mt-3">
          <ErrorNote error={impact.error} />
        </div>
        {impact.data && (
          <div className="mt-3">
            <p className="text-sm">
              <span className="text-lg font-semibold tabular-nums">{impact.data.changedCount}</span>
              <span className="text-slate-500"> of {impact.data.replayed} recent decisions would change</span>
            </p>
            {impact.data.changed.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {impact.data.changed.map((c) => (
                  <li key={c.reference} className="px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.customerName}</span>
                      <span className="font-mono text-slate-400">{c.reference}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <OutcomeBadge outcome={c.before.decision} />
                      <ArrowRight className="size-3 text-slate-400" aria-hidden />
                      <OutcomeBadge outcome={c.after.decision} />
                      <span className="ml-auto tabular-nums text-slate-500">
                        {amountOf(c.before)} → {amountOf(c.after)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
