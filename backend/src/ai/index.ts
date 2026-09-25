import { AsyncLocalStorage } from 'node:async_hooks';
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

/**
 * Lets a unit of work run against a specific provider without touching live traffic,
 * for example generating sample activity offline so it never spends model quota.
 */
const override = new AsyncLocalStorage<AiProvider>();

export function currentProvider(): AiProvider {
  return override.getStore() ?? aiProvider;
}

export function withProvider<T>(provider: AiProvider, fn: () => Promise<T>): Promise<T> {
  return override.run(provider, fn);
}
