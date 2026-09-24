import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { GeminiProvider } from './providers/gemini.js';
import { MockProvider } from './providers/mock.js';
import type { AiProvider } from './types.js';

/** Gemini when a key is configured, otherwise the deterministic offline provider. */
function createProvider(): AiProvider {
  if (env.AI_PROVIDER === 'gemini' && env.GEMINI_API_KEY) {
    const fallbacks = env.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean);
    return new GeminiProvider(env.GEMINI_API_KEY, [...new Set([env.GEMINI_MODEL, ...fallbacks])]);
  }
  if (env.AI_PROVIDER === 'gemini') {
    logger.warn('GEMINI_API_KEY is not set; running in offline mode');
  }
  return new MockProvider();
}

export const aiProvider: AiProvider = createProvider();
export const fallbackProvider: AiProvider = aiProvider.name === 'mock' ? aiProvider : new MockProvider();
