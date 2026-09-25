import { Plus, Power, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Condition, CustomRule, PolicyStudioData } from '../../api/client';
import { cx, humanize } from '../../lib/format';
import { Pill } from '../ui';

type Catalog = PolicyStudioData['catalog'];

const inputCls = 'w-full rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500';

const isList = (op: string) => op === 'in' || op === 'not_in';

function operatorsFor(catalog: Catalog, field: string) {
  const type = catalog.fields[field]?.type;
  return Object.entries(catalog.operators).filter(([, o]) => type && o.types.includes(type));
}

function defaultValue(catalog: Catalog, field: string, operator: string): Condition['value'] {
  const f = catalog.fields[field];
  if (!f || f.type === 'boolean') return null;
  if (isList(operator)) return [];
  if (f.type === 'money' || f.type === 'number') return 0;
  return f.options?.[0] ?? '';
}

export function blankCondition(catalog: Catalog): Condition {
  const field = 'item.category';
  return { field, operator: 'eq', value: catalog.knownCategories[0] ?? '' };
}

/** Mirrors the server's plain-English rendering so editors see exactly what will be published. */
export function describeCondition(catalog: Catalog, c: Condition): string {
  const f = catalog.fields[c.field];
  const op = catalog.operators[c.operator]?.label ?? c.operator;
  if (!f) return '';
  if (f.type === 'boolean') return `${f.label.toLowerCase()} ${op}`;
  const value = Array.isArray(c.value)
    ? c.value.length
      ? c.value.map((v) => humanize(v).toLowerCase()).join(', ')
      : '(nothing selected)'
    : f.type === 'money'
      ? `$${(Number(c.value) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      : String(c.value).replaceAll('_', ' ');
  return `${f.label.toLowerCase()} ${op} ${value}`;
}

export function describeRule(catalog: Catalog, r: CustomRule): string {
  if (!r.conditions.length) return 'Add a condition to describe when this rule applies.';
  return `If ${r.conditions.map((c) => describeCondition(catalog, c)).join(' and ')}, ${
    r.effect === 'DENIED' ? 'the item is not eligible' : 'a specialist reviews the request'
  }.`;
}

function ConditionRow({
  catalog,
  condition,
  onChange,
  onRemove,
  canRemove,
}: {
  catalog: Catalog;
  condition: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const field = catalog.fields[condition.field];
  const ops = operatorsFor(catalog, condition.field);
  const options = field?.options ?? (condition.field === 'item.category' ? catalog.knownCategories : undefined);

  const setField = (next: string) => {
    const op = operatorsFor(catalog, next)[0]?.[0] ?? 'eq';
    onChange({ field: next, operator: op, value: defaultValue(catalog, next, op) });
  };
  const setOperator = (op: string) => {
    const switchingShape = isList(op) !== isList(condition.operator);
    onChange({ ...condition, operator: op, value: switchingShape ? defaultValue(catalog, condition.field, op) : condition.value });
  };

  let valueInput: ReactNode = null;
  if (field?.type === 'boolean') {
    valueInput = <span className="px-1 text-xs text-slate-400">no value needed</span>;
  } else if (isList(condition.operator) && options) {
    const selected = new Set(Array.isArray(condition.value) ? condition.value : []);
    valueInput = (
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => {
              const next = new Set(selected);
              if (next.has(o)) next.delete(o);
              else next.add(o);
              onChange({ ...condition, value: [...next] });
            }}
            className={cx(
              'rounded-full px-2 py-0.5 text-xs ring-1 ring-inset transition',
              selected.has(o) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
            )}
            aria-pressed={selected.has(o)}
          >
            {humanize(o)}
          </button>
        ))}
      </div>
    );
  } else if (isList(condition.operator)) {
    valueInput = (
      <input
        className={inputCls}
        placeholder="Comma-separated values"
        value={Array.isArray(condition.value) ? condition.value.join(', ') : ''}
        onChange={(e) => onChange({ ...condition, value: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })}
      />
    );
  } else if (field?.options) {
    valueInput = (
      <select className={inputCls} value={String(condition.value ?? '')} onChange={(e) => onChange({ ...condition, value: e.target.value })}>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {humanize(o)}
          </option>
        ))}
      </select>
    );
  } else if (field?.type === 'money') {
    valueInput = (
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-slate-400">$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          className={cx(inputCls, 'pl-6')}
          value={Number(condition.value ?? 0) / 100}
          onChange={(e) => onChange({ ...condition, value: Math.round(Number(e.target.value) * 100) })}
        />
      </div>
    );
  } else if (field?.type === 'number') {
    valueInput = (
      <input type="number" min={0} className={inputCls} value={Number(condition.value ?? 0)} onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })} />
    );
  } else {
    const listId = `opts-${condition.field}`;
    valueInput = (
      <>
        <input className={inputCls} list={options ? listId : undefined} value={String(condition.value ?? '')} onChange={(e) => onChange({ ...condition, value: e.target.value })} />
        {options && (
          <datalist id={listId}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        )}
      </>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_auto] sm:items-start">
      <select className={inputCls} value={condition.field} onChange={(e) => setField(e.target.value)} aria-label="Field" title={field?.help}>
        {Object.entries(catalog.fields).map(([key, f]) => (
          <option key={key} value={key}>
            {f.label}
          </option>
        ))}
      </select>
      <select className={inputCls} value={condition.operator} onChange={(e) => setOperator(e.target.value)} aria-label="Operator">
        {ops.map(([key, o]) => (
          <option key={key} value={key}>
            {o.label}
          </option>
        ))}
      </select>
      <div>{valueInput}</div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-rose-600 disabled:opacity-30"
        aria-label="Remove condition"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function RuleEditor({
  catalog,
  rule,
  index,
  isNew,
  onChange,
  onRemove,
}: {
  catalog: Catalog;
  rule: CustomRule;
  index: number;
  isNew: boolean;
  onChange: (r: CustomRule) => void;
  onRemove: () => void;
}) {
  const setCondition = (i: number, c: Condition) => onChange({ ...rule, conditions: rule.conditions.map((x, j) => (j === i ? c : x)) });
  return (
    <div className={cx('rounded-xl border bg-white p-4 shadow-sm', rule.enabled ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-75')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-400">9.{index + 1}</span>
        <input
          className="min-w-0 flex-1 rounded-md px-2 py-1 text-sm font-semibold outline-none ring-slate-300 hover:ring-1 focus:ring-2 focus:ring-brand-500"
          value={rule.name}
          placeholder="Rule name, for example Opened electronics"
          onChange={(e) => onChange({ ...rule, name: e.target.value })}
          aria-label="Rule name"
        />
        {isNew && <Pill tone="brand">new</Pill>}
        <button
          type="button"
          onClick={() => onChange({ ...rule, enabled: !rule.enabled })}
          className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium', rule.enabled ? 'text-emerald-700 hover:bg-emerald-50' : 'text-slate-500 hover:bg-slate-100')}
          aria-pressed={rule.enabled}
        >
          <Power className="size-3.5" aria-hidden /> {rule.enabled ? 'Enabled' : 'Disabled'}
        </button>
        <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete rule">
          <Trash2 className="size-4" />
        </button>
      </div>

      <p className="mt-3 mb-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">When all of these are true</p>
      <div className="space-y-1.5">
        {rule.conditions.map((c, i) => (
          <ConditionRow
            key={i}
            catalog={catalog}
            condition={c}
            onChange={(next) => setCondition(i, next)}
            onRemove={() => onChange({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })}
            canRemove={rule.conditions.length > 1}
          />
        ))}
      </div>
      {rule.conditions.length < 6 && (
        <button
          type="button"
          onClick={() => onChange({ ...rule, conditions: [...rule.conditions, blankCondition(catalog)] })}
          className="mt-1.5 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
        >
          <Plus className="size-3.5" aria-hidden /> Add condition
        </button>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <p className="mb-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">Then</p>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Effect">
            {(
              [
                ['DENIED', 'Not eligible'],
                ['ESCALATED', 'Send to specialist'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rule.effect === value}
                onClick={() => onChange({ ...rule, effect: value })}
                className={cx(
                  'rounded-md px-3 py-1 text-sm font-medium transition',
                  rule.effect === value ? (value === 'DENIED' ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white') : 'text-slate-600',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium tracking-wide text-slate-500 uppercase">What the customer is told</span>
          <input
            className={inputCls}
            value={rule.customerText}
            maxLength={200}
            placeholder="for example: opened electronics can only be returned within 14 days"
            onChange={(e) => onChange({ ...rule, customerText: e.target.value })}
          />
          <span className="mt-1 block text-[11px] text-slate-400">Finishes the sentence "We can't offer a refund here because ..." Never mention fraud or internal checks.</span>
        </label>
      </div>

      <p className="mt-3 rounded-lg bg-brand-50/60 px-3 py-2 text-sm text-slate-700">{describeRule(catalog, rule)}</p>
    </div>
  );
}
