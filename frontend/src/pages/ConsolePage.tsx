import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, DatabaseZap, LogOut, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, tokens, type Decision, type RequestSummary, type Stats } from '../api/client';
import { CaseDrawer } from '../components/CaseDrawer';
import { DecisionsChart } from '../components/DecisionsChart';
import { Button, Card, ErrorNote, FlagBadge, OutcomeBadge, Pill, Spinner } from '../components/ui';
import { cx, humanize, money, relative } from '../lib/format';

type Filter = 'all' | Decision | 'flagged';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ESCALATED', label: 'Needs review' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'DENIED', label: 'Denied' },
  { id: 'flagged', label: 'Flagged' },
];

export function ConsolePage() {
  const [authed, setAuthed] = useState(() => !!tokens.get('admin'));
  if (!authed) return <AdminLogin onDone={() => setAuthed(true)} />;
  return (
    <Console
      onLogout={() => {
        tokens.set('admin', null);
        setAuthed(false);
      }}
    />
  );
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('reviewer');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<{ token: string }>('/auth/admin/login', { method: 'POST', body: { username, password } }),
    onSuccess: (r) => {
      tokens.set('admin', r.token);
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <Card>
        <form onSubmit={submit} className="space-y-4 p-6">
          <div>
            <h1 className="text-lg font-semibold">Support console</h1>
            <p className="text-sm text-slate-500">Sign in to review refund decisions.</p>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">Name</span>
            <input className="mt-1 w-full rounded-lg px-3 py-2 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Password</span>
            <input type="password" className="mt-1 w-full rounded-lg px-3 py-2 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
          </label>
          <ErrorNote error={login.error} />
          <Button type="submit" className="w-full" loading={login.isPending}>
            Sign in
          </Button>
          <p className="text-center text-xs text-slate-400">Demo password: set by ADMIN_PASSWORD (default in README)</p>
        </form>
      </Card>
    </div>
  );
}

function Console({ onLogout }: { onLogout: () => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/admin/stats', { role: 'admin' }), refetchInterval: 5_000 });

  const params = new URLSearchParams({ limit: '50' });
  if (filter === 'flagged') params.set('flagged', 'true');
  else if (filter !== 'all') params.set('status', filter);
  if (q.trim()) params.set('q', q.trim());
  const requests = useQuery({
    queryKey: ['requests', params.toString()],
    queryFn: () => api<{ total: number; items: RequestSummary[] }>(`/admin/requests?${params}`, { role: 'admin' }),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });

  const security = useQuery({
    queryKey: ['security'],
    queryFn: () => api<{ events: Array<{ id: number; type: string; severity: string; detail: Record<string, unknown>; created_at: string; reference: string | null; customer_name: string | null; request_id: string | null }> }>('/admin/security-events', { role: 'admin' }),
    refetchInterval: 10_000,
  });

  const reset = useMutation({
    mutationFn: () => api('/admin/demo/reset', { method: 'POST', role: 'admin' }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const sessionExpired = stats.error instanceof ApiError && stats.error.status === 401;
  useEffect(() => {
    if (sessionExpired) onLogout();
  }, [sessionExpired, onLogout]);

  const s = stats.data;
  const autoRate = s && s.total > 0 ? Math.round(((s.total - s.escalated_total) / s.total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Support console</h1>
          <p className="text-sm text-slate-500">Every decision, the reasoning behind it, and a queue for the cases that need a person.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            onClick={() => window.confirm('Reset all demo data? Cases and conversations will be deleted.') && reset.mutate()}
            loading={reset.isPending}
          >
            <DatabaseZap className="size-4" aria-hidden /> Reset demo data
          </Button>
          <Button variant="ghost" onClick={onLogout}>
            <LogOut className="size-4" aria-hidden /> Sign out
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Cases" value={s?.total ?? 0} hint={`${s?.human_reviewed ?? 0} reviewed by a person`} />
        <Stat label="Resolved automatically" value={`${autoRate}%`} hint="Approved or denied without review" />
        <Stat label="Needs review" value={s?.pending_review ?? 0} hint={`${money(s?.pending_cents)} on hold`} tone={s?.pending_review ? 'amber' : undefined} />
        <Stat label="Refunded" value={money(s?.refunded_cents)} hint={`${s?.approved ?? 0} approved · ${s?.denied ?? 0} denied`} />
        <Stat label="Flagged" value={s?.flagged ?? 0} hint="Risk or security signals" tone={s?.flagged ? 'rose' : undefined} />
        <Stat label="Avg decision time" value={`${((s?.avg_latency_ms ?? 0) / 1000).toFixed(1)}s`} hint="End to end, incl. AI" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title={
            <span className="flex items-center gap-2">
              Refund requests <Pill>{requests.data?.total ?? 0}</Pill>
            </span>
          }
          action={
            <label className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Reference, customer, order"
                aria-label="Search requests"
                className="w-56 rounded-lg py-1.5 pr-3 pl-8 text-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500"
              />
            </label>
          }
        >
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cx(
                  'rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap transition',
                  filter === f.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {f.label}
                {f.id === 'ESCALATED' && !!s?.pending_review && (
                  <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{s.pending_review}</span>
                )}
              </button>
            ))}
          </div>
          {requests.isLoading ? (
            <Spinner />
          ) : requests.data?.items.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              No refund requests yet. Send one from the customer chat and it will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Case</th>
                    <th className="px-4 py-2 font-medium">Customer</th>
                    <th className="px-4 py-2 font-medium">Reason</th>
                    <th className="px-4 py-2 font-medium">Outcome</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.data?.items.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setOpenId(r.id)}
                      onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)}
                      tabIndex={0}
                      className={cx('cursor-pointer transition hover:bg-slate-50 focus:bg-brand-50 focus:outline-none', openId === r.id && 'bg-brand-50/60')}
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-mono text-xs font-medium whitespace-nowrap">{r.reference}</p>
                        <p className="text-xs text-slate-500">{r.order_number ?? 'no order'}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{r.customer_name}</p>
                        {r.risk_flags.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {r.risk_flags.slice(0, 2).map((f) => (
                              <FlagBadge key={f}>{humanize(f)}</FlagBadge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[260px] px-4 py-2.5">
                        <p className="text-xs font-medium text-slate-700">{humanize(r.reason_category)}</p>
                        <p className="truncate text-xs text-slate-500" title={r.customer_message}>
                          {r.customer_message}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <OutcomeBadge outcome={r.status} />
                        {r.reviewed_at && <p className="mt-0.5 text-[11px] text-slate-500">by {r.reviewed_by}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {r.status === 'APPROVED' ? money(r.refund_amount_cents) : r.status === 'ESCALATED' ? <span className="text-slate-500">{money(r.review_amount_cents)}</span> : <span className="text-slate-400">n/a</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" aria-hidden />
                          {relative(r.created_at)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Decisions, last 7 days">
            <div className="p-4">{s ? <DecisionsChart daily={s.daily} /> : <Spinner />}</div>
          </Card>
          <Card title="Security log" action={<ShieldCheck className="size-4 text-slate-400" aria-hidden />}>
            {security.data?.events.length ? (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto scrollbar-thin">
                {security.data.events.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      disabled={!e.request_id}
                      onClick={() => e.request_id && setOpenId(e.request_id)}
                      className="w-full px-4 py-2.5 text-left transition enabled:hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldAlert className={cx('size-4', e.severity === 'critical' ? 'text-rose-600' : 'text-amber-500')} aria-hidden />
                        <span className="text-xs font-medium">{humanize(e.type.replace('security.', ''))}</span>
                        <span className="ml-auto text-[11px] text-slate-400">{relative(e.created_at)}</span>
                      </div>
                      <p className="mt-0.5 truncate pl-6 text-xs text-slate-500">
                        {e.customer_name ?? 'Unknown'}
                        {e.reference ? ` · ${e.reference}` : ''}
                        {typeof e.detail.excerpt === 'string' ? ` · "${e.detail.excerpt}"` : ''}
                        {Array.isArray(e.detail.violations) ? ` · ${(e.detail.violations as string[]).join(', ')}` : ''}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-slate-500">No security events. Try the prompt injection scenario (Emily Nguyen).</p>
            )}
          </Card>
        </div>
      </div>

      {openId && <CaseDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'amber' | 'rose' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cx('mt-1 text-2xl font-semibold tabular-nums', tone === 'amber' && 'text-amber-700', tone === 'rose' && 'text-rose-700')}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
