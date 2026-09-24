import type { Extraction, Intent, ReasonCategory } from '../../domain/types.js';
import { scanForInjection } from '../../security/input.js';
import { normalizeOrderNumber } from '../schemas.js';
import { templateReply } from '../templates.js';
import type { AiProvider, AiResult, ExtractionContext, ReplyContext, ReplyDraft } from '../types.js';

const REASONS: Array<[ReasonCategory, RegExp]> = [
  ['not_received', /(never (arrived|came|showed up|got here)|(not|n't|never) (yet )?(been )?(received|arrived|delivered|got it)|didn'?t (arrive|come|get)|missing (parcel|package)|lost (parcel|package))/i],
  ['cancel_order', /\bcancel/i],
  ['wrong_item', /((wrong|incorrect|different) (item|product|size|colou?r|model|one|version)|not what i ordered|sent (me )?(the |a )?(wrong|different)|\binstead\b)/i],
  ['damaged_or_defective', /(damaged|broken|broke|cracked|smashed|shattered|defective|faulty|torn|dented|scratched|stopped working|(doesn'?t|does not|won'?t|will not) (work|turn on|charge|power)|not working|dead on arrival|malfunction|flicker)/i],
  ['not_as_described', /(not as described|doesn'?t match|does not match|looks (nothing|different)|misleading|not like the (photo|picture))/i],
  ['changed_mind', /(changed my mind|(don'?t|do not) (need|want|like)|no longer (need|want)|unused|never used|unopened|didn'?t like|not for me|(doesn'?t|does not|didn'?t) fit|too (small|big|large|tight|loose)|by mistake|return (it|them|both))/i],
];

const REFUND_WORDS = /\b(refund|return|money back|reimburse|send (it|them) back|charge ?back|cancel)/i;
const INQUIRY_WORDS = /\b(where is|status|track(ing)?|when will|has (it|my order) shipped)\b/i;
const STOPWORDS = new Set(['with', 'from', 'this', 'that', 'final', 'sale', 'pro', 'set', 'the', 'and', 'for']);

function detectReason(text: string): ReasonCategory {
  return REASONS.find(([, re]) => re.test(text))?.[0] ?? 'unknown';
}

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/**
 * Offline provider: keyword heuristics for extraction and templates for replies.
 * It lets the whole product run with no API key, and it is the automatic fallback
 * when a real model times out, errors, or refuses.
 */
export class MockProvider implements AiProvider {
  readonly name = 'mock' as const;
  readonly model = 'heuristic-v1';

  async extract(ctx: ExtractionContext, _signal?: AbortSignal): Promise<AiResult<Extraction>> {
    const text = ctx.message;
    const earlierCustomerText = ctx.history
      .filter((t) => t.role === 'customer')
      .map((t) => t.content)
      .reverse();

    const orderNumber =
      [text, ...earlierCustomerText]
        .map((t) => normalizeOrderNumber(t.match(/\b(?:WN[\s-]?)?\d{5}\b/i)?.[0]))
        .find(Boolean) ?? null;

    let reasonCategory = detectReason(text);
    if (reasonCategory === 'unknown') {
      reasonCategory = earlierCustomerText.map(detectReason).find((r) => r !== 'unknown') ?? 'unknown';
    }

    // Match items on tokens that identify exactly one product ("monitor" in both "4K Monitor"
    // and "Monitor Arm" is ambiguous and ignored; "spring" is distinctive).
    const lower = text.toLowerCase();
    const candidateOrders = orderNumber ? ctx.orders.filter((o) => o.orderNumber === orderNumber) : ctx.orders;
    const candidateItems = candidateOrders.flatMap((o) => o.items);
    const tokenOwners = new Map<string, number>();
    for (const item of candidateItems) for (const t of new Set(tokens(item.name))) tokenOwners.set(t, (tokenOwners.get(t) ?? 0) + 1);
    const itemSkus = candidateItems
      .filter(
        (i) =>
          lower.includes(i.sku.toLowerCase()) ||
          tokens(i.name).some((t) => tokenOwners.get(t) === 1 && new RegExp(`\\b${t}`).test(lower)),
      )
      .map((i) => i.sku);

    const intent: Intent =
      reasonCategory === 'cancel_order'
        ? 'cancel_request'
        : reasonCategory !== 'unknown' || REFUND_WORDS.test(text)
          ? 'refund_request'
          : INQUIRY_WORDS.test(text)
            ? 'order_inquiry'
            : earlierCustomerText.some((t) => REFUND_WORDS.test(t))
              ? 'refund_request'
              : 'other';

    const amount = text.match(/\$\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)/)?.[1];
    const scan = scanForInjection(text);

    return {
      data: {
        intent,
        orderNumber,
        itemSkus: [...new Set(itemSkus)],
        reasonCategory,
        reasonSummary: `Customer message classified by keyword heuristics as ${reasonCategory.replaceAll('_', ' ')}.`,
        claimedAmount: amount ? Number(amount.replace(/,/g, '')) : null,
        unknownItemMentions: [],
        manipulationSignals: scan.flagged ? scan.matches.map((m) => `heuristic:${m}`) : [],
        confidence: intent === 'other' ? 0.5 : reasonCategory === 'unknown' ? 0.7 : 0.85,
      },
    };
  }

  async draftReply(ctx: ReplyContext, _signal?: AbortSignal): Promise<AiResult<ReplyDraft>> {
    return { data: templateReply(ctx) };
  }
}
