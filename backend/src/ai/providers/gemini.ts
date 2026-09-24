import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Extraction } from '../../domain/types.js';
import { nonce } from '../../lib/ids.js';
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

/**
 * Google Gemini adapter, using the same prompts and schemas as the other providers.
 * Gemini has a free tier, which makes it a zero-cost way to run the real AI path.
 * The response is JSON-schema constrained and then re-validated with Zod.
 */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    timeoutMs: number,
  ) {
    this.client = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  }

  async extract(ctx: ExtractionContext, signal: AbortSignal): Promise<AiResult<Extraction>> {
    const { parsed, usage } = await this.call(
      EXTRACTION_SYSTEM,
      buildExtractionUser(ctx, nonce()),
      ExtractionWireSchema,
      EXTRACTION_JSON_SCHEMA,
      signal,
    );
    return { data: toExtraction(parsed), usage };
  }

  async draftReply(ctx: ReplyContext, signal: AbortSignal): Promise<AiResult<ReplyDraft>> {
    const { parsed, usage } = await this.call(REPLY_SYSTEM, buildReplyUser(ctx), ReplyWireSchema, REPLY_JSON_SCHEMA, signal);
    return {
      data: { customerReply: parsed.customer_reply.trim(), internalNote: parsed.internal_note.trim() },
      usage,
    };
  }

  private async call<S extends z.ZodType>(
    system: string,
    user: string,
    schema: S,
    jsonSchema: unknown,
    signal: AbortSignal,
  ): Promise<{ parsed: z.infer<S>; usage: AiUsage }> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        temperature: 0.2,
        abortSignal: signal,
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
