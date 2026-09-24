import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
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

/** OpenAI adapter with the same prompts and schemas, to show the AI layer is provider-agnostic. */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    timeoutMs: number,
  ) {
    this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async extract(ctx: ExtractionContext, signal: AbortSignal): Promise<AiResult<Extraction>> {
    const { parsed, usage } = await this.call(
      EXTRACTION_SYSTEM,
      buildExtractionUser(ctx, nonce()),
      ExtractionWireSchema,
      'refund_extraction',
      signal,
    );
    return { data: toExtraction(parsed), usage };
  }

  async draftReply(ctx: ReplyContext, signal: AbortSignal): Promise<AiResult<ReplyDraft>> {
    const { parsed, usage } = await this.call(
      REPLY_SYSTEM,
      buildReplyUser(ctx),
      ReplyWireSchema,
      'refund_reply',
      signal,
    );
    return {
      data: { customerReply: parsed.customer_reply.trim(), internalNote: parsed.internal_note.trim() },
      usage,
    };
  }

  private async call<S extends z.ZodType>(
    system: string,
    user: string,
    schema: S,
    name: string,
    signal: AbortSignal,
  ): Promise<{ parsed: z.infer<S>; usage: AiUsage }> {
    const completion = await this.client.chat.completions.parse(
      {
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: zodResponseFormat(schema, name),
      },
      { signal },
    );
    const message = completion.choices[0]?.message;
    if (message?.refusal) throw new AiRefusalError(message.refusal);
    if (!message?.parsed) throw new Error('Model returned no parseable output');
    return {
      parsed: message.parsed as z.infer<S>,
      usage: {
        inputTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
      },
    };
  }
}
