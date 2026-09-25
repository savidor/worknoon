import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent, constructed } = vi.hoisted(() => ({ generateContent: vi.fn(), constructed: [] as unknown[] }));

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  return {
    ...actual,
    GoogleGenAI: vi.fn(function GoogleGenAI(options: unknown) {
      constructed.push(options);
      return { models: { generateContent } };
    }),
  };
});

import { ApiError } from '@google/genai';
import { GeminiProvider } from '../src/ai/providers/gemini.js';
import { AiRefusalError, type ReplyContext } from '../src/ai/types.js';

const signal = new AbortController().signal;

const ctx: ReplyContext = {
  outcome: 'APPROVED',
  customerFirstName: 'Amara',
  customerMessage: 'refund please',
  orderNumber: 'WN-10001',
  caseReference: 'RF-TEST01',
  refundAmount: '$129.00',
  reviewAmount: null,
  approvedItems: [{ name: 'Headphones', amount: '$129.00' }],
  deniedItems: [],
  reviewItems: [],
  reasons: [],
  missingInfo: [],
  unknownItems: [],
  orderChoices: [],
  statusLine: null,
  isDuplicate: false,
};

const ok = (payload: unknown) => ({
  text: JSON.stringify(payload),
  candidates: [{ finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
});
const reply = ok({ customer_reply: 'Hi Amara, approved.', internal_note: 'ok' });
const modelOf = (call: number) => (generateContent.mock.calls[call]![0] as { model: string }).model;

describe('Gemini provider resilience', () => {
  beforeEach(() => generateContent.mockReset());

  it('uses the primary model and reports which model answered', async () => {
    generateContent.mockResolvedValueOnce(reply);
    const provider = new GeminiProvider('key', ['primary', 'backup']);
    const res = await provider.draftReply(ctx, signal);
    expect(res.model).toBe('primary');
    expect(res.data.customerReply).toBe('Hi Amara, approved.');
  });

  it('sends a JSON schema with union types rewritten as anyOf', async () => {
    generateContent.mockResolvedValueOnce(reply);
    await new GeminiProvider('key', ['primary']).draftReply(ctx, signal);
    const config = (generateContent.mock.calls[0]![0] as { config: Record<string, unknown> }).config;
    expect(config.responseMimeType).toBe('application/json');
    expect(JSON.stringify(config.responseJsonSchema)).not.toContain('$schema');
  });

  it('moves to the backup model on a quota error, then skips the paused model', async () => {
    generateContent
      .mockRejectedValueOnce(new ApiError({ message: 'Quota exceeded. Please retry in 20.5s.', status: 429 }))
      .mockResolvedValueOnce(reply)
      .mockResolvedValueOnce(reply);
    const provider = new GeminiProvider('key', ['primary', 'backup']);

    expect((await provider.draftReply(ctx, signal)).model).toBe('backup');
    expect((await provider.draftReply(ctx, signal)).model).toBe('backup');
    expect([modelOf(0), modelOf(1), modelOf(2)]).toEqual(['primary', 'backup', 'backup']);
  });

  it('fails fast when every model is paused, without calling the API', async () => {
    const overloaded = () => Promise.reject(new ApiError({ message: 'overloaded', status: 503 }));
    generateContent.mockImplementationOnce(overloaded).mockImplementationOnce(overloaded);
    const provider = new GeminiProvider('key', ['primary', 'backup']);
    const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

    const first = await errorOf(provider.draftReply(ctx, signal));
    expect(first?.message).toBe('overloaded');
    expect(generateContent.mock.calls.length).toBe(2);

    const second = await errorOf(provider.draftReply(ctx, signal));
    expect(second?.message).toMatch(/cooling down/);
    expect(generateContent.mock.calls.length).toBe(2);
  });

  it('pauses a model for an hour when its daily quota is spent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const daily = () =>
        Promise.reject(new ApiError({ message: '{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"} Please retry in 28s.', status: 429 }));
      generateContent.mockImplementationOnce(daily).mockResolvedValueOnce(reply).mockResolvedValueOnce(reply).mockResolvedValueOnce(reply);
      const provider = new GeminiProvider('key', ['primary', 'backup']);
      await provider.draftReply(ctx, signal);

      vi.setSystemTime(Date.now() + 5 * 60_000); // well past the 28s hint
      expect((await provider.draftReply(ctx, signal)).model).toBe('backup');

      vi.setSystemTime(Date.now() + 61 * 60_000);
      expect((await provider.draftReply(ctx, signal)).model).toBe('primary');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not pause a model when our own time budget cancels the call', async () => {
    generateContent.mockImplementation((req: { config: { abortSignal: AbortSignal } }) =>
      new Promise((_resolve, reject) => req.config.abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    );
    const provider = new GeminiProvider('key', ['primary', 'backup']);
    const budget = new AbortController();
    const pending = provider.draftReply(ctx, budget.signal).catch((e: Error) => e);
    budget.abort();
    expect((await pending) instanceof Error).toBe(true);
    generateContent.mockReset();
    generateContent.mockResolvedValueOnce(reply);
    expect((await provider.draftReply(ctx, signal)).model).toBe('primary');
  });

  it('never sends Google a request deadline (it rejects deadlines under 10s)', () => {
    new GeminiProvider('key', ['primary']);
    const options = constructed.at(-1) as { httpOptions?: { timeout?: number } };
    expect(options.httpOptions?.timeout).toBeUndefined();
  });

  it('asks for minimal thinking, and retries without it if a model rejects the setting', async () => {
    const rejectThinking = () => Promise.reject(new ApiError({ message: 'thinking_level is not supported for this model', status: 400 }));
    generateContent.mockImplementationOnce(rejectThinking).mockResolvedValueOnce(reply).mockResolvedValueOnce(reply);
    const provider = new GeminiProvider('key', ['primary']);
    expect((await provider.draftReply(ctx, signal)).model).toBe('primary');
    const cfg = (i: number) => (generateContent.mock.calls[i]![0] as { config: { thinkingConfig?: unknown } }).config.thinkingConfig;
    expect(cfg(0)).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(cfg(1)).toBeUndefined();
    await provider.draftReply(ctx, signal);
    expect(cfg(2)).toBeUndefined(); // remembered for that model
  });

  it('does not try other models on a non-transient error', async () => {
    generateContent.mockRejectedValueOnce(new ApiError({ message: 'bad request', status: 400 }));
    const provider = new GeminiProvider('key', ['primary', 'backup']);
    await expect(provider.draftReply(ctx, signal)).rejects.toThrow('bad request');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('treats a blocked prompt as a refusal', async () => {
    generateContent.mockResolvedValueOnce({ text: '', promptFeedback: { blockReason: 'SAFETY' }, candidates: [] });
    await expect(new GeminiProvider('key', ['primary']).draftReply(ctx, signal)).rejects.toBeInstanceOf(AiRefusalError);
  });

  it('rejects output that does not match the schema', async () => {
    generateContent.mockResolvedValueOnce(ok({ customer_reply: 42 }));
    await expect(new GeminiProvider('key', ['primary']).draftReply(ctx, signal)).rejects.toThrow();
  });
});
