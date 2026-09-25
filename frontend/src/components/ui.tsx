import { CheckCircle2, CircleHelp, Info, Loader2, ShieldAlert, UserRoundSearch, XCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ApiError, type Outcome } from '../api/client';
import { cx } from '../lib/format';

export const OUTCOME_STYLE: Record<Outcome, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  APPROVED: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', icon: CheckCircle2 },
  DENIED: { label: 'Denied', className: 'bg-rose-50 text-rose-700 ring-rose-600/20', icon: XCircle },
  ESCALATED: { label: 'Escalated', className: 'bg-amber-50 text-amber-800 ring-amber-600/25', icon: UserRoundSearch },
  NEEDS_INFO: { label: 'Needs info', className: 'bg-sky-50 text-sky-700 ring-sky-600/20', icon: CircleHelp },
  INFO: { label: 'Info', className: 'bg-slate-100 text-slate-700 ring-slate-500/20', icon: Info },
};

export function OutcomeBadge({ outcome, label }: { outcome: Outcome; label?: string }) {
  const s = OUTCOME_STYLE[outcome];
  const Icon = s.icon;
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', s.className)}>
      <Icon className="size-3.5" aria-hidden />
      {label ?? s.label}
    </span>
  );
}

export function FlagBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-600/15">
      <ShieldAlert className="size-3" aria-hidden />
      {children}
    </span>
  );
}

export function Pill({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'brand' | 'amber' | 'rose' | 'emerald' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-50 text-amber-800',
    rose: 'bg-rose-50 text-rose-700',
    emerald: 'bg-emerald-50 text-emerald-700',
  };
  return <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>;
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const variants: Record<Variant, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
  };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/** Turns validation paths such as draft.customRules.0.conditions.1 into "Rule 1, condition 2". */
function friendlyPath(path: string): string {
  const rule = path.match(/customRules\.(\d+)/);
  const cond = path.match(/conditions\.(\d+)/);
  const field = (path.split('.').pop() ?? path).replace(/([A-Z])/g, ' $1').toLowerCase();
  if (rule) return [`Rule ${Number(rule[1]) + 1}`, cond ? `condition ${Number(cond[1]) + 1}` : field !== rule[1] ? field : ''].filter(Boolean).join(', ');
  // Threshold messages already name the setting.
  return '';
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const details = error instanceof ApiError ? error.details : [];
  return (
    <div role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
      {error instanceof Error ? error.message : 'Something went wrong'}
      {details.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          {details.map((d, i) => (
            <li key={i}>
              {friendlyPath(d.path) && <span className="font-medium">{friendlyPath(d.path)}: </span>}
              {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Soft tones with dark text, each above 4.5:1 contrast. Picked per name so a customer keeps their colour.
const AVATAR_TONES = [
  'bg-rose-100 text-rose-800',
  'bg-amber-100 text-amber-900',
  'bg-lime-100 text-lime-900',
  'bg-emerald-100 text-emerald-800',
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-fuchsia-100 text-fuchsia-800',
  'bg-orange-100 text-orange-900',
];

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cx('inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', AVATAR_TONES[hash % AVATAR_TONES.length], className)}
    >
      {initials}
    </span>
  );
}
