import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ChevronRight, MessageSquareText, Package, RotateCcw, Sparkles, UserRound, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, tokens, type ConversationSummary, type Customer, type CustomerRefund, type DemoCustomer, type Message, type Order } from '../api/client';
import { EnquiryHistory } from '../components/EnquiryHistory';
import { Button, Card, ErrorNote, OUTCOME_STYLE, OutcomeBadge, Pill, Spinner } from '../components/ui';
import { cx, daysSince, money, shortDate, stamp } from '../lib/format';

const MAX_CHARS = 2000;
const CUSTOMER_KEY = 'rd.customerId';

function readStoredCustomer(): string | null {
  try {
    return sessionStorage.getItem(CUSTOMER_KEY);
  } catch {
    return null;
  }
}

export function ChatPage() {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState<string | null>(() => (tokens.get('customer') ? readStoredCustomer() : null));
  const [conversationId, setConversationId] = useState<string | null>(null);
  // The customer's live chat, and whether they are looking back at an earlier conversation.
  const [liveId, setLiveId] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  // The message being sent, and how many messages existed when it was sent, so the placeholder
  // can step aside as soon as polling brings back the server's saved copy.
  const [pending, setPending] = useState<{ content: string; baseCount: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const demo = useQuery({ queryKey: ['demo-customers'], queryFn: () => api<{ customers: DemoCustomer[] }>('/demo/customers') });

  const login = useMutation({
    mutationFn: (id: string) =>
      api<{ token: string; customer: Customer; orders: Order[] }>('/auth/customer/demo-login', { method: 'POST', body: { customerId: id } }),
    onSuccess: (res, id) => {
      tokens.set('customer', res.token);
      try {
        sessionStorage.setItem(CUSTOMER_KEY, id);
      } catch {
        /* optional */
      }
      setConversationId(null);
      setLiveId(null);
      setHistoryView(false);
      // Sign-in already returns the profile and orders: use them instead of fetching again.
      qc.setQueryData(['me', id], { customer: res.customer, orders: res.orders });
      setCustomerId(id);
    },
  });

  // Default to the first demo customer so the page is usable immediately.
  useEffect(() => {
    const first = demo.data?.customers[0];
    if (!customerId && first && !login.isPending && !login.isError) login.mutate(first.id);
  }, [customerId, demo.data, login]);

  const me = useQuery({
    queryKey: ['me', customerId],
    queryFn: () => api<{ customer: Customer; orders: Order[] }>('/me', { role: 'customer' }),
    enabled: !!customerId,
    // Keeps order badges current when a specialist approves a case in the console.
    refetchInterval: 15_000,
  });

  const current = useQuery({
    queryKey: ['conversation-current', customerId],
    queryFn: async () => {
      const data = await api<{ id: string; messages: Message[] }>('/conversations/current', { role: 'customer' });
      // The response already contains the messages: seed them so the chat renders without a second request.
      qc.setQueryData(['messages', data.id], { messages: data.messages });
      setLiveId(data.id);
      return data;
    },
    enabled: !!customerId && !conversationId,
  });
  const activeConversation = conversationId ?? current.data?.id ?? null;

  const history = useQuery({
    queryKey: ['conversations', customerId],
    queryFn: () => api<{ conversations: ConversationSummary[] }>('/conversations', { role: 'customer' }),
    enabled: !!customerId,
    // Picks up specialist decisions made in the console.
    refetchInterval: 15_000,
  });
  const refunds = useQuery({
    queryKey: ['refunds', customerId],
    queryFn: () => api<{ refunds: CustomerRefund[] }>('/refunds', { role: 'customer' }),
    enabled: !!customerId,
    refetchInterval: 15_000,
  });

  const openedAt = history.data?.conversations.find((c) => c.id === activeConversation)?.createdAt;
  const viewingHistory = historyView && !!activeConversation && activeConversation !== liveId;

  /** Opens an earlier conversation in the chat window, e.g. from a refunded order or Previous enquiries. */
  const openHistory = (id: string) => {
    setConversationId(id);
    setHistoryView(id !== liveId);
    // On a phone the chat sits above the sidebar: bring it into view.
    if (window.matchMedia('(max-width: 1023px)').matches) chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const backToLive = () => {
    setConversationId(liveId);
    setHistoryView(false);
  };

  const messages = useQuery({
    queryKey: ['messages', activeConversation],
    queryFn: () => api<{ messages: Message[] }>(`/conversations/${activeConversation}/messages`, { role: 'customer' }),
    enabled: !!activeConversation,
    // Poll so specialist decisions from the console appear without a refresh.
    refetchInterval: 5_000,
  });

  const send = useMutation({
    mutationFn: (content: string) =>
      api<{ customerMessage: Message; assistantMessage: Message }>(`/conversations/${activeConversation}/messages`, {
        method: 'POST',
        body: { content },
        role: 'customer',
      }),
    onMutate: (content) => {
      const saved = qc.getQueryData<{ messages: Message[] }>(['messages', activeConversation]);
      setPending({ content, baseCount: saved?.messages.length ?? 0 });
    },
    // Never lose what the customer typed: put it back so they can retry.
    onError: (_err, content) => setDraft((d) => d || content),
    // Show the reply the moment it arrives: the response contains both messages, so there is
    // no need to wait for a refetch. Orders refresh in the background (refund badges).
    onSuccess: (res) => {
      qc.setQueryData<{ messages: Message[] }>(['messages', activeConversation], (old) => {
        const list = old?.messages ?? [];
        const seen = new Set(list.map((m) => m.id));
        return { messages: [...list, ...[res.customerMessage, res.assistantMessage].filter((m) => !seen.has(m.id))] };
      });
    },
    onSettled: () => {
      setPending(null);
      void qc.invalidateQueries({ queryKey: ['me', customerId] });
      void qc.invalidateQueries({ queryKey: ['conversations', customerId] });
      void qc.invalidateQueries({ queryKey: ['refunds', customerId] });
    },
  });

  // A different customer starts clean: nothing typed for one person should carry over to the next.
  const resetSend = send.reset;
  useEffect(() => {
    setDraft('');
    setPending(null);
    resetSend();
  }, [customerId, resetSend]);

  const newConversation = useMutation({
    mutationFn: () => api<{ id: string }>('/conversations', { method: 'POST', role: 'customer' }),
    onSuccess: (c) => {
      setConversationId(c.id);
      setLiveId(c.id);
      setHistoryView(false);
    },
  });

  const selected = demo.data?.customers.find((c) => c.id === customerId);
  const list = messages.data?.messages ?? [];
  const pendingSaved =
    !!pending && list.slice(pending.baseCount).some((m) => m.role === 'customer' && m.content === pending.content.trim());
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [list.length, pending]);

  const submit = () => {
    const content = draft.trim();
    if (!content || send.isPending || !activeConversation) return;
    setDraft('');
    send.mutate(content);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const insert = (text: string) => {
    setDraft(text);
    inputRef.current?.focus();
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="order-last space-y-4 lg:order-first">
        <Card title="Demo customer" action={<Pill tone="brand">Demo mode</Pill>}>
          <div className="space-y-3 p-4">
            <label className="block text-xs font-medium text-slate-500" htmlFor="customer">
              Signed in as
            </label>
            <select
              id="customer"
              className="w-full rounded-lg border-slate-300 bg-white px-3 py-2 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-500 focus:outline-none"
              value={customerId ?? ''}
              onChange={(e) => login.mutate(e.target.value)}
              disabled={login.isPending}
            >
              {demo.data?.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}: {c.scenario?.title}
                </option>
              ))}
            </select>
            {selected?.scenario && (
              // A presenter's note, folded away so the chat looks like what a real customer sees.
              <details key={selected.id} className="group rounded-lg text-xs text-slate-600">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-medium text-slate-500 hover:text-slate-800 [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 transition group-open:rotate-90" aria-hidden />
                  What this demo tests
                </summary>
                <div className="mt-2 rounded-lg bg-slate-50 p-3">
                  <p className="font-medium text-slate-800">{selected.scenario.title}</p>
                  <p className="mt-1">
                    Expected outcome:{' '}
                    {selected.scenario.expected in OUTCOME_STYLE ? (
                      <OutcomeBadge outcome={selected.scenario.expected as keyof typeof OUTCOME_STYLE} />
                    ) : (
                      selected.scenario.expected
                    )}
                  </p>
                </div>
              </details>
            )}
            <p className="text-[11px] leading-relaxed text-slate-500">
              Stands in for the store login. The API takes the customer's identity from this session only, never from what
              they type.
            </p>
          </div>
        </Card>

        <Card title="Your orders">
          {me.isLoading ? (
            <Spinner />
          ) : (
            <OrderList
              orders={me.data?.orders ?? []}
              refunds={refunds.data?.refunds ?? []}
              onPick={(o) => insert(`About order ${o.orderNumber}: `)}
              onOpenConversation={openHistory}
            />
          )}
        </Card>

        <EnquiryHistory conversations={history.data?.conversations} loading={history.isLoading} activeId={activeConversation} onOpen={openHistory} />
      </aside>

      <div ref={chatRef} className="min-w-0 scroll-mt-20">
      <Card className="flex h-[calc(100dvh-7.5rem)] min-h-[540px] flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="grid size-9 place-items-center rounded-full bg-brand-600 text-white">
            <Sparkles className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">Refunds assistant</h1>
            <p className="truncate text-xs text-slate-500">Refunds, returns and cancellations. Decisions follow our published policy.</p>
          </div>
          <Button variant="ghost" className="ml-auto" onClick={() => newConversation.mutate()} loading={newConversation.isPending}>
            <RotateCcw className="size-4" aria-hidden /> New chat
          </Button>
        </header>

        {viewingHistory && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-100 bg-amber-50/70 px-4 py-2 text-xs text-amber-900">
            <span>
              Earlier conversation{openedAt ? ` from ${shortDate(openedAt)}` : ''}. You can reply here, or go back to your current chat.
            </span>
            <button type="button" onClick={backToLive} className="ml-auto font-medium underline-offset-2 hover:underline">
              Back to current chat
            </button>
          </div>
        )}

        <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto bg-slate-50/60 px-4 py-5" aria-live="polite">
          {list.length === 0 && !pending && (
            <div className="mx-auto max-w-md pt-10 text-center">
              <p className="text-sm font-medium text-slate-800">Hi {me.data?.customer.name.split(' ')[0] ?? 'there'}, how can I help?</p>
              <p className="mt-1 text-sm text-slate-500">
                Tell me which order and what went wrong. I'll check it against our refund policy straight away.
              </p>
            </div>
          )}
          {viewingHistory && (
            <OrderStories
              orders={me.data?.orders ?? []}
              refunds={(refunds.data?.refunds ?? []).filter((r) => r.conversationId === activeConversation)}
              cases={history.data?.conversations.find((c) => c.id === activeConversation)?.cases ?? []}
              firstMessageAt={list.find((m) => m.role === 'customer')?.createdAt}
            />
          )}
          {list.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {pending && (
            <>
              {!pendingSaved && (
                <MessageBubble message={{ id: 'pending', role: 'customer', content: pending.content, meta: {}, createdAt: new Date().toISOString() }} />
              )}
              <TypingIndicator />
            </>
          )}
          <ErrorNote error={send.error} />
        </div>

        <div className="border-t border-slate-100 bg-white p-3">
          {selected?.scenario?.prompts && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {selected.scenario.prompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => insert(p)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700 ring-1 ring-inset ring-brand-600/15 transition hover:bg-brand-100"
                  title={p}
                >
                  <Wand2 className="size-3" aria-hidden />
                  <span className="max-w-[280px] truncate">{p}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-xl bg-white ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-brand-500">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={onKey}
              rows={2}
              placeholder="Describe the problem, e.g. 'My headphones from WN-10001 arrived broken'"
              aria-label="Message"
              className="max-h-40 min-h-[52px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-slate-400"
            />
            <div className="flex flex-col items-end gap-1 p-2">
              <span className={cx('text-[10px] tabular-nums', draft.length > MAX_CHARS * 0.9 ? 'text-rose-600' : 'text-slate-400')}>
                {draft.length}/{MAX_CHARS}
              </span>
              <Button onClick={submit} disabled={!draft.trim() || send.isPending} className="size-9 !p-0" aria-label="Send message">
                <ArrowUp className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">Enter to send, Shift+Enter for a new line.</p>
        </div>
      </Card>
      </div>
    </div>
  );
}

const isClosed = (o: Order) => o.status === 'cancelled' || o.items.every((i) => i.refundedQuantity >= i.quantity);

/** Orders a customer might still ask about come first; fully refunded or cancelled ones fold away. */
function OrderList({
  orders,
  refunds,
  onPick,
  onOpenConversation,
}: {
  orders: Order[];
  refunds: CustomerRefund[];
  onPick: (o: Order) => void;
  onOpenConversation: (id: string) => void;
}) {
  const row = (o: Order) => (
    <OrderRow key={o.id} order={o} refunds={refunds.filter((r) => r.orderId === o.id)} onPick={() => onPick(o)} onOpenConversation={onOpenConversation} />
  );
  const [showClosed, setShowClosed] = useState(false);
  const open = orders.filter((o) => !isClosed(o));
  const closed = orders.filter(isClosed);
  // With nothing open, the closed orders are all there is to talk about: show them.
  const expanded = showClosed || open.length === 0;
  return (
    <>
      <ul className="divide-y divide-slate-100">
        {open.map(row)}
      </ul>
      {closed.length > 0 && (
        <>
          {open.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClosed(!showClosed)}
              aria-expanded={expanded}
              className="flex w-full items-center gap-1.5 border-t border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            >
              <ChevronRight className={cx('size-3.5 transition', expanded && 'rotate-90')} aria-hidden />
              Refunded or cancelled orders ({closed.length})
            </button>
          )}
          {expanded && (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {closed.map(row)}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function OrderRow({
  order,
  refunds,
  onPick,
  onOpenConversation,
}: {
  order: Order;
  refunds: CustomerRefund[];
  onPick: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const age = daysSince(order.deliveredAt);
  const windowLeft = age === null ? null : 30 - age;
  const fullyRefunded = order.items.every((i) => i.refundedQuantity >= i.quantity);
  const refundedCents = refunds.reduce((sum, r) => sum + r.amountCents, 0);
  const statusTone = { delivered: 'emerald', shipped: 'brand', processing: 'amber', cancelled: 'slate' } as const;
  return (
    <li>
      <button type="button" onClick={onPick} className="w-full px-4 pt-3 text-left transition hover:bg-slate-50" title="Reference this order in the chat">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-slate-400" aria-hidden />
          <span className="text-sm font-medium">{order.orderNumber}</span>
          <Pill tone={statusTone[order.status]}>{order.status}</Pill>
          <span className="ml-auto text-sm tabular-nums text-slate-700">{money(order.totalCents)}</span>
        </div>
        <ul className="mt-1.5 space-y-1 pl-6">
          {order.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              <span className="truncate">{i.name}</span>
              {i.finalSale && <Pill tone="rose">Final sale</Pill>}
              {i.refundedQuantity >= i.quantity && !fullyRefunded && <Pill>Refunded</Pill>}
            </li>
          ))}
        </ul>
        <p className={cx('mt-1.5 pl-6 text-[11px] text-slate-500', refunds.length === 0 && 'pb-3')}>
          {order.status === 'delivered'
            ? `Delivered ${shortDate(order.deliveredAt)}${
                fullyRefunded ? (refunds.length ? '' : ' · refunded in full') : windowLeft !== null && windowLeft >= 0 ? ` · ${windowLeft} days left to request a refund` : ' · refund window closed'
              }`
            : order.status === 'shipped'
              ? `In transit · expected ${shortDate(order.expectedDeliveryAt)}`
              : order.status === 'processing'
                ? 'Not shipped yet'
                : 'Cancelled'}
        </p>
      </button>
      {refunds.length > 0 && (
        <div className="px-4 pt-1.5 pb-3 pl-10">
          <RefundChip fullyRefunded={fullyRefunded} cents={refundedCents} conversationId={latestConversation(refunds)} onOpen={onOpenConversation} />
        </div>
      )}
    </li>
  );
}

const DECIDED_BY_TEXT: Record<CustomerRefund['decidedBy'], string> = {
  earlier: 'Handled by our support team',
  assistant: 'Approved by the refunds assistant',
  specialist: 'Approved by a support specialist',
};

/** The most recent conversation behind an order's refunds, if any. */
function latestConversation(refunds: CustomerRefund[]): string | null {
  return [...refunds].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((r) => r.conversationId)?.conversationId ?? null;
}

function RefundChip({ fullyRefunded, cents, conversationId, onOpen }: { fullyRefunded: boolean; cents: number; conversationId: string | null; onOpen: (id: string) => void }) {
  const label = `${fullyRefunded ? 'Refunded in full' : 'Partly refunded'} · ${money(cents)}`;
  const chip = 'inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20';
  if (!conversationId) return <span className={chip}>{label}</span>;
  return (
    <button type="button" onClick={() => onOpen(conversationId)} className={cx(chip, 'transition hover:bg-emerald-100')} title="Open the conversation in the chat">
      {label}
      <span className="inline-flex items-center gap-1 border-l border-emerald-600/20 pl-1.5">
        <MessageSquareText className="size-3" aria-hidden /> View history
      </span>
    </button>
  );
}

type ConversationCase = ConversationSummary['cases'][number];

/**
 * Pinned above an earlier conversation: what happened to each order it was about, from order
 * to outcome, so the transcript below reads in context.
 */
function OrderStories({
  orders,
  refunds,
  cases,
  firstMessageAt,
}: {
  orders: Order[];
  refunds: CustomerRefund[];
  cases: ConversationCase[];
  firstMessageAt: string | undefined;
}) {
  const numbers = [...new Set([...refunds.map((r) => r.orderNumber), ...cases.map((c) => c.orderNumber).filter((n): n is string => !!n)])];
  const touched = numbers.map((n) => orders.find((o) => o.orderNumber === n)).filter((o): o is Order => !!o);
  if (touched.length === 0) return null;
  return (
    <div className="space-y-2">
      {touched.map((o) => {
        const steps: Array<{ at: string; text: string; tone?: 'good' | 'bad' | 'wait' }> = [{ at: o.orderedAt, text: 'Ordered' }];
        if (o.deliveredAt) steps.push({ at: o.deliveredAt, text: 'Delivered' });
        if (firstMessageAt) steps.push({ at: firstMessageAt, text: 'You contacted us' });
        for (const r of refunds.filter((x) => x.orderId === o.id)) {
          steps.push({ at: r.createdAt, text: `${money(r.amountCents)} refunded. ${DECIDED_BY_TEXT[r.decidedBy]}${r.caseReference ? ` (${r.caseReference})` : ''}`, tone: 'good' });
        }
        for (const c of cases.filter((x) => x.orderNumber === o.orderNumber && x.status !== 'APPROVED')) {
          steps.push({
            at: firstMessageAt ?? o.orderedAt,
            text: c.status === 'DENIED' ? `Not eligible for a refund${c.reference ? ` (${c.reference})` : ''}` : `Passed to a specialist${c.reference ? ` (${c.reference})` : ''}`,
            tone: c.status === 'DENIED' ? 'bad' : 'wait',
          });
        }
        steps.sort((a, b) => a.at.localeCompare(b.at));
        return (
          <section key={o.id} className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label={`History of order ${o.orderNumber}`}>
            <p className="flex items-center gap-2 text-xs font-medium text-slate-800">
              <Package className="size-3.5 text-slate-400" aria-hidden />
              Order {o.orderNumber}
              <span className="truncate font-normal text-slate-500">{o.items.map((i) => i.name).join(', ')}</span>
            </p>
            <ol className="mt-2.5 flex flex-wrap gap-x-1 gap-y-2 text-[11px]">
              {steps.map((st, i) => (
                <li key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3 text-slate-300" aria-hidden />}
                  <span
                    className={cx(
                      'rounded-md px-1.5 py-0.5',
                      st.tone === 'good' ? 'bg-emerald-50 text-emerald-800' : st.tone === 'bad' ? 'bg-slate-100 text-slate-700' : st.tone === 'wait' ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600',
                    )}
                  >
                    <span className="font-medium">{st.text}</span> <span className="opacity-70">{shortDate(st.at)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'customer') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%]">
          <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2.5 text-sm text-white shadow-sm">{message.content}</div>
          <p className="mt-1 text-right text-[10px] text-slate-400">{stamp(message.createdAt)}</p>
        </div>
      </div>
    );
  }
  const isAgent = message.role === 'agent';
  return (
    <div className="flex gap-2.5">
      <div
        className={cx('grid size-7 shrink-0 place-items-center rounded-full text-white', isAgent ? 'bg-amber-500' : 'bg-brand-600')}
        aria-hidden
      >
        {isAgent ? <UserRound className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </div>
      <div className="max-w-[85%] min-w-0">
        <p className="mb-1 text-[11px] font-medium text-slate-500">{isAgent ? 'Support specialist' : 'Refunds assistant'}</p>
        <div className="rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 shadow-sm ring-1 ring-slate-200">
          <p className="whitespace-pre-wrap">{message.content}</p>
          <DecisionCard message={message} />
        </div>
        <p className="mt-1 text-[10px] text-slate-400">{stamp(message.createdAt)}</p>
      </div>
    </div>
  );
}

function DecisionCard({ message }: { message: Message }) {
  const m = message.meta;
  const decided = m.outcome === 'APPROVED' || m.outcome === 'DENIED' || m.outcome === 'ESCALATED';
  const lines = useMemo(() => m.lines ?? [], [m.lines]);
  if (!m.outcome || !decided) return null;
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <OutcomeBadge outcome={m.outcome!} label={m.outcome === 'ESCALATED' ? 'With a specialist' : undefined} />
        {m.caseReference && <span className="font-mono text-[11px] text-slate-500">{m.caseReference}</span>}
        {m.outcome === 'APPROVED' && (m.refundAmountCents ?? 0) > 0 && (
          <span className="ml-auto text-sm font-semibold tabular-nums text-emerald-700">{money(m.refundAmountCents)}</span>
        )}
        {m.outcome === 'ESCALATED' && (m.reviewAmountCents ?? 0) > 0 && (
          <span className="ml-auto text-xs tabular-nums text-slate-600">{money(m.reviewAmountCents)} under review</span>
        )}
      </div>
      {lines.length > 0 && message.role === 'assistant' && (
        <ul className="mt-2 space-y-1">
          {lines.map((l, idx) => (
            <li key={`${l.name}-${idx}`} className="flex items-center gap-2 text-xs">
              <span className={cx('size-1.5 rounded-full', { APPROVED: 'bg-emerald-500', DENIED: 'bg-rose-500', ESCALATED: 'bg-amber-500' }[l.decision])} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-slate-700">{l.name}</span>
              <span className="text-slate-500">{OUTCOME_STYLE[l.decision].label}</span>
              <span className="w-16 text-right tabular-nums text-slate-700">{money(l.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TypingIndicator() {
  // Model calls usually take a few seconds; after that, reassure the customer instead of going quiet.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex items-center gap-2.5" role="status" aria-label="Assistant is reviewing your request">
      <div className="grid size-7 place-items-center rounded-full bg-brand-600 text-white" aria-hidden>
        <Sparkles className="size-3.5" />
      </div>
      <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-xs text-slate-500 shadow-sm ring-1 ring-slate-200">
        {slow ? 'Still checking, thanks for your patience' : 'Checking your order against our policy'}
        <span className="flex gap-0.5" aria-hidden>
          <span className="typing-dot size-1 rounded-full bg-slate-400" />
          <span className="typing-dot size-1 rounded-full bg-slate-400" />
          <span className="typing-dot size-1 rounded-full bg-slate-400" />
        </span>
      </div>
    </div>
  );
}
