import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/pool.js';
import type { Decision, LineDecision } from '../domain/types.js';
import { HttpError, RefundConflictError } from '../lib/errors.js';
import { formatCents } from '../lib/money.js';
import { recordEvents } from '../repositories/audit.repo.js';
import { addMessage } from '../repositories/conversation.repo.js';
import { getOrderById, recordRefund } from '../repositories/crm.repo.js';
import { getRequest, lockRequestForReview, resolveReview } from '../repositories/request.repo.js';

export interface ReviewInput {
  requestId: string;
  decision: Exclude<Decision, 'ESCALATED'>;
  reviewer: string;
  note: string;
  customerMessage?: string;
}

/**
 * Human-in-the-loop resolution of an escalated case. Runs in one transaction with a row
 * lock so concurrent reviewers cannot double-refund, re-checks item state at approval
 * time, and posts the outcome back into the customer's chat.
 */
export async function reviewRequest(input: ReviewInput) {
  await withTransaction(async (db) => {
    const row = await lockRequestForReview(db, input.requestId);
    if (!row) throw HttpError.notFound('Refund request not found');
    if (row.status !== 'ESCALATED') {
      throw HttpError.conflict(`Case ${row.reference} is already ${String(row.status).toLowerCase()}`);
    }

    let refundAmountCents = 0;
    let paidLines: LineDecision[] = [];
    if (input.decision === 'APPROVED' && row.order_id) {
      const order = await getOrderById(row.order_id, db);
      const refundable = new Set(order?.items.filter((i) => i.refundedQuantity < i.quantity).map((i) => i.id));
      paidLines = (row.line_decisions as LineDecision[]).filter((l) => l.decision !== 'DENIED' && refundable.has(l.itemId));
      refundAmountCents = paidLines.reduce((s, l) => s + l.amountCents, 0);
      try {
        await recordRefund(db, {
          refundId: `rfd_${randomUUID()}`,
          requestId: row.id,
          orderId: row.order_id,
          customerId: row.customer_id,
          itemIds: paidLines.map((l) => l.itemId),
          amountCents: refundAmountCents,
          source: 'human_review',
        });
      } catch (err) {
        if (err instanceof RefundConflictError) throw HttpError.conflict('These items were just refunded elsewhere. Reload the case.');
        throw err;
      }
    }

    await resolveReview(db, {
      id: input.requestId,
      status: input.decision,
      reviewer: input.reviewer,
      note: input.note,
      refundAmountCents,
    });

    const extra = input.customerMessage?.trim() ? ` ${input.customerMessage.trim()}` : '';
    const content =
      input.decision === 'APPROVED'
        ? refundAmountCents > 0
          ? `Update on case ${row.reference}: a specialist has approved your refund of ${formatCents(refundAmountCents)} for ${paidLines.map((l) => l.name).join(', ')}. It will return to your original payment method within 5 to 7 business days.${extra}`
          : `Update on case ${row.reference}: a specialist has reviewed and approved your request.${extra}`
        : `Update on case ${row.reference}: a specialist has reviewed your request and unfortunately we are unable to offer a refund in this case.${extra}`;

    await addMessage(
      {
        conversationId: row.conversation_id,
        role: 'agent',
        content,
        meta: { outcome: input.decision, caseId: row.id, caseReference: row.reference, refundAmountCents },
      },
      db,
    );

    await recordEvents(
      [
        {
          requestId: row.id,
          conversationId: row.conversation_id,
          actor: `admin:${input.reviewer}`,
          type: `review.${input.decision.toLowerCase()}`,
          detail: { note: input.note, refundAmountCents, customerMessage: input.customerMessage ?? null },
        },
      ],
      db,
    );
  });
  return getRequest(input.requestId);
}
