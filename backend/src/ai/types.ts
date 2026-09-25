import type { Extraction, Outcome } from '../domain/types.js';

export interface OrderSummaryForAi {
  orderNumber: string;
  status: string;
  orderedOn: string;
  deliveredOn: string | null;
  items: Array<{ sku: string; name: string; priceUsd: string; finalSale: boolean }>;
}

export interface ExtractionContext {
  customerFirstName: string;
  orders: OrderSummaryForAi[];
  /** Recent turns, oldest first, so follow-ups like "it's order 10005" resolve. */
  history: Array<{ role: 'customer' | 'assistant' | 'agent'; content: string }>;
  message: string;
}

export interface ReplyContext {
  outcome: Outcome;
  customerFirstName: string;
  customerMessage: string;
  orderNumber: string | null;
  caseReference: string | null;
  refundAmount: string | null;
  reviewAmount: string | null;
  approvedItems: Array<{ name: string; amount: string }>;
  deniedItems: Array<{ name: string; reason: string }>;
  reviewItems: Array<{ name: string }>;
  /** Customer-safe explanations from the triggered rules. */
  reasons: string[];
  /** What we still need from the customer (NEEDS_INFO). */
  missingInfo: string[];
  /** Products the customer named that are not on any of their orders. */
  unknownItems: string[];
  /** Orders to offer as choices, or a status line for INFO replies. */
  orderChoices: string[];
  statusLine: string | null;
  isDuplicate: boolean;
}

export interface ReplyDraft {
  customerReply: string;
  internalNote: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

export interface AiResult<T> {
  data: T;
  usage?: AiUsage;
  /** The model that actually answered, when a provider can route between several. */
  model?: string;
}

export interface AiProvider {
  readonly name: 'gemini' | 'mock';
  readonly model: string;
  extract(ctx: ExtractionContext, signal: AbortSignal): Promise<AiResult<Extraction>>;
  draftReply(ctx: ReplyContext, signal: AbortSignal): Promise<AiResult<ReplyDraft>>;
}

export class AiRefusalError extends Error {
  constructor(message = 'Model declined to answer') {
    super(message);
    this.name = 'AiRefusalError';
  }
}
