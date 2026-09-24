import { ApiError, GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Extraction } from '../../domain/types.js';
import { nonce } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { EXTRACTION_SYSTEM, REPLY_SYSTEM, buildExtractionUser, buildReplyUser } from '../prompts.js';
import { ExtractionWireSchema, ReplyWireSchema, toExtraction } from '../schemas.js';
import {
  AiRefusalError,
  type AiProvider,
  type AiResult,
  type AiUsage,
  type ExtractionContext,
  type ReplyContext,
  type ReplyDraft,
} from '../types.js';

/**
 * Converts a Zod schema to the JSON Schema subset Gemini documents: drops $schema and
 * rewrites union types such as ["string", "null"] as anyOf, which Gemini supports.
 */
function toGeminiSchema(schema: z.ZodType): unknown {
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (!node || typeof node !== 'object') return node;
    const { $schema: _ignored, type, ...rest } = node as Record<string, unknown>;
    const out: Record<string, unknown> = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, rewrite(v)]));
    if (Array.isArray(type)) out.anyOf = type.map((t) => ({ type: t }));
    else if (type !== undefined) out.type = type;
    return out;
  };
  return rewrite(z.toJSONSchema(schema));
}

const EXTRACTION_JSON_SCHEMA = toGeminiSchema(ExtractionWireSchema);
const REPLY_JSON_SCHEMA = toGeminiSchema(ReplyWireSchema);

/** Budget for one model attempt, so a slow model hands over quickly instead of stalling the chat. */
const ATTEMPT_TIMEOUT_MS = 12_000;
const DEFAULT_COOLDOWN_MS = 30_000;

/**
 * Per-model circuit breaker. A model that returns a quota, overload or timeout error is
 * skipped until its cooldown ends (Google's suggested retry delay when it gives one),
 * so customers never wait on a model that is known to be failing.
 */
class ModelCircuit {
  private readonly openUntil = new Map<string, number>();

  available(model: string): boolean {
    return (this.openUntil.get(model) ?? 0) <= Date.now();
  }

  trip(model: string, err: unknown): void {
    const hinted = err instanceof Error ? err.message.match(/retry in ([\d.]+)s/i)?.[1] : undefined;
    const ms = hinted ? Math.ceil(Number(hinted) * 1000) : DEFAULT_COOLDOWN_MS;
    this.openUntil.set(model, Date.now() + ms);
    logger.warn({ model, cooldownMs: ms, status: err instanceof ApiError ? err.status : undefined }, 'Gemini model paused');
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof ApiError) return [408, 429, 500, 502, 503, 504].includes(err.status);
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError' || /fetch failed|timed? ?out/i.test(err.message));
}

/**
 * Google Gemini adapter. Both calls use JSON-schema constrained output generated from
 * the shared Zod schemas, and every response is re-validated with Zod before use.
 *
 * Requests go to the primary model and move down the chain on transient failures
 * (each model has its own free-tier quota). If every model is unavailable the call
 * throws and the pipeline falls back to the deterministic offline provider.
 */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  readonly model: string;
  private readonly client: GoogleGenAI;
  private readonly circuit = new ModelCircuit();

  constructor(
    apiKey: string,
    private readonly models: string[],
  ) {
    if (models.length === 0) throw new Error('At least one Gemini model is required');
    this.model = models[0]!;
    this.client = new GoogleGenAI({ apiKey, httpOptions: { timeout: ATTEMPT_TIMEOUT_MS } });
  }

  async extract(ctx: ExtractionContext, signal: AbortSignal): Promise<AiResult<Extraction>> {
    const { parsed, usage, model } = await this.call(
      EXTRACTION_SYSTEM,
      buildExtractionUser(ctx, nonce()),
      ExtractionWireSchema,
      EXTRACTION_JSON_SCHEMA,
      signal,
    );
    return { data: toExtraction(parsed), usage, model };
  }

  async draftReply(ctx: ReplyContext, signal: AbortSignal): Promise<AiResult<ReplyDraft>> {
    const { parsed, usage, model } = await this.call(REPLY_SYSTEM, buildReplyUser(ctx), ReplyWireSchema, REPLY_JSON_SCHEMA, signal);
    return {
      data: { customerReply: parsed.customer_reply.trim(), internalNote: parsed.internal_note.trim() },
      usage,
      model,
    };
  }

  private async call<S extends z.ZodType>(
    system: string,
    user: string,
    schema: S,
    jsonSchema: unknown,
    signal: AbortSignal,
  ): Promise<{ parsed: z.infer<S>; usage: AiUsage; model: string }> {
    const candidates = this.models.filter((m) => this.circuit.available(m));
    if (candidates.length === 0) throw new Error('All Gemini models are cooling down after errors');

    let lastError: unknown;
    for (const model of candidates) {
      if (signal.aborted) break;
      try {
        return { ...(await this.generate(model, system, user, schema, jsonSchema, signal)), model };
      } catch (err) {
        lastError = err;
        if (!isTransient(err)) throw err;
        this.circuit.trip(model, err);
      }
    }
    throw lastError ?? new Error('Gemini request aborted');
  }

  private async generate<S extends z.ZodType>(
    model: string,
    system: string,
    user: string,
    schema: S,
    jsonSchema: unknown,
    signal: AbortSignal,
  ): Promise<{ parsed: z.infer<S>; usage: AiUsage }> {
    const response = await this.client.models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        temperature: 0.2,
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
      },
    });

    if (response.promptFeedback?.blockReason) throw new AiRefusalError(`Blocked: ${response.promptFeedback.blockReason}`);
    const finish = response.candidates?.[0]?.finishReason;
    if (finish && finish !== 'STOP') {
      if (finish === 'MAX_TOKENS') throw new Error('Model output truncated (MAX_TOKENS)');
      throw new AiRefusalError(`Generation stopped: ${finish}`);
    }
    const text = response.text;
    if (!text) throw new Error('Model returned no output');

    // Constrained decoding already enforces the schema; Zod re-validates so nothing unchecked reaches the pipeline.
    const parsed = schema.parse(JSON.parse(text)) as z.infer<S>;
    return {
      parsed,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        cacheReadTokens: response.usageMetadata?.cachedContentTokenCount,
      },
    };
  }
}
