import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCents } from '../lib/money.js';
import { describeRule } from './custom-rules.js';
import { POLICY_CONSTANTS, type ActivePolicy } from './policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(path.join(here, 'refund-policy.md'), 'utf8');

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Renders the customer-facing policy from the active version, so the published wording
 * always matches what the engine enforces, including any custom rules.
 */
export function renderPolicyDocument(policy: ActivePolicy): string {
  const cfg = policy.config;
  const enabled = policy.customRules.filter((r) => r.enabled);
  const custom = enabled.length
    ? `## 9. Additional rules\n\n${enabled
        .map((r, i) => `**9.${i + 1}** **${r.name}.** ${describeRule(r)}`)
        .join('\n\n')}\n\n`
    : '';
  const values: Record<string, string> = {
    version: policy.version,
    effectiveFrom: longDate(POLICY_CONSTANTS.effectiveFrom),
    refundWindowDays: String(cfg.refundWindowDays),
    threshold: formatCents(cfg.humanReviewThresholdCents).replace(/\.00$/, ''),
    nonReturnableCategories: cfg.nonReturnableCategories.map((c) => c.replaceAll('_', ' ')).join(', ') || 'none',
    lostParcelGraceDays: String(cfg.lostParcelGraceDays),
    frequencyMaxRefunds: String(cfg.frequencyMaxRefunds),
    frequencyLookbackDays: String(cfg.frequencyLookbackDays),
    maxClarificationTurns: String(cfg.maxClarificationTurns),
    customRules: custom,
  };
  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '');
}
