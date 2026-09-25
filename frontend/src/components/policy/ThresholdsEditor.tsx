import type { PolicyConfig, PolicyStudioData } from '../../api/client';
import { cx, humanize } from '../../lib/format';

type NumberKey = Exclude<keyof PolicyConfig, 'nonReturnableCategories' | 'riskAccountFlags'>;

interface NumberField {
  key: NumberKey;
  label: string;
  help: string;
  clause: string;
  unit?: string;
  money?: boolean;
  min: number;
  max: number;
  step?: number;
}

const NUMBER_FIELDS: NumberField[] = [
  { key: 'refundWindowDays', label: 'Refund window', help: 'Days after delivery a refund can be requested', clause: '1.1', unit: 'days', min: 1, max: 365 },
  { key: 'humanReviewThresholdCents', label: 'Human review above', help: 'Refunds above this amount go to a specialist', clause: '4.1', money: true, min: 10, max: 100_000 },
  { key: 'frequencyMaxRefunds', label: 'Refund frequency limit', help: 'This many refunds in the lookback period triggers review', clause: '8.2', unit: 'refunds', min: 1, max: 50 },
  { key: 'frequencyLookbackDays', label: 'Frequency lookback', help: 'Period used for the frequency limit', clause: '8.2', unit: 'days', min: 7, max: 365 },
  { key: 'lostParcelGraceDays', label: 'Lost parcel after', help: 'Days past expected delivery before investigating', clause: '5.2', unit: 'days', min: 1, max: 60 },
  { key: 'maxClarificationTurns', label: 'Clarifying questions', help: 'Questions asked before handing to a specialist', clause: '8.7', unit: 'max', min: 1, max: 5 },
  { key: 'minExtractionConfidence', label: 'Minimum AI confidence', help: 'Below this, a specialist checks the AI reading', clause: '8.6', min: 0.3, max: 0.95, step: 0.05 },
];

function ChipSet({
  label,
  help,
  clause,
  options,
  value,
  onChange,
  changed,
}: {
  label: string;
  help: string;
  clause: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  changed: boolean;
}) {
  const all = [...new Set([...options, ...value])];
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  return (
    <div className={cx('rounded-lg p-3 ring-1', changed ? 'bg-amber-50/60 ring-amber-300' : 'ring-slate-200')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{label}</span>
        <span className="font-mono text-[11px] text-slate-400">§{clause}</span>
      </div>
      <p className="mb-2 text-xs text-slate-500">{help}</p>
      <div className="flex flex-wrap gap-1">
        {all.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value.includes(o)}
            onClick={() => toggle(o)}
            className={cx(
              'rounded-full px-2 py-0.5 text-xs ring-1 ring-inset transition',
              value.includes(o) ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
            )}
          >
            {humanize(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThresholdsEditor({
  config,
  active,
  catalog,
  onChange,
}: {
  config: PolicyConfig;
  active: PolicyConfig;
  catalog: PolicyStudioData['catalog'];
  onChange: (c: PolicyConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {NUMBER_FIELDS.map((f) => {
          const raw = config[f.key];
          const shown = f.money ? raw / 100 : raw;
          const changed = raw !== active[f.key];
          const was = f.money ? `$${(active[f.key] / 100).toLocaleString()}` : String(active[f.key]);
          return (
            <label key={f.key} className={cx('block rounded-lg p-3 ring-1', changed ? 'bg-amber-50/60 ring-amber-300' : 'ring-slate-200')}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-800">{f.label}</span>
                <span className="font-mono text-[11px] text-slate-400">§{f.clause}</span>
              </span>
              <span className="mb-2 block text-xs text-slate-500">{f.help}</span>
              <span className="flex items-center gap-2">
                {f.money && <span className="text-sm text-slate-500">$</span>}
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step ?? 1}
                  value={Number.isFinite(shown) ? shown : ''}
                  onChange={(e) => {
                    // An empty field stays empty while typing; the server reports it if published empty.
                    const n = e.target.value === '' ? Number.NaN : Number(e.target.value);
                    onChange({ ...config, [f.key]: f.money ? Math.round(n * 100) : n });
                  }}
                  className="w-28 rounded-lg bg-white px-2.5 py-1.5 text-sm tabular-nums ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500"
                />
                {f.unit && <span className="text-sm text-slate-500">{f.unit}</span>}
                {changed && <span className="ml-auto text-[11px] text-amber-800">was {was}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChipSet
          label="Non-refundable categories"
          help="Items in these categories are never refunded"
          clause="2.2"
          options={catalog.knownCategories}
          value={config.nonReturnableCategories}
          changed={JSON.stringify([...config.nonReturnableCategories].sort()) !== JSON.stringify([...active.nonReturnableCategories].sort())}
          onChange={(v) => onChange({ ...config, nonReturnableCategories: v })}
        />
        <ChipSet
          label="Account flags that need review"
          help="Accounts with these flags always get a specialist"
          clause="8.3"
          options={catalog.knownFlags}
          value={config.riskAccountFlags}
          changed={JSON.stringify([...config.riskAccountFlags].sort()) !== JSON.stringify([...active.riskAccountFlags].sort())}
          onChange={(v) => onChange({ ...config, riskAccountFlags: v })}
        />
      </div>
    </div>
  );
}
