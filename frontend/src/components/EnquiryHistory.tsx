import { ChevronRight, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import type { ConversationSummary } from '../api/client';
import { cx, money, relative } from '../lib/format';
import { Card } from './ui';

const SHOWN = 4;

/** How each decision reads to the customer. Deliberately plain: no rule names or risk language. */
function caseLabel(c: ConversationSummary['cases'][number]): { text: string; tone: string } {
  if (c.status === 'APPROVED') return { text: c.amountCents > 0 ? `Refunded ${money(c.amountCents)}` : 'Approved', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' };
  if (c.status === 'DENIED') return { text: 'Not eligible', tone: 'bg-slate-100 text-slate-700 ring-slate-500/20' };
  return { text: 'With a specialist', tone: 'bg-amber-50 text-amber-800 ring-amber-600/25' };
}

export function EnquiryHistory({
  conversations,
  loading,
  activeId,
  onOpen,
}: {
  conversations: ConversationSummary[] | undefined;
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const list = conversations ?? [];
  const visible = showAll ? list : list.slice(0, SHOWN);

  return (
    <Card title={<span className="flex items-center gap-2">Previous enquiries {list.length > 0 && <span className="text-xs font-normal text-slate-400 tabular-nums">{list.length}</span>}</span>}>
      {loading ? (
        <div className="space-y-2 p-4">
          <div className="h-12 animate-pulse rounded-lg bg-slate-50" />
          <div className="h-12 animate-pulse rounded-lg bg-slate-50" />
        </div>
      ) : list.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-slate-500">No earlier enquiries yet. Every conversation is kept here so you can come back to it.</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {visible.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cx('group flex w-full items-start gap-3 px-4 py-3 text-left transition', active ? 'bg-brand-50/60' : 'hover:bg-slate-50')}
                  >
                    <MessageSquareText className={cx('mt-0.5 size-4 shrink-0', active ? 'text-brand-600' : 'text-slate-400')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800" title={c.preview ?? undefined}>
                        {c.preview ?? 'Conversation'}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {active ? 'Open now' : relative(c.updatedAt)} · {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                      </span>
                      {c.cases.length > 0 && (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {c.cases.map((k, i) => {
                            const l = caseLabel(k);
                            return (
                              <span key={`${k.reference ?? k.orderNumber}-${i}`} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', l.tone)}>
                                {l.text}
                                {k.orderNumber && <span className="font-normal opacity-70">· {k.orderNumber}</span>}
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </span>
                    {!active && <ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
          {list.length > SHOWN && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="w-full border-t border-slate-100 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800">
              {showAll ? 'Show fewer' : `Show all ${list.length}`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
