import type { ReplyContext, ReplyDraft } from './types.js';

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Deterministic, policy-safe replies. Used by the offline provider and as the fallback
 * whenever a model-written reply fails the output guard or the model is unavailable.
 */
export function templateReply(ctx: ReplyContext): ReplyDraft {
  const hi = `Hi ${ctx.customerFirstName},`;
  const ref = ctx.caseReference ? ` Your case reference is ${ctx.caseReference}.` : '';
  const order = ctx.orderNumber ? ` for order ${ctx.orderNumber}` : '';
  const reasons = [...new Set(ctx.reasons)];

  switch (ctx.outcome) {
    case 'APPROVED': {
      const items = ctx.approvedItems.map((i) => `${i.name} (${i.amount})`).join(', ');
      const total = ctx.approvedItems.length > 1 ? `, a total of ${ctx.refundAmount}` : '';
      const denied = ctx.deniedItems.length
        ? ` ${ctx.deniedItems.map((d) => `${d.name} is not included because ${d.reason}`).join('. ')}.`
        : '';
      return {
        customerReply: `${hi} good news: your refund${order} has been approved. We are refunding ${items}${total}, and it will return to your original payment method within 5 to 7 business days.${denied}${ref}`,
        internalNote: `Auto-approved ${ctx.refundAmount}${order}.${ctx.deniedItems.length ? ' Partial: some items ineligible.' : ''}`,
      };
    }
    case 'DENIED': {
      const why = reasons.length ? reasons.join(', and ') : 'it does not meet our refund policy';
      return {
        customerReply: `${hi} thank you for reaching out${order}. I'm sorry, but we can't offer a refund here because ${why}. I know that's disappointing. If anything about your order looks wrong to you, reply here and we'll take another look.${ref}`,
        internalNote: `Denied by policy${order}: ${why}.`,
      };
    }
    case 'ESCALATED': {
      if (ctx.isDuplicate) {
        return {
          customerReply: `${hi} your request${order} is already with a specialist and is being reviewed. You'll see the update right here in this chat, usually within 1 business day.${ref}`,
          internalNote: `Customer followed up on an open review${order}.`,
        };
      }
      const amount = ctx.reviewAmount ? ` for ${ctx.reviewAmount}` : '';
      return {
        customerReply: `${hi} thanks for the details. I've passed your request${order}${amount} to a specialist because ${reasons[0] ?? 'it needs a closer look'}. They'll review it within 1 business day and you'll see the update right here in this chat.${ref}`,
        internalNote: `Escalated for human review${order}${amount}.`,
      };
    }
    case 'NEEDS_INFO': {
      const needOrder = ctx.missingInfo.includes('order');
      const badOrder = ctx.missingInfo.includes('valid_order');
      const needReason = ctx.missingInfo.includes('reason');
      const choices = ctx.orderChoices.length > 1
        ? ` Your recent orders are ${ctx.orderChoices.slice(0, -1).join(', ')} and ${ctx.orderChoices.at(-1)}.`
        : ctx.orderChoices.length === 1 ? ` Your recent order is ${ctx.orderChoices[0]}.` : '';
      const example = ' For example, did it arrive damaged, was it the wrong item, or did you change your mind?';
      let ask: string;
      if (badOrder) {
        ask = `I couldn't find that order number on your account. Could you double-check it?${choices}`;
      } else if (needOrder && needReason) {
        ask = `Could you tell me which order this is about and what went wrong?${choices}${example}`;
      } else if (needOrder) {
        ask = `Which order is this about?${choices}`;
      } else {
        ask = `Could you tell me a little more about what went wrong${ctx.orderNumber ? ` with order ${ctx.orderNumber}` : ''}?${example}`;
      }
      return {
        customerReply: `${hi} I'd be glad to help with that. ${ask}`,
        internalNote: `Asked customer for: ${ctx.missingInfo.join(', ')}.`,
      };
    }
    case 'INFO':
    default:
      return {
        customerReply: ctx.statusLine
          ? `${hi} ${sentenceCase(ctx.statusLine)} I can also help with refunds, returns and cancellations if you need anything.`
          : `${hi} thanks for getting in touch. I can help with refunds, returns and cancellations. Just tell me which order and what went wrong.`,
        internalNote: 'Non-refund inquiry answered.',
      };
  }
}
