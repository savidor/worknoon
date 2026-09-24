import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POLICY, RULES } from '../src/policy/policy.js';

const doc = readFileSync(new URL('../src/policy/refund-policy.md', import.meta.url), 'utf8');

/** The human-readable policy and the machine-readable one must never drift apart. */
describe('refund policy document', () => {
  it('states the same version and thresholds as the engine', () => {
    expect(doc).toContain(POLICY.version);
    expect(doc).toContain(`${POLICY.refundWindowDays} days of delivery`);
    expect(doc).toContain(`$${POLICY.humanReviewThresholdCents / 100}`);
    expect(doc).toContain(`${POLICY.frequencyMaxRefunds} or more refunds in the last ${POLICY.frequencyLookbackDays} days`);
    expect(doc).toContain(`${POLICY.lostParcelGraceDays} or more days past`);
  });

  it('has a numbered clause for every rule the engine can trigger', () => {
    for (const rule of Object.values(RULES)) {
      expect(doc, `${rule.id} -> section ${rule.section}`).toContain(`**${rule.section}**`);
    }
  });

  it('contains no em dashes', () => {
    expect(doc).not.toContain('\u2014');
  });
});
