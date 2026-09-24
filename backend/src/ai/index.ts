import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GeminiProvider } from './providers/gemini.js';
import { MockProvider } from './providers/mock.js';
import { OpenAiProvider } from './providers/openai.js';
import type { AiProvider } from './types.js';

function createProvider(): AiProvider {
  const wanted = env.AI_PROVIDER;
  if ((wanted === 'auto' || wanted === 'anthropic') && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL, env.AI_TIMEOUT_MS);
  }
  if ((wanted === 'auto' || wanted === 'openai') && env.OPENAI_API_KEY) {
    return new OpenAiProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.AI_TIMEOUT_MS);
  }
  if ((wanted === 'auto' || wanted === 'gemini') && env.GEMINI_API_KEY) {
    return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL, env.AI_TIMEOUT_MS);
  }
  if (wanted !== 'auto' && wanted !== 'mock') {
    logger.warn({ wanted }, 'AI provider requested but no API key set; using offline mock provider');
  }
  return new MockProvider();
}

export const aiProvider: AiProvider = createProvider();
export const fallbackProvider: AiProvider = aiProvider.name === 'mock' ? aiProvider : new MockProvider();
