import { describe, expect, it } from 'vitest';
import { buildOrder, buildWhere, csvCell, escapeLike, toCsv } from '../src/repositories/request-query.js';

const base = { limit: 25, offset: 0 };

describe('case list query builder', () => {
  it('returns no clause when nothing is filtered', () => {
    expect(buildWhere(base)).toEqual({ clause: '', params: [] });
  });

  it('parameterises every value and numbers placeholders in order', () => {
    const { clause, params } = buildWhere({ ...base, status: 'ESCALATED', q: 'ada', reasons: ['wrong_item'], minCents: 1000 });
    expect(params).toEqual(['ESCALATED', '%ada%', ['wrong_item'], 1000]);
    expect(clause).toContain('r.status = $1');
    expect(clause).toContain('c.name ILIKE $2');
    expect(clause).toContain('ANY($3::text[])');
    expect(clause).toContain('>= $4');
    expect(clause).not.toContain('ada');
  });

  it('skips filters for facet counts', () => {
    const f = { ...base, status: 'DENIED' as const, flagged: true, signals: ['fraud_watch'] };
    const { clause, params } = buildWhere(f, ['status', 'flagged']);
    expect(clause).not.toContain('r.status');
    expect(clause).not.toContain('cardinality');
    expect(params).toEqual([['fraud_watch']]);
  });

  it('separates cases decided automatically from those decided by the team', () => {
    expect(buildWhere({ ...base, decidedBy: 'team' }).clause).toContain('reviewed_at IS NOT NULL');
    const auto = buildWhere({ ...base, decidedBy: 'auto' }).clause;
    expect(auto).toContain('reviewed_at IS NULL');
    expect(auto).toContain("<> 'ESCALATED'");
  });

  it('escapes LIKE wildcards in search text', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(buildWhere({ ...base, q: '100%' }).params).toEqual(['%100\\%%']);
  });

  it('orders by whitelisted columns with a stable tie-breaker', () => {
    expect(buildOrder()).toBe('ORDER BY r.created_at DESC NULLS LAST, r.created_at DESC, r.id');
    expect(buildOrder('customer', 'asc')).toMatch(/^ORDER BY c\.name ASC NULLS FIRST/);
    expect(buildOrder('amount', 'desc')).toContain('CASE r.status');
  });
});

describe('CSV export', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
  });

  it('neutralises spreadsheet formulas written by customers', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2')).toBe("'-2");
  });

  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 1], ['b', 2]])).toBe('a,1\r\nb,2');
  });
});
