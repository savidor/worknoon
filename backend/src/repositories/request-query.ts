import type { Decision } from '../domain/types.js';

/** Filters the support console can apply to the case list. All optional; combined with AND. */
export interface RequestListFilters {
  status?: Decision;
  flagged?: boolean;
  q?: string;
  reasons?: string[];
  signals?: string[];
  decidedBy?: 'auto' | 'team';
  sinceDays?: number;
  minCents?: number;
  maxCents?: number;
  ids?: string[];
  sort?: SortKey;
  dir?: 'asc' | 'desc';
  limit: number;
  offset: number;
}

type FilterKey = Exclude<keyof RequestListFilters, 'sort' | 'dir' | 'limit' | 'offset'>;

/** The amount a reviewer cares about: what was refunded, or what is waiting on a decision. */
export const AMOUNT_SQL = `CASE r.status WHEN 'APPROVED' THEN r.refund_amount_cents WHEN 'ESCALATED' THEN r.review_amount_cents END`;

/** Sortable columns. Only these keys reach SQL, so a sort parameter can never inject. */
export const SORTS = {
  created: 'r.created_at',
  amount: AMOUNT_SQL,
  customer: 'c.name',
  reference: 'r.reference',
  status: 'r.status',
  reason: 'r.reason_category',
} as const;
export type SortKey = keyof typeof SORTS;

/** Escapes LIKE wildcards so a search for "50%" matches the text, not everything. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Builds a parameterised WHERE clause. `skip` leaves out filters, which is how facet counts
 * are computed: the status tabs count cases under every other active filter, for example.
 */
export function buildWhere(f: RequestListFilters, skip: FilterKey[] = []): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  const use = (k: FilterKey) => !skip.includes(k);

  if (use('status') && f.status) add((p) => `r.status = ${p}`, f.status);
  if (use('flagged') && f.flagged) where.push('cardinality(r.risk_flags) > 0');
  if (use('q') && f.q) {
    add(
      (p) => `(r.reference ILIKE ${p} OR c.name ILIKE ${p} OR o.order_number ILIKE ${p} OR r.customer_message ILIKE ${p})`,
      `%${escapeLike(f.q)}%`,
    );
  }
  if (use('reasons') && f.reasons?.length) add((p) => `r.reason_category = ANY(${p}::text[])`, f.reasons);
  if (use('signals') && f.signals?.length) add((p) => `r.risk_flags && ${p}::text[]`, f.signals);
  if (use('decidedBy') && f.decidedBy) where.push(f.decidedBy === 'team' ? 'r.reviewed_at IS NOT NULL' : "r.reviewed_at IS NULL AND r.status <> 'ESCALATED'");
  if (use('sinceDays') && f.sinceDays) add((p) => `r.created_at >= current_date - (${p}::int - 1)`, f.sinceDays);
  if (use('minCents') && f.minCents !== undefined) add((p) => `${AMOUNT_SQL} >= ${p}`, f.minCents);
  if (use('maxCents') && f.maxCents !== undefined) add((p) => `${AMOUNT_SQL} <= ${p}`, f.maxCents);
  if (use('ids') && f.ids?.length) add((p) => `r.id = ANY(${p}::text[])`, f.ids);

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** ORDER BY with a stable tie-breaker, so paging never shows a row twice or skips one. */
export function buildOrder(sort: SortKey = 'created', dir: 'asc' | 'desc' = 'desc'): string {
  const d = dir === 'asc' ? 'ASC' : 'DESC';
  const nulls = dir === 'asc' ? 'NULLS FIRST' : 'NULLS LAST';
  return `ORDER BY ${SORTS[sort]} ${d} ${nulls}, r.created_at DESC, r.id`;
}

/** One CSV cell. Formula prefixes are neutralised so a customer message cannot run in a spreadsheet. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
