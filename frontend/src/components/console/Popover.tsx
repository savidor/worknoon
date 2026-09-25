import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../lib/format';

/** A button that opens a small panel. Closes on outside click, Escape, or when `close` is called. */
export function Popover({
  label,
  icon,
  active,
  align = 'left',
  width = 'w-64',
  children,
}: {
  label: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  align?: 'left' | 'right';
  width?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ring-1 transition ring-inset',
          active ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
        )}
      >
        {icon}
        {label}
        <ChevronDown className={cx('size-3.5 transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div
          id={id}
          className={cx('absolute top-full z-30 mt-1.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg', width, align === 'right' ? 'right-0' : 'left-0')}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function OptionRow({ checked, onChange, children, count, name, type = 'checkbox' }: { checked: boolean; onChange: () => void; children: ReactNode; count?: number; name?: string; type?: 'checkbox' | 'radio' }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
      <input type={type} name={name} checked={checked} onChange={onChange} className="size-3.5 accent-slate-900" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="text-xs text-slate-400 tabular-nums">{count}</span>}
    </label>
  );
}
