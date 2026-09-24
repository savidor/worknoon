import { useQuery } from '@tanstack/react-query';
import { BookOpenText, LayoutDashboard, MessagesSquare, Sparkles } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { api, type Health } from '../api/client';
import { cx } from '../lib/format';

const NAV = [
  { to: '/', label: 'Customer chat', icon: MessagesSquare, end: true },
  { to: '/console', label: 'Support console', icon: LayoutDashboard },
  { to: '/policy', label: 'Refund policy', icon: BookOpenText },
];

function AiStatus() {
  const { data } = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health'), refetchInterval: 30_000 });
  if (!data) return null;
  const offline = data.ai.provider === 'mock';
  return (
    <span
      className={cx(
        'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset sm:inline-flex',
        offline ? 'bg-amber-50 text-amber-800 ring-amber-600/20' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
      )}
      title={offline ? 'No API key configured: heuristic extraction and template replies' : `Model: ${data.ai.model}`}
    >
      <Sparkles className="size-3.5" aria-hidden />
      {offline ? 'AI: offline mode' : `AI: ${data.ai.provider} · ${data.ai.model}`}
    </span>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="text-[15px] font-semibold tracking-tight">RefundDesk</span>
          </div>
          <nav className="flex items-center gap-1" aria-label="Main">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx(
                    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden md:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <AiStatus />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
