import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import { cx, humanize, relative } from '../../lib/format';

interface SecurityEvent {
  id: number;
  type: string;
  severity: string;
  detail: Record<string, unknown>;
  created_at: string;
  reference: string | null;
  customer_name: string | null;
  request_id: string | null;
}

/** What each event means, in words a support lead can read without a glossary. */
const EVENT_LABEL: Record<string, string> = {
  'security.manipulation_detected': 'Tried to trick the assistant',
  'security.ownership_mismatch': "Asked about someone else's order",
  'security.reply_blocked': 'Unsafe reply stopped before sending',
  'security.unknown_item_claim': 'Claimed an item they never bought',
};

export function SecurityFeed({ onOpen }: { onOpen: (requestId: string) => void }) {
  const { data } = useQuery({
    queryKey: ['security'],
    queryFn: () => api<{ events: SecurityEvent[] }>('/admin/security-events', { role: 'admin' }),
    refetchInterval: 10_000,
  });
  const events = data?.events ?? [];

  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="security-title">
      <header className="flex items-center gap-2 px-5 pt-4 pb-2">
        <h2 id="security-title" className="text-sm font-semibold">
          Security watch
        </h2>
        {events.length > 0 && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums">{events.length}</span>}
      </header>
      {!data ? (
        <div className="mx-5 mb-4 h-40 animate-pulse rounded-lg bg-slate-50" />
      ) : events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 pb-6 text-center">
          <ShieldCheck className="size-6 text-emerald-600" aria-hidden />
          <p className="text-sm font-medium">Quiet so far</p>
          <p className="text-xs text-slate-500">Attempts to trick the assistant or reach another customer's order show up here.</p>
        </div>
      ) : (
        <ul className="max-h-[248px] flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                disabled={!e.request_id}
                onClick={() => e.request_id && onOpen(e.request_id)}
                className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition enabled:hover:bg-slate-50"
              >
                <ShieldAlert className={cx('mt-0.5 size-4 shrink-0', e.severity === 'critical' ? 'text-rose-600' : 'text-amber-500')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-xs font-medium">{EVENT_LABEL[e.type] ?? humanize(e.type.replace('security.', ''))}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-slate-400">{relative(e.created_at)}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {e.customer_name ?? 'Unknown customer'}
                    {e.reference ? ` · ${e.reference}` : ''}
                    {typeof e.detail.excerpt === 'string' ? ` · "${e.detail.excerpt}"` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
