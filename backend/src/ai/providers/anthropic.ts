import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { Extraction } from '../../domain/types.js';
import { EXTRACTION_SYSTEM, REPLY_SYSTEM, buildExtractionUser, buildReplyUser } from '../prompts.js';
import { ExtractionWireSchema, ReplyWireSchema, toExtraction } from '../schemas.js';
import { nonce } from '../../lib/ids.js';
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
 * Claude adapter. Both calls use structured outputs, so the response is schema-valid JSON
 * that the SDK parses with Zod. Server-side fallbacks let the API reroute a refusal to
 * another model inside the same request; if everything still refuses we throw and the
 * pipeline falls back to the deterministic path.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    timeoutMs: number,
  ) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async extract(ctx: ExtractionContext, signal: AbortSignal): Promise<AiResult<Extraction>> {
    const { parsed, usage } = await this.call(
      EXTRACTION_SYSTEM,
      buildExtractionUser(ctx, nonce()),
      ExtractionWireSchema,
      signal,
    );
    return { data: toExtraction(parsed), usage };
  }

  async draftReply(ctx: ReplyContext, signal: AbortSignal): Promise<AiResult<ReplyDraft>> {
    const { parsed, usage } = await this.call(REPLY_SYSTEM, buildReplyUser(ctx), ReplyWireSchema, signal);
    return {
      data: { customerReply: parsed.customer_reply.trim(), internalNote: parsed.internal_note.trim() },
      usage,
    };
  }

  private async call<S extends z.ZodType>(
    system: string,
    user: string,
    schema: S,
    signal: AbortSignal,
  ): Promise<{ parsed: z.infer<S>; usage: AiUsage }> {
    const response = await this.client.beta.messages.parse(
      {
        model: this.model,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Static system prompt marked cacheable: identical bytes on every request.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        // Classification and short replies do not need deep reasoning; low effort keeps latency down.
        output_config: { format: betaZodOutputFormat(schema), effort: 'low' },
      },
      { signal },
    );

    if (response.stop_reason === 'refusal') throw new AiRefusalError();
    if (response.stop_reason === 'max_tokens') throw new Error('Model output truncated (max_tokens)');
    if (response.parsed_output == null) throw new Error('Model returned no parseable output');

    return {
      parsed: response.parsed_output as z.infer<S>,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  }
}
