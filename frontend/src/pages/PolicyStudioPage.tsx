import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenText, Plus, Sparkles, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { api, type CustomRule, type PolicyDraft, type PolicyStudioData, type PolicyVersion } from '../api/client';
import { AdminGate, ConsoleTabs } from '../components/AdminGate';
import { PolicyTester } from '../components/policy/PolicyTester';
import { RuleEditor, blankCondition } from '../components/policy/RuleEditor';
import { ThresholdsEditor } from '../components/policy/ThresholdsEditor';
import { VersionHistory } from '../components/policy/VersionHistory';
import { Button, Card, ErrorNote, Pill, Spinner } from '../components/ui';

export function PolicyStudioPage() {
  return <AdminGate>{() => <PolicyStudio />}</AdminGate>;
}

const toDraft = (p: PolicyDraft): PolicyDraft => ({ config: { ...p.config }, customRules: p.customRules.map((r) => ({ ...r, conditions: r.conditions.map((c) => ({ ...c })) })) });

const EXAMPLE_RULE: Omit<CustomRule, 'id'> = {
  name: 'Opened electronics',
  enabled: true,
  effect: 'DENIED',
  customerText: 'electronics can only be returned for a change of mind within 14 days of delivery',
  conditions: [
    { field: 'item.category', operator: 'eq', value: 'electronics' },
    { field: 'reason', operator: 'eq', value: 'changed_mind' },
    { field: 'days_since_delivery', operator: 'gt', value: 14 },
  ],
};

function PolicyStudio() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['policy-studio'], queryFn: () => api<PolicyStudioData>('/admin/policy', { role: 'admin' }) });
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  // The version the draft was loaded from, and its content, so we know whether the user has edited it.
  const [base, setBase] = useState<{ version: string; json: string } | null>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  // Start from the active policy and follow it when it changes (after a publish or a restore),
  // unless the editor holds work the user has not published.
  const activeJson = data ? JSON.stringify(toDraft(data.active)) : '';
  const dirty = !!draft && JSON.stringify(draft) !== activeJson;
  const edited = !!draft && !!base && JSON.stringify(draft) !== base.json;
  useEffect(() => {
    if (data && (!draft || (!edited && base?.version !== data.active.version))) {
      const fresh = toDraft(data.active);
      setDraft(fresh);
      setBase({ version: data.active.version, json: JSON.stringify(fresh) });
    }
  }, [data, draft, edited, base]);

  const activeIds = useMemo(() => new Set(data?.active.customRules.map((r) => r.id)), [data]);

  const publish = useMutation({
    mutationFn: () => api<{ version: PolicyVersion }>('/admin/policy/publish', { method: 'POST', role: 'admin', body: { draft, note } }),
    onSuccess: async () => {
      setNote('');
      await qc.invalidateQueries();
      setDraft(null);
    },
  });
  const previewDoc = useMutation({
    mutationFn: () => api<{ markdown: string }>('/admin/policy/preview', { method: 'POST', role: 'admin', body: { draft } }),
    onSuccess: (r) => setPreview(r.markdown),
  });

  if (isLoading || !data || !draft) return error ? <ErrorNote error={error} /> : <Spinner />;
  const { catalog } = data;

  const setRule = (i: number, r: CustomRule) => setDraft({ ...draft, customRules: draft.customRules.map((x, j) => (j === i ? r : x)) });
  const addRule = (rule: Omit<CustomRule, 'id'>) => setDraft({ ...draft, customRules: [...draft.customRules, { ...rule, conditions: rule.conditions.map((c) => ({ ...c })) }] });
  const loadVersion = (v: PolicyVersion) => setDraft(toDraft(v));
  const discard = () => {
    const fresh = toDraft(data.active);
    setDraft(fresh);
    setBase({ version: data.active.version, json: JSON.stringify(fresh) });
  };

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Policy studio</h1>
          <p className="text-sm text-slate-500">Change thresholds and add rules without a deploy. Test first, then publish a new version.</p>
        </div>
        <ConsoleTabs />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <Card
            title={
              <span className="flex items-center gap-2">
                Thresholds <Pill>built-in rules</Pill>
              </span>
            }
            action={
              <span className="text-xs text-slate-500">
                Active: <span className="font-mono font-medium text-slate-800">{data.active.version}</span>
              </span>
            }
          >
            <div className="p-4">
              <ThresholdsEditor config={draft.config} active={data.active.config} catalog={catalog} onChange={(config) => setDraft({ ...draft, config })} />
            </div>
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                Custom rules <Pill>{draft.customRules.length}</Pill>
              </span>
            }
            action={
              <div className="flex gap-1.5">
                {draft.customRules.length === 0 && (
                  <Button variant="ghost" className="!py-1 text-xs" onClick={() => addRule(EXAMPLE_RULE)}>
                    <Sparkles className="size-3.5" aria-hidden /> Use an example
                  </Button>
                )}
                <Button
                  variant="secondary"
                  className="!py-1 text-xs"
                  onClick={() => addRule({ name: '', enabled: true, effect: 'DENIED', customerText: '', conditions: [blankCondition(catalog)] })}
                >
                  <Plus className="size-3.5" aria-hidden /> Add rule
                </Button>
              </div>
            }
          >
            <div className="space-y-3 p-4">
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Custom rules can make an item <b>not eligible</b> or <b>send it to a specialist</b>. They cannot approve anything, so the built-in
                protections (final sale, refund window, identity and fraud checks) always apply. When rules disagree, the most restrictive outcome wins.
              </p>
              {draft.customRules.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No custom rules yet.</p>}
              {draft.customRules.map((r, i) => (
                <RuleEditor
                  key={r.id ?? `new-${i}`}
                  catalog={catalog}
                  rule={r}
                  index={i}
                  isNew={!r.id || !activeIds.has(r.id)}
                  onChange={(next) => setRule(i, next)}
                  onRemove={() => setDraft({ ...draft, customRules: draft.customRules.filter((_, j) => j !== i) })}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Test before publishing">
            <div className="p-4">
              <PolicyTester draft={draft} catalog={catalog} dirty={dirty} />
            </div>
          </Card>
          <Card title="Version history">
            <div className="p-4">
              <VersionHistory versions={data.versions} onLoad={loadVersion} />
            </div>
          </Card>
        </div>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-3">
            <span className="text-sm font-medium text-amber-800">Unpublished changes</span>
            <input
              className="min-w-[220px] flex-1 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="What changed and why? (required, kept in the audit log)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Change note"
            />
            <Button variant="ghost" onClick={() => previewDoc.mutate()} loading={previewDoc.isPending}>
              <BookOpenText className="size-4" aria-hidden /> Preview policy page
            </Button>
            <Button variant="ghost" onClick={discard}>
              <Undo2 className="size-4" aria-hidden /> Discard
            </Button>
            <Button onClick={() => publish.mutate()} loading={publish.isPending} disabled={note.trim().length < 5}>
              Publish new version
            </Button>
            <div className="basis-full empty:hidden">
              <ErrorNote error={publish.error ?? previewDoc.error} />
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Policy preview">
          <button type="button" className="absolute inset-0 bg-slate-900/30" onClick={() => setPreview(null)} aria-label="Close preview" />
          <div className="relative h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-2">
              <Pill tone="amber">Draft preview</Pill>
              <span className="text-sm text-slate-500">This is what customers will read once you publish.</span>
              <button type="button" className="ml-auto rounded-md p-1 hover:bg-slate-100" onClick={() => setPreview(null)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <article className="text-sm leading-relaxed text-slate-700 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-slate-900 [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc [&_p]:my-2 [&_strong]:text-slate-900">
              <Markdown>{preview}</Markdown>
            </article>
          </div>
        </div>
      )}
    </div>
  );
}
