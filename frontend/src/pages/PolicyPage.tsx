import { useQuery } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import { api } from '../api/client';
import { Card, ErrorNote, Pill, Spinner } from '../components/ui';

interface PolicyResponse {
  version: string;
  markdown: string;
  rules: Array<{ id: string; section: string; title: string; effect: string; custom?: boolean }>;
}

const EFFECT_TONE = { APPROVED: 'emerald', DENIED: 'rose', ESCALATED: 'amber' } as const;

export function PolicyPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['policy'], queryFn: () => api<PolicyResponse>('/policy') });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <article className="max-w-none p-6 text-sm leading-relaxed text-slate-700 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-slate-900 [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc [&_p]:my-2 [&_strong]:text-slate-900">
          <Markdown>{data?.markdown ?? ''}</Markdown>
        </article>
      </Card>
      <Card title="How the engine applies it" action={<Pill tone="brand">{data?.version}</Pill>}>
        <p className="px-4 pt-3 text-xs text-slate-500">
          Every clause maps to a rule in the deterministic policy engine. Decisions are made by these rules, not by the AI
          model, so every outcome can be traced to a clause.
        </p>
        <ul className="divide-y divide-slate-100 p-2">
          {[...(data?.rules ?? [])].sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true })).map((r) => (
            <li key={r.id} className="flex items-start gap-2 px-2 py-2 text-sm">
              <span className="w-8 shrink-0 font-mono text-xs text-slate-400">{r.section}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-slate-800">{r.title}</span>
                <span className="font-mono text-[11px] text-slate-400">{r.id}</span>
                {r.custom && <span className="ml-1.5"><Pill tone="brand">custom</Pill></span>}
              </span>
              <Pill tone={EFFECT_TONE[r.effect as keyof typeof EFFECT_TONE] ?? 'slate'}>{r.effect.toLowerCase()}</Pill>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
