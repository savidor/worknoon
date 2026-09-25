import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseZap, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminUsername, api, ApiError, type Stats } from '../api/client';
import { AdminGate, ConsoleTabs } from '../components/AdminGate';
import { CaseDrawer } from '../components/CaseDrawer';
import { ActivityChart, RANGES, type Range } from '../components/console/ActivityChart';
import { CasesTable } from '../components/console/CasesTable';
import { Overview, type QuickView } from '../components/console/Overview';
import { SecurityFeed } from '../components/console/SecurityFeed';
import { Button } from '../components/ui';
import { money } from '../lib/format';

export function ConsolePage() {
  return <AdminGate>{(logout) => <Console onLogout={logout} />}</AdminGate>;
}

function Console({ onLogout }: { onLogout: () => void }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const range = (RANGES.find((r) => String(r) === params.get('range')) ?? 7) as Range;

  const stats = useQuery({
    queryKey: ['stats', range],
    queryFn: () => api<Stats>(`/admin/stats?days=${range}`, { role: 'admin' }),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });

  const reset = useMutation({
    mutationFn: () => api('/admin/demo/reset', { method: 'POST', role: 'admin' }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const sessionExpired = stats.error instanceof ApiError && stats.error.status === 401;
  useEffect(() => {
    if (sessionExpired) onLogout();
  }, [sessionExpired, onLogout]);

  const setRange = (r: Range) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (r === 7) p.delete('range');
        else p.set('range', String(r));
        return p;
      },
      { replace: true },
    );

  // The overview tiles are shortcuts: each one opens the table on the matching cases.
  const pick = (view: QuickView) => {
    const p = new URLSearchParams();
    if (params.get('range')) p.set('range', params.get('range')!);
    if (view === 'auto') p.set('decided', 'auto');
    else p.set('view', view);
    setParams(p, { replace: true });
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Greeting stats={stats.data} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ConsoleTabs />
          <Button
            variant="ghost"
            onClick={() => window.confirm('Reset demo data? Cases, conversations and policy changes are replaced with the original policy and a fresh week of sample activity.') && reset.mutate()}
            loading={reset.isPending}
            title="Reset demo data"
          >
            <DatabaseZap className="size-4" aria-hidden /> <span className="hidden sm:inline">Reset demo</span>
          </Button>
          <Button variant="ghost" onClick={onLogout} title="Sign out">
            <LogOut className="size-4" aria-hidden /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>

      <Overview stats={stats.data} onPick={pick} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <ActivityChart stats={stats.data} range={range} onRange={setRange} />
        <SecurityFeed onOpen={setOpenId} />
      </div>

      <div ref={tableRef} className="scroll-mt-20">
        <CasesTable openId={openId} onOpen={setOpenId} />
      </div>

      {openId && <CaseDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** A short, human summary of where things stand, so the page opens with an answer rather than a grid. */
function Greeting({ stats: s }: { stats: Stats | undefined }) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const raw = adminUsername();
  const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : null;
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  let summary = 'Loading the latest cases...';
  if (s) {
    const handled = s.total - s.pending_review;
    if (s.total === 0) summary = 'No cases yet. When a customer asks for a refund, it will show up here.';
    else if (s.pending_review === 0) summary = `You're all caught up. All ${s.total} cases have a decision.`;
    else
      summary = `${s.pending_review} ${s.pending_review === 1 ? 'case is' : 'cases are'} waiting for you, ${money(s.pending_cents)} in total. The other ${handled} already have a decision.`;
  }

  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500">{date}</p>
      <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
        Good {part}
        {name ? `, ${name}` : ''}
      </h1>
      <p className="mt-0.5 text-sm text-slate-600">{summary}</p>
    </div>
  );
}
