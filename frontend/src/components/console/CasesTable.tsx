import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Rows3,
  Rows4,
  Search,
  ShieldAlert,
  Tag,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, download, type RequestPage, type RequestSummary } from '../../api/client';
import { cx, duration, humanize, money, relative } from '../../lib/format';
import { Avatar, FlagBadge, OutcomeBadge } from '../ui';
import { OptionRow, Popover } from './Popover';

type View = 'all' | 'ESCALATED' | 'APPROVED' | 'DENIED' | 'flagged';
type SortKey = 'created' | 'amount' | 'customer' | 'reference' | 'status' | 'reason';
type ColumnId = 'case' | 'customer' | 'reason' | 'outcome' | 'decidedBy' | 'speed' | 'amount' | 'when';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ESCALATED', label: 'Needs review' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'DENIED', label: 'Denied' },
  { id: 'flagged', label: 'Flagged' },
];

const COLUMNS: Array<{ id: ColumnId; label: string; sort?: SortKey; align?: 'right'; locked?: boolean; hiddenByDefault?: boolean }> = [
  { id: 'case', label: 'Case', sort: 'reference', locked: true },
  { id: 'customer', label: 'Customer', sort: 'customer', locked: true },
  { id: 'reason', label: 'Reason', sort: 'reason' },
  { id: 'outcome', label: 'Outcome', sort: 'status' },
  { id: 'decidedBy', label: 'Decided by', hiddenByDefault: true },
  { id: 'speed', label: 'Decision time', hiddenByDefault: true },
  { id: 'amount', label: 'Amount', sort: 'amount', align: 'right' },
  { id: 'when', label: 'When', sort: 'created' },
];

const DATE_RANGES = [
  { days: undefined, label: 'Any time' },
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const;

const DECIDED_BY = [
  { value: undefined, label: 'Anyone' },
  { value: 'auto', label: 'RefundDesk on its own' },
  { value: 'team', label: 'Your team' },
] as const;

const PAGE_SIZES = [10, 25, 50] as const;

/** Signal names written for people, not engineers. */
const SIGNAL_LABEL: Record<string, string> = {
  manipulation_attempt: 'Manipulation attempt',
  claim_mismatch: 'Claim does not match',
  order_ownership: "Someone else's order",
  refund_frequency: 'Frequent refunds',
  account_flag: 'Account flag',
  delivery_conflict: 'Delivery conflict',
};
const signalLabel = (s: string) => SIGNAL_LABEL[s] ?? humanize(s);

// ---------------------------------------------------------------------------------------------
// Table state lives in the URL: a filtered view survives a refresh and can be shared as a link.

interface TableState {
  view: View;
  q: string;
  reasons: string[];
  signals: string[];
  decidedBy?: 'auto' | 'team';
  sinceDays?: number;
  minCents?: number;
  maxCents?: number;
  sort: SortKey;
  dir: 'asc' | 'desc';
  page: number;
  size: number;
}

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
const num = (v: string | null) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);

function readState(p: URLSearchParams): TableState {
  const view = p.get('view') as View | null;
  const sort = p.get('sort') as SortKey | null;
  const size = num(p.get('size'));
  return {
    view: view && VIEWS.some((v) => v.id === view) ? view : 'all',
    q: p.get('q') ?? '',
    reasons: list(p.get('reason')),
    signals: list(p.get('signal')),
    decidedBy: p.get('decided') === 'auto' || p.get('decided') === 'team' ? (p.get('decided') as 'auto' | 'team') : undefined,
    sinceDays: num(p.get('since')),
    minCents: num(p.get('min')),
    maxCents: num(p.get('max')),
    sort: sort && COLUMNS.some((c) => c.sort === sort) ? sort : 'created',
    dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, num(p.get('page')) ?? 1),
    size: PAGE_SIZES.includes(size as 10) ? size! : 10,
  };
}

function useTableState() {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => readState(params), [params]);
  const patch = (next: Partial<TableState>) => {
    const s = { ...state, page: 1, ...next };
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const put = (key: string, value: string | number | undefined, fallback?: string | number) =>
          value === undefined || value === '' || value === fallback ? p.delete(key) : p.set(key, String(value));
        put('view', s.view, 'all');
        put('q', s.q.trim());
        put('reason', s.reasons.join(','));
        put('signal', s.signals.join(','));
        put('decided', s.decidedBy);
        put('since', s.sinceDays);
        put('min', s.minCents);
        put('max', s.maxCents);
        put('sort', s.sort, 'created');
        put('dir', s.dir, 'desc');
        put('page', s.page, 1);
        put('size', s.size, 10);
        return p;
      },
      { replace: true },
    );
  };
  return [state, patch] as const;
}

/** Query string for the API: the same filters the table shows, in the server's names. */
function filterQuery(s: TableState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.view === 'flagged') p.set('flagged', 'true');
  else if (s.view !== 'all') p.set('status', s.view);
  if (s.q.trim()) p.set('q', s.q.trim());
  if (s.reasons.length) p.set('reasons', s.reasons.join(','));
  if (s.signals.length) p.set('signals', s.signals.join(','));
  if (s.decidedBy) p.set('decidedBy', s.decidedBy);
  if (s.sinceDays) p.set('sinceDays', String(s.sinceDays));
  if (s.minCents !== undefined) p.set('minCents', String(s.minCents));
  if (s.maxCents !== undefined) p.set('maxCents', String(s.maxCents));
  p.set('sort', s.sort);
  p.set('dir', s.dir);
  return p;
}

// Per-viewer preferences. Storage can be unavailable (private windows), so every access is guarded.
function usePref<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* preference lasts for this page only */
    }
  };
  return [value, update] as const;
}

// ---------------------------------------------------------------------------------------------

export function CasesTable({ openId, onOpen }: { openId: string | null; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [s, patch] = useTableState();
  const [hidden, setHidden] = usePref<ColumnId[]>('rd.console.hiddenColumns', COLUMNS.filter((c) => c.hiddenByDefault).map((c) => c.id));
  const [compact, setCompact] = usePref('rd.console.compact', false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Search updates the URL after a short pause, so typing does not fire a request per key.
  const [search, setSearch] = useState(s.q);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => setSearch(s.q), [s.q]);
  useEffect(() => {
    if (search === s.q) return;
    const t = setTimeout(() => patch({ q: search }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // "/" jumps to search from anywhere on the page, as in most admin tools.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== '/' || el.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const filters = filterQuery(s);
  const pageParams = new URLSearchParams(filters);
  pageParams.set('limit', String(s.size));
  pageParams.set('offset', String((s.page - 1) * s.size));
  const query = useQuery({
    queryKey: ['requests', pageParams.toString()],
    queryFn: () => api<RequestPage>(`/admin/requests?${pageParams}`, { role: 'admin' }),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / s.size));

  // A page past the end (after a filter shrinks the list) moves back to the last real page.
  useEffect(() => {
    if (data && s.page > pages) patch({ page: pages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pages, s.page]);

  const columns = COLUMNS.filter((c) => c.locked || !hidden.includes(c.id));
  const facets = data?.facets;

  const activeChips: Array<{ key: string; label: ReactNode; clear: () => void }> = [];
  if (s.q) activeChips.push({ key: 'q', label: <>Search: "{s.q}"</>, clear: () => patch({ q: '' }) });
  if (s.reasons.length) activeChips.push({ key: 'r', label: <>Reason: {s.reasons.map(humanize).join(', ')}</>, clear: () => patch({ reasons: [] }) });
  if (s.signals.length) activeChips.push({ key: 's', label: <>Signal: {s.signals.map(signalLabel).join(', ')}</>, clear: () => patch({ signals: [] }) });
  if (s.decidedBy) activeChips.push({ key: 'd', label: <>Decided by: {DECIDED_BY.find((d) => d.value === s.decidedBy)?.label}</>, clear: () => patch({ decidedBy: undefined }) });
  if (s.sinceDays) activeChips.push({ key: 't', label: <>{DATE_RANGES.find((d) => d.days === s.sinceDays)?.label ?? `Last ${s.sinceDays} days`}</>, clear: () => patch({ sinceDays: undefined }) });
  if (s.minCents !== undefined || s.maxCents !== undefined)
    activeChips.push({ key: 'a', label: <>Amount: {amountRangeLabel(s.minCents, s.maxCents)}</>, clear: () => patch({ minCents: undefined, maxCents: undefined }) });
  const clearAll = () => patch({ q: '', reasons: [], signals: [], decidedBy: undefined, sinceDays: undefined, minCents: undefined, maxCents: undefined });

  const toggleSort = (key: SortKey) =>
    patch({ sort: key, dir: s.sort === key ? (s.dir === 'desc' ? 'asc' : 'desc') : key === 'customer' || key === 'reference' || key === 'reason' ? 'asc' : 'desc', page: s.page });

  const pageIds = items.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allOnPage ? next.delete(id) : next.add(id)));
      return next;
    });

  const runExport = async (ids?: string[]) => {
    setExporting(true);
    setExportError(null);
    try {
      const p = new URLSearchParams(filters);
      if (ids) p.set('ids', ids.join(','));
      await download(`/admin/requests/export?${p}`, 'admin', 'refund-cases.csv');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const prefetch = (id: string) =>
    void qc.prefetchQuery({ queryKey: ['request', id], queryFn: () => api(`/admin/requests/${id}`, { role: 'admin' }), staleTime: 10_000 });

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, r: RequestSummary) => {
    const row = e.currentTarget;
    if (e.key === 'Enter') onOpen(r.id);
    else if (e.key === 'x' || e.key === 'X') toggle(r.id);
    else if (e.key === 'ArrowDown' || e.key === 'j') (row.nextElementSibling as HTMLElement | null)?.focus();
    else if (e.key === 'ArrowUp' || e.key === 'k') (row.previousElementSibling as HTMLElement | null)?.focus();
    else return;
    e.preventDefault();
  };

  const cell = compact ? 'px-3 py-1.5' : 'px-3 py-3';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="cases-title">
      {/* Title, views and search */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 pt-4">
        <h2 id="cases-title" className="text-sm font-semibold">
          Cases
        </h2>
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Case views">
          {VIEWS.map((v) => {
            const count = facets?.status[v.id === 'all' ? 'all' : v.id];
            return (
              <button
                key={v.id}
                type="button"
                aria-current={s.view === v.id ? 'true' : undefined}
                onClick={() => patch({ view: v.id })}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm whitespace-nowrap transition',
                  s.view === v.id ? 'bg-slate-900 font-medium text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {v.label}
                {count !== undefined && (
                  <span
                    className={cx(
                      'rounded-full px-1.5 text-[11px] tabular-nums',
                      s.view === v.id ? 'bg-white/20' : v.id === 'ESCALATED' && count > 0 ? 'bg-amber-100 font-medium text-amber-800' : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <label className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
            placeholder="Search cases, names, orders"
            aria-label="Search cases"
            className="w-full rounded-lg bg-slate-50 py-1.5 pr-8 pl-8 text-sm ring-1 ring-slate-200 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-500"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 text-[10px] text-slate-400">/</kbd>
        </label>
      </header>

      {/* Filters and table tools */}
      <div className="flex flex-wrap items-center gap-2 px-5 pt-3 pb-3">
        <Popover label={s.reasons.length ? `Reason (${s.reasons.length})` : 'Reason'} icon={<Tag className="size-3.5" aria-hidden />} active={s.reasons.length > 0}>
          {() => (
            <MultiSelect
              options={withSelected(facets?.reasons ?? [], s.reasons)}
              selected={s.reasons}
              render={humanize}
              onChange={(reasons) => patch({ reasons })}
              empty="No reasons yet"
            />
          )}
        </Popover>
        <Popover label={s.signals.length ? `Risk signal (${s.signals.length})` : 'Risk signal'} icon={<ShieldAlert className="size-3.5" aria-hidden />} active={s.signals.length > 0}>
          {() => (
            <MultiSelect
              options={withSelected(facets?.signals ?? [], s.signals)}
              selected={s.signals}
              render={signalLabel}
              onChange={(signals) => patch({ signals })}
              empty="No risk signals in these cases"
            />
          )}
        </Popover>
        <Popover label="Decided by" icon={<UserRound className="size-3.5" aria-hidden />} active={!!s.decidedBy}>
          {(close) =>
            DECIDED_BY.map((d) => (
              <OptionRow
                key={d.label}
                type="radio"
                name="decided-by"
                checked={s.decidedBy === d.value}
                onChange={() => {
                  patch({ decidedBy: d.value });
                  close();
                }}
              >
                {d.label}
              </OptionRow>
            ))
          }
        </Popover>
        <Popover label="Date" icon={<CalendarDays className="size-3.5" aria-hidden />} active={!!s.sinceDays} width="w-52">
          {(close) =>
            DATE_RANGES.map((d) => (
              <OptionRow
                key={d.label}
                type="radio"
                name="date-range"
                checked={s.sinceDays === d.days}
                onChange={() => {
                  patch({ sinceDays: d.days });
                  close();
                }}
              >
                {d.label}
              </OptionRow>
            ))
          }
        </Popover>
        <Popover label="Amount" icon={<Wallet className="size-3.5" aria-hidden />} active={s.minCents !== undefined || s.maxCents !== undefined}>
          {(close) => (
            <AmountFilter
              min={s.minCents}
              max={s.maxCents}
              onApply={(minCents, maxCents) => {
                patch({ minCents, maxCents });
                close();
              }}
            />
          )}
        </Popover>

        <div className="ml-auto flex items-center gap-2">
          <Popover label="Columns" icon={<Columns3 className="size-3.5" aria-hidden />} align="right" width="w-56">
            {() => (
              <>
                <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-slate-500">Show columns</p>
                {COLUMNS.filter((c) => !c.locked).map((c) => (
                  <OptionRow key={c.id} checked={!hidden.includes(c.id)} onChange={() => setHidden(hidden.includes(c.id) ? hidden.filter((h) => h !== c.id) : [...hidden, c.id])}>
                    {c.label}
                  </OptionRow>
                ))}
              </>
            )}
          </Popover>
          <button
            type="button"
            onClick={() => setCompact(!compact)}
            aria-pressed={compact}
            title={compact ? 'Comfortable rows' : 'Compact rows'}
            className="inline-flex size-8 items-center justify-center rounded-lg text-slate-600 ring-1 ring-slate-200 transition ring-inset hover:bg-slate-50"
          >
            {compact ? <Rows3 className="size-4" aria-hidden /> : <Rows4 className="size-4" aria-hidden />}
            <span className="sr-only">Compact rows</span>
          </button>
          <button
            type="button"
            onClick={() => runExport()}
            disabled={exporting || total === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition ring-inset hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="size-3.5" aria-hidden /> Export
          </button>
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
          {activeChips.map((c) => (
            <span key={c.key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-2.5 text-xs text-slate-700">
              <span className="truncate">{c.label}</span>
              <button type="button" onClick={c.clear} className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900" aria-label="Remove filter">
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <button type="button" onClick={clearAll} className="px-1.5 text-xs font-medium text-slate-500 hover:text-slate-900">
            Clear all
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mx-5 mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white" role="region" aria-label="Selection">
          <span className="tabular-nums">
            {selected.size} selected
          </span>
          <button type="button" onClick={() => runExport([...selected])} disabled={exporting} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-white/10">
            <Download className="size-3.5" aria-hidden /> Export selected
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white">
            Clear selection
          </button>
        </div>
      )}
      {exportError && (
        <p role="alert" className="mx-5 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {exportError}
        </p>
      )}

      {/* Table */}
      <div className="relative overflow-x-auto border-t border-slate-100">
        {query.isFetching && query.isPlaceholderData && <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-brand-500" aria-hidden />}
        <table className="w-full text-sm" aria-rowcount={total}>
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="w-10 py-2 pr-1 pl-5">
                <Checkbox checked={allOnPage} indeterminate={!allOnPage && someOnPage} onChange={togglePage} label="Select all cases on this page" />
              </th>
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={c.sort && s.sort === c.sort ? (s.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cx('px-3 py-2 font-medium whitespace-nowrap', c.align === 'right' && 'text-right')}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.sort!)}
                      className={cx('group inline-flex items-center gap-1 rounded hover:text-slate-900', s.sort === c.sort && 'text-slate-900')}
                    >
                      {c.label}
                      {s.sort === c.sort ? (
                        s.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />
                      ) : (
                        <ArrowUpDown className="size-3 opacity-0 transition group-hover:opacity-60" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {query.isLoading ? (
              Array.from({ length: 5 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={columns.length + 1} className="px-5 py-3">
                    <div className="h-8 animate-pulse rounded-lg bg-slate-50" />
                  </td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1}>
                  <EmptyState view={s.view} filtered={activeChips.length > 0} onClear={clearAll} />
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  aria-selected={selected.has(r.id)}
                  onClick={() => onOpen(r.id)}
                  // Load the case while the pointer is on its way, so the drawer opens with data.
                  onMouseEnter={() => prefetch(r.id)}
                  onFocus={() => prefetch(r.id)}
                  onKeyDown={(e) => onRowKey(e, r)}
                  className={cx(
                    'cursor-pointer transition outline-none hover:bg-slate-50 focus-visible:bg-brand-50/70',
                    openId === r.id && 'bg-brand-50/60',
                    selected.has(r.id) && 'bg-slate-50',
                  )}
                >
                  <td className="py-2 pr-1 pl-5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={`Select ${r.reference}`} />
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className={cx(cell, c.align === 'right' && 'text-right')}>
                      <Cell id={c.id} r={r} q={s.q} compact={compact} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: paging and keyboard help */}
      <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
        <label className="flex items-center gap-2">
          Rows per page
          <select value={s.size} onChange={(e) => patch({ size: Number(e.target.value) })} className="rounded-md bg-white py-1 pr-6 pl-2 text-xs text-slate-700 ring-1 ring-slate-200 outline-none">
            {PAGE_SIZES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <span className="tabular-nums">
          {total === 0 ? '0 cases' : `${(s.page - 1) * s.size + 1} to ${Math.min(s.page * s.size, total)} of ${total}`}
        </span>
        <p className="hidden items-center gap-1.5 lg:flex">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move <Kbd>Enter</Kbd> open <Kbd>X</Kbd> select <Kbd>/</Kbd> search
        </p>
        <Pager page={s.page} pages={pages} onPage={(page) => patch({ page })} />
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function Cell({ id, r, q, compact }: { id: ColumnId; r: RequestSummary; q: string; compact: boolean }) {
  switch (id) {
    case 'case':
      return (
        <div className="whitespace-nowrap">
          <p className="font-mono text-xs font-medium">
            <Mark text={r.reference} q={q} />
          </p>
          {!compact && (
            <p className="text-xs text-slate-500">
              <Mark text={r.order_number ?? 'No order'} q={q} />
            </p>
          )}
        </div>
      );
    case 'customer':
      return (
        <div className="flex min-w-44 items-center gap-2.5">
          {!compact && <Avatar name={r.customer_name} />}
          <div className="min-w-0">
            <p className="truncate font-medium">
              <Mark text={r.customer_name} q={q} />
            </p>
            {r.risk_flags.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {r.risk_flags.slice(0, compact ? 1 : 2).map((f) => (
                  <FlagBadge key={f}>{signalLabel(f)}</FlagBadge>
                ))}
                {r.risk_flags.length > (compact ? 1 : 2) && <span className="text-[11px] text-slate-500">+{r.risk_flags.length - (compact ? 1 : 2)}</span>}
              </div>
            )}
          </div>
        </div>
      );
    case 'reason':
      return (
        <div className="max-w-[300px] min-w-40">
          <p className="text-xs font-medium text-slate-700">{humanize(r.reason_category)}</p>
          {!compact && (
            <p className="truncate text-xs text-slate-500" title={r.customer_message}>
              <Mark text={r.customer_message} q={q} />
            </p>
          )}
        </div>
      );
    case 'outcome':
      return (
        <div className="whitespace-nowrap">
          <OutcomeBadge outcome={r.status} label={r.status === 'ESCALATED' ? 'Needs review' : undefined} />
          {r.reviewed_at && !compact && <p className="mt-0.5 text-[11px] text-slate-500">by {r.reviewed_by}</p>}
        </div>
      );
    case 'decidedBy':
      return r.reviewed_by ? (
        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-slate-700">
          <UserRound className="size-3.5 text-slate-400" aria-hidden /> {r.reviewed_by}
        </span>
      ) : r.status === 'ESCALATED' ? (
        <span className="text-xs text-amber-700">Waiting</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-slate-700">
          <Bot className="size-3.5 text-slate-400" aria-hidden /> RefundDesk
        </span>
      );
    case 'speed':
      return <span className="text-xs text-slate-600 tabular-nums">{duration(r.latency_ms)}</span>;
    case 'amount':
      return (
        <span className="whitespace-nowrap tabular-nums">
          {r.status === 'APPROVED' ? (
            <span className="font-medium">{money(r.refund_amount_cents)}</span>
          ) : r.status === 'ESCALATED' ? (
            <span className="text-slate-500" title="Amount waiting on a decision">
              {money(r.review_amount_cents)}
            </span>
          ) : (
            <span className="text-slate-400">n/a</span>
          )}
        </span>
      );
    case 'when':
      return (
        <time dateTime={r.created_at} title={new Date(r.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} className="text-xs whitespace-nowrap text-slate-500">
          {relative(r.created_at)}
        </time>
      );
  }
}

/** Highlights the search text inside a value, so it is clear why a row matched. */
function Mark({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  if (!needle) return <>{text}</>;
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === needle.toLowerCase() ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-inherit">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Checkbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="size-3.5 cursor-pointer accent-slate-900" />;
}

function MultiSelect({
  options,
  selected,
  render,
  onChange,
  empty,
}: {
  options: Array<{ value: string; count: number }>;
  selected: string[];
  render: (v: string) => string;
  onChange: (next: string[]) => void;
  empty: string;
}) {
  if (options.length === 0) return <p className="px-2 py-3 text-center text-xs text-slate-500">{empty}</p>;
  return (
    <>
      <div className="max-h-64 overflow-y-auto scrollbar-thin">
        {options.map((o) => (
          <OptionRow
            key={o.value}
            checked={selected.includes(o.value)}
            count={o.count}
            onChange={() => onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
          >
            {render(o.value)}
          </OptionRow>
        ))}
      </div>
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900">
          Clear selection
        </button>
      )}
    </>
  );
}

/** Keeps chosen options in the menu even when the other filters leave them with no cases. */
function withSelected(options: Array<{ value: string; count: number }>, selected: string[]) {
  const missing = selected.filter((v) => !options.some((o) => o.value === v)).map((value) => ({ value, count: 0 }));
  return [...options, ...missing];
}

function AmountFilter({ min, max, onApply }: { min?: number; max?: number; onApply: (min?: number, max?: number) => void }) {
  const [lo, setLo] = useState(min !== undefined ? String(min / 100) : '');
  const [hi, setHi] = useState(max !== undefined ? String(max / 100) : '');
  const toCents = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Math.max(0, Math.round(Number(v) * 100)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    let a = toCents(lo);
    let b = toCents(hi);
    if (a !== undefined && b !== undefined && a > b) [a, b] = [b, a];
    onApply(a, b);
  };
  const input = 'w-full rounded-lg py-1.5 pr-2 pl-6 text-sm tabular-nums ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-brand-500';
  return (
    <form onSubmit={submit} className="space-y-2 p-1.5">
      <p className="text-[11px] font-medium text-slate-500">Refunded, or waiting on a decision</p>
      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Minimum</span>
          <span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-slate-400">$</span>
          <input inputMode="decimal" placeholder="Min" value={lo} onChange={(e) => setLo(e.target.value)} className={input} autoFocus />
        </label>
        <span className="text-xs text-slate-400">to</span>
        <label className="relative flex-1">
          <span className="sr-only">Maximum</span>
          <span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-slate-400">$</span>
          <input inputMode="decimal" placeholder="Max" value={hi} onChange={(e) => setHi(e.target.value)} className={input} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onApply(undefined, undefined)} className="flex-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
          Reset
        </button>
        <button type="submit" className="flex-1 rounded-lg bg-slate-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
          Apply
        </button>
      </div>
    </form>
  );
}

function amountRangeLabel(min?: number, max?: number) {
  const f = (c: number) => money(c).replace(/\.00$/, '');
  if (min !== undefined && max !== undefined) return `${f(min)} to ${f(max)}`;
  if (min !== undefined) return `${f(min)} or more`;
  return `up to ${f(max!)}`;
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  // First, last, and the neighbours of the current page; gaps shown as an ellipsis.
  const shown = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const btn = 'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs tabular-nums transition';
  return (
    <nav className="ml-auto flex items-center gap-1" aria-label="Pages">
      <button type="button" className={cx(btn, 'hover:bg-slate-100 disabled:opacity-40')} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      {shown.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && p - shown[i - 1]! > 1 && <span className="px-0.5 text-slate-400">...</span>}
          <button type="button" aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)} className={cx(btn, p === page ? 'bg-slate-900 font-medium text-white' : 'text-slate-600 hover:bg-slate-100')}>
            {p}
          </button>
        </span>
      ))}
      <button type="button" className={cx(btn, 'hover:bg-slate-100 disabled:opacity-40')} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </nav>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans text-[10px] text-slate-500">{children}</kbd>;
}

function EmptyState({ view, filtered, onClear }: { view: View; filtered: boolean; onClear: () => void }) {
  if (filtered)
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm font-medium">Nothing matches these filters</p>
        <p className="mt-1 text-xs text-slate-500">Try removing one, or search for something else.</p>
        <button type="button" onClick={onClear} className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 ring-inset hover:bg-slate-50">
          Clear filters
        </button>
      </div>
    );
  const copy: Record<View, [string, string]> = {
    all: ['No cases yet', 'Send a refund request from the customer chat and it will appear here within a few seconds.'],
    ESCALATED: ["You're all caught up", 'Every case has a decision. New ones that need a person will land here.'],
    APPROVED: ['No approved refunds yet', 'Approved cases will show up here.'],
    DENIED: ['No denied requests', 'Requests the policy turns down will show up here.'],
    flagged: ['Nothing flagged', 'Cases with risk or security signals will show up here.'],
  };
  const [title, body] = copy[view];
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{body}</p>
    </div>
  );
}
