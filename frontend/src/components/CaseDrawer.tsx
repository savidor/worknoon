import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, CircleAlert, Gavel, ScrollText, ShieldAlert, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type AuditEvent, type Message, type Order, type RequestDetail } from '../api/client';
import { cx, humanize, money, relative, shortDate, time } from '../lib/format';
import { Button, ErrorNote, FlagBadge, OutcomeBadge, Pill, Spinner } from './ui';

interface Detail {
  request: RequestDetail;
  events: AuditEvent[];
  transcript: Message[];
  order: Order | null;
}

export function CaseDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['request', id],
    queryFn: () => api<Detail>(`/admin/requests/${id}`, { role: 'admin' }),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const r = data?.request;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Refund case detail">
      <button type="button" className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]" onClick={onClose} aria-label="Close" />
      <div className="relative flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-base font-semibold">{r?.reference ?? 'Loading'}</h2>
              {r && <OutcomeBadge outcome={r.status} />}
              {r && r.system_decision !== r.status && (
                <span className="text-xs text-slate-500">
                  system: {humanize(r.system_decision.toLowerCase())}, resolved by {r.reviewed_by}
                </span>
              )}
            </div>
            {r && (
              <p className="mt-0.5 text-xs text-slate-500">
                {new Date(r.created_at).toLocaleString()} · policy {r.policy_version}
              </p>
            )}
          </div>
          <Button variant="ghost" className="ml-auto !p-1.5" onClick={onClose} aria-label="Close">
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {isLoading && <Spinner />}
          <ErrorNote error={error} />
          {data && r && (
            <>
              {r.status === 'ESCALATED' && <ReviewPanel request={r} />}

              <div className="grid gap-3 sm:grid-cols-3">
                <Fact label="Customer">
                  <p className="font-medium">{r.customer_name}</p>
                  <p className="text-xs text-slate-500">
                    {r.customer_email} · {r.customer_tier}
                  </p>
                  {r.customer_flags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.customer_flags.map((f) => (
                        <FlagBadge key={f}>{humanize(f)}</FlagBadge>
                      ))}
                    </div>
                  )}
                </Fact>
                <Fact label="Order">
                  {data.order ? (
                    <>
                      <p className="font-medium">{data.order.orderNumber}</p>
                      <p className="text-xs text-slate-500">
                        {data.order.status} · {money(data.order.totalCents)}
                        {data.order.deliveredAt && ` · delivered ${shortDate(data.order.deliveredAt)}`}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">Not linked (unresolved or not owned by customer)</p>
                  )}
                </Fact>
                <Fact label="Amount">
                  <p className="font-medium tabular-nums">
                    {r.status === 'APPROVED' ? money(r.refund_amount_cents) : r.status === 'ESCALATED' ? `${money(r.review_amount_cents)} on hold` : 'No refund'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.ai_provider} · {r.ai_model} · {(r.latency_ms / 1000).toFixed(1)}s
                  </p>
                </Fact>
              </div>

              <Section icon={<ScrollText className="size-4" />} title="Customer message">
                <blockquote className="rounded-lg border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-700">
                  {r.customer_message}
                </blockquote>
              </Section>

              {r.extraction && <ExtractionView extraction={r.extraction} />}

              <Section icon={<Gavel className="size-4" />} title="Policy decision">
                {r.line_decisions.length > 0 && (
                  <table className="mb-3 w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className="py-1 font-medium">Item</th>
                        <th className="py-1 font-medium">Rules</th>
                        <th className="py-1 font-medium">Line outcome</th>
                        <th className="py-1 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.line_decisions.map((l) => (
                        <tr key={l.itemId}>
                          <td className="py-1.5 pr-2">
                            {l.name}
                            <span className="ml-1 font-mono text-[10px] text-slate-400">{l.sku}</span>
                          </td>
                          <td className="py-1.5 pr-2">
                            <div className="flex flex-wrap gap-1">
                              {l.ruleIds.map((id) => (
                                <Pill key={id}>{id}</Pill>
                              ))}
                            </div>
                          </td>
                          <td className="py-1.5">
                            <OutcomeBadge outcome={l.decision} />
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{money(l.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <ul className="space-y-1.5">
                  {r.rules_triggered.map((rule, i) => (
                    <li key={`${rule.id}-${i}`} className="flex items-start gap-2 text-sm">
                      <span
                        className={cx(
                          'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                          {
                            APPROVED: 'bg-emerald-100 text-emerald-800',
                            DENIED: 'bg-rose-100 text-rose-800',
                            ESCALATED: 'bg-amber-100 text-amber-900',
                            FLAG: 'bg-slate-200 text-slate-700',
                          }[rule.effect],
                        )}
                      >
                        {rule.effect}
                      </span>
                      <span>
                        <span className="font-mono text-xs font-medium">{rule.id}</span>
                        <span className="text-slate-600">: {rule.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section icon={<Bot className="size-4" />} title="Reply sent to customer">
                <p className="rounded-lg bg-brand-50/60 px-3 py-2 text-sm whitespace-pre-wrap text-slate-700 ring-1 ring-brand-600/10">{r.customer_reply}</p>
                {r.internal_note && (
                  <p className="mt-2 text-xs text-slate-600">
                    <span className="font-medium">AI note for reviewer:</span> {r.internal_note}
                  </p>
                )}
                {r.review_note && (
                  <p className="mt-2 text-xs text-slate-600">
                    <span className="font-medium">Reviewer note ({r.reviewed_by}):</span> {r.review_note}
                  </p>
                )}
              </Section>

              <Section title="Pipeline trace">
                <ol className="relative space-y-2 border-l border-slate-200 pl-4">
                  {r.trace.map((t, i) => (
                    <li key={i} className="relative text-sm">
                      <span
                        className={cx(
                          'absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-white',
                          { ok: 'bg-emerald-500', warn: 'bg-amber-500', fallback: 'bg-orange-500', error: 'bg-rose-500' }[t.status],
                        )}
                        aria-hidden
                      />
                      <span className="font-medium">{humanize(t.stage)}</span>
                      <span className="ml-2 text-xs tabular-nums text-slate-400">{t.ms} ms</span>
                      {t.status !== 'ok' && <Pill tone={t.status === 'warn' ? 'amber' : 'rose'}>{t.status}</Pill>}
                      {t.note && <p className="text-xs text-slate-500">{t.note}</p>}
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title="Audit trail">
                <ul className="space-y-1.5">
                  {data.events.map((e) => (
                    <li key={e.id} className="flex items-start gap-2 text-xs">
                      {e.severity !== 'info' ? (
                        <ShieldAlert className={cx('mt-0.5 size-3.5 shrink-0', e.severity === 'critical' ? 'text-rose-600' : 'text-amber-500')} aria-hidden />
                      ) : (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
                      )}
                      <span className="w-16 shrink-0 text-slate-400">{time(e.created_at)}</span>
                      <span className="font-mono font-medium">{e.type}</span>
                      <span className="truncate text-slate-500" title={JSON.stringify(e.detail)}>
                        {e.actor}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>

              <details className="rounded-lg border border-slate-200">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Full conversation ({data.transcript.length} messages)</summary>
                <ul className="space-y-2 border-t border-slate-100 p-3">
                  {data.transcript.map((m) => (
                    <li key={m.id} className="text-sm">
                      <span className="text-xs font-medium text-slate-500">
                        {m.role} · {relative(m.createdAt)}
                      </span>
                      <p className="whitespace-pre-wrap text-slate-700">{m.content}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewPanel({ request }: { request: RequestDetail }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const review = useMutation({
    mutationFn: (decision: 'APPROVED' | 'DENIED') =>
      api(`/admin/requests/${request.id}/review`, {
        method: 'POST',
        role: 'admin',
        body: { decision, note, ...(message.trim() && { customerMessage: message }) },
      }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const escalationRules = request.rules_triggered.filter((r) => r.effect === 'ESCALATED');
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2">
        <CircleAlert className="size-4 text-amber-700" aria-hidden />
        <h3 className="text-sm font-semibold text-amber-900">Needs a decision</h3>
        <span className="ml-auto text-sm font-semibold tabular-nums text-amber-900">{money(request.review_amount_cents)}</span>
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-900">
        {escalationRules.map((r, i) => (
          <li key={i}>
            <span className="font-medium">{humanize(r.id.toLowerCase())}:</span> {r.detail}
          </li>
        ))}
      </ul>
      <label className="mt-3 block text-xs font-medium text-slate-700">
        Decision note (internal, required)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm font-normal ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="e.g. Photos confirm the screen defect"
        />
      </label>
      <label className="mt-2 block text-xs font-medium text-slate-700">
        Extra message to customer (optional)
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm font-normal ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="Added to the standard update in their chat"
        />
      </label>
      <div className="mt-3 flex gap-2">
        <Button variant="success" disabled={note.trim().length < 3} loading={review.isPending && review.variables === 'APPROVED'} onClick={() => review.mutate('APPROVED')}>
          Approve {money(request.review_amount_cents)}
        </Button>
        <Button variant="danger" disabled={note.trim().length < 3} loading={review.isPending && review.variables === 'DENIED'} onClick={() => review.mutate('DENIED')}>
          Deny
        </Button>
      </div>
      <div className="mt-2">
        <ErrorNote error={review.error} />
      </div>
    </div>
  );
}

function ExtractionView({ extraction }: { extraction: Record<string, unknown> }) {
  const e = extraction as {
    intent: string;
    orderNumber: string | null;
    itemSkus: string[];
    reasonCategory: string;
    reasonSummary: string;
    claimedAmount: number | null;
    unknownItemMentions: string[];
    manipulationSignals: string[];
    confidence: number;
  };
  const pct = Math.round(e.confidence * 100);
  return (
    <Section icon={<Bot className="size-4" />} title="What the AI understood" hint="Structured output, validated against the database before use">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Field label="Intent">{humanize(e.intent)}</Field>
        <Field label="Reason">{humanize(e.reasonCategory)}</Field>
        <Field label="Order">{e.orderNumber ?? 'not stated'}</Field>
        <Field label="Confidence">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
              <div className={cx('h-full rounded-full', pct >= 60 ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular-nums">{pct}%</span>
          </div>
        </Field>
        <Field label="Items">{e.itemSkus.length ? e.itemSkus.join(', ') : 'whole order'}</Field>
        <Field label="Claimed amount">{e.claimedAmount !== null ? `$${e.claimedAmount}` : 'none'}</Field>
        <div className="col-span-2">
          <Field label="Summary">{e.reasonSummary}</Field>
        </div>
      </dl>
      {(e.manipulationSignals.length > 0 || e.unknownItemMentions.length > 0) && (
        <div className="mt-3 space-y-1 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-600/15">
          {e.manipulationSignals.map((s) => (
            <p key={s} className="flex items-center gap-1.5">
              <ShieldAlert className="size-3.5 shrink-0" aria-hidden /> {s}
            </p>
          ))}
          {e.unknownItemMentions.map((s) => (
            <p key={s}>Mentioned item not on any order: {s}</p>
          ))}
        </div>
      )}
    </Section>
  );
}

function Section({ title, icon, hint, children }: { title: string; icon?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <span className="text-slate-400">{icon}</span>
        {title}
        {hint && <span className="text-xs font-normal text-slate-400">· {hint}</span>}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <p className="mb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}
