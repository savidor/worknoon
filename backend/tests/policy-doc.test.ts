import { describe, expect, it } from 'vitest';
import { renderPolicyDocument } from '../src/policy/document.js';
import { DEFAULT_POLICY, DEFAULT_POLICY_CONFIG, builtInRules, type ActivePolicy } from '../src/policy/policy.js';

const doc = renderPolicyDocument(DEFAULT_POLICY);

/** The published policy and the engine must never drift apart. */
describe('refund policy document', () => {
  it('states the same version and thresholds as the engine', () => {
    const c = DEFAULT_POLICY_CONFIG;
    expect(doc).toContain(DEFAULT_POLICY.version);
    expect(doc).toContain(`${c.refundWindowDays} days of delivery`);
    expect(doc).toContain(`$${c.humanReviewThresholdCents / 100}`);
    expect(doc).toContain(`${c.frequencyMaxRefunds} or more refunds in the last ${c.frequencyLookbackDays} days`);
    expect(doc).toContain(`${c.lostParcelGraceDays} or more days past`);
    expect(doc).not.toMatch(/\{\{\w+\}\}/);
  });

  it('has a numbered clause for every built-in rule', () => {
    for (const rule of Object.values(builtInRules(DEFAULT_POLICY_CONFIG))) {
      expect(doc, `${rule.id} -> section ${rule.section}`).toContain(`**${rule.section}**`);
    }
  });

  it('follows threshold changes and lists custom rules', () => {
    const policy: ActivePolicy = {
      version: '2026.09-r7',
      config: { ...DEFAULT_POLICY_CONFIG, refundWindowDays: 14, humanReviewThresholdCents: 150_000 },
      customRules: [
        {
          id: 'CUSTOM_OPENED_ELECTRONICS',
          name: 'Opened electronics',
          enabled: true,
          effect: 'DENIED',
          customerText: 'opened electronics cannot be returned for a change of mind',
          conditions: [
            { field: 'item.category', operator: 'eq', value: 'electronics' },
            { field: 'reason', operator: 'eq', value: 'changed_mind' },
          ],
        },
      ],
    };
    const rendered = renderPolicyDocument(policy);
    expect(rendered).toContain('14 days of delivery');
    expect(rendered).toContain('above $1,500');
    expect(rendered).toContain('**9.1** **Opened electronics.**');
    expect(rendered).toContain('item category is electronics and refund reason is changed mind');
    expect(builtInRules(policy.config).OUTSIDE_WINDOW.customerText).toContain('14 days');
  });

  it('contains no em dashes', () => {
    expect(doc).not.toContain('\u2014');
  });
});
