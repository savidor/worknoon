import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FolderOpen, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { api, type PolicyVersion } from '../../api/client';
import { relative } from '../../lib/format';
import { Button, ErrorNote, Pill } from '../ui';

export function VersionHistory({ versions, onLoad }: { versions: PolicyVersion[]; onLoad: (v: PolicyVersion) => void }) {
  const qc = useQueryClient();
  const [restoring, setRestoring] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const activate = useMutation({
    mutationFn: (id: number) => api(`/admin/policy/versions/${id}/activate`, { method: 'POST', role: 'admin', body: { note } }),
    onSuccess: () => {
      setRestoring(null);
      setNote('');
      qc.invalidateQueries();
    },
  });

  return (
    <ol className="space-y-2">
      {versions.map((v) => (
        <li key={v.id} className="rounded-lg p-3 ring-1 ring-slate-200">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{v.version}</span>
            {v.isActive && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5" aria-hidden /> active
              </span>
            )}
            <span className="ml-auto text-[11px] text-slate-400">{relative(v.createdAt)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{v.note}</p>
          <p className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-400">
            by {v.createdBy} · <Pill>{v.customRules.length} custom rules</Pill>
          </p>
          <div className="mt-2 flex gap-1.5">
            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => onLoad(v)}>
              <FolderOpen className="size-3.5" aria-hidden /> Open in editor
            </Button>
            {!v.isActive && (
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setRestoring(restoring === v.id ? null : v.id)}>
                <RotateCcw className="size-3.5" aria-hidden /> Make active
              </Button>
            )}
          </div>
          {restoring === v.id && (
            <div className="mt-2 space-y-2 rounded-lg bg-amber-50 p-2">
              <input
                className="w-full rounded-md bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Why are you restoring this version?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
              />
              <Button variant="primary" className="w-full !py-1.5 text-xs" disabled={note.trim().length < 5} loading={activate.isPending} onClick={() => activate.mutate(v.id)}>
                Restore {v.version} for all new requests
              </Button>
              <ErrorNote error={activate.error} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
