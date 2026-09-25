import { z } from 'zod';
import { containsInternalTerms } from '../security/output-guard.js';
import { FIELDS, FIELD_KEYS, OPERATORS, OPERATOR_KEYS, type CustomRule } from './custom-rules.js';
import type { PolicyConfig } from './policy.js';

const slugList = z
  .array(z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,40}$/, 'Use lowercase letters, numbers and underscores'))
  .max(20)
  .transform((l) => [...new Set(l)]);

/** Ranges keep a typo from producing an absurd policy (a 0-day window, a $0 review threshold). */
const whole = (label: string, min: number, max: number, unit: string) =>
  z.number({ message: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be between ${min} and ${max} ${unit}`).max(max, `${label} must be between ${min} and ${max} ${unit}`);

export const PolicyConfigSchema = z.object({
  refundWindowDays: whole('Refund window', 1, 365, 'days'),
  humanReviewThresholdCents: z
    .number({ message: 'Review threshold must be a number' })
    .int()
    .min(1_000, 'Review threshold must be between $10 and $100,000')
    .max(10_000_000, 'Review threshold must be between $10 and $100,000'),
  frequencyLookbackDays: whole('Frequency lookback', 7, 365, 'days'),
  frequencyMaxRefunds: whole('Refund frequency limit', 1, 50, 'refunds'),
  lostParcelGraceDays: whole('Lost parcel delay', 1, 60, 'days'),
  minExtractionConfidence: z
    .number({ message: 'Minimum AI confidence must be a number' })
    .min(0.3, 'Minimum AI confidence must be between 0.3 and 0.95')
    .max(0.95, 'Minimum AI confidence must be between 0.3 and 0.95'),
  maxClarificationTurns: whole('Clarifying questions', 1, 5, 'questions'),
  nonReturnableCategories: slugList,
  riskAccountFlags: slugList,
}) satisfies z.ZodType<PolicyConfig>;

const ConditionSchema = z
  .object({
    field: z.enum(FIELD_KEYS as [string, ...string[]]),
    operator: z.enum(OPERATOR_KEYS as [string, ...string[]]),
    value: z.union([z.string().trim().max(80), z.number().finite(), z.array(z.string().trim().min(1).max(60)).min(1).max(20), z.null()]),
  })
  .superRefine((c, ctx) => {
    const field = FIELDS[c.field as keyof typeof FIELDS];
    const op = OPERATORS[c.operator as keyof typeof OPERATORS];
    if (!(op.types as readonly string[]).includes(field.type)) {
      ctx.addIssue({ code: 'custom', message: `"${op.label}" cannot be used with ${field.label}` });
      return;
    }
    const isList = c.operator === 'in' || c.operator === 'not_in';
    const needsNumber = field.type === 'money' || field.type === 'number';
    if (field.type === 'boolean') {
      if (c.value !== null) ctx.addIssue({ code: 'custom', message: `${field.label} takes no value` });
    } else if (isList) {
      if (!Array.isArray(c.value)) ctx.addIssue({ code: 'custom', message: `${field.label} needs a list of values` });
    } else if (needsNumber) {
      if (typeof c.value !== 'number' || c.value < 0) ctx.addIssue({ code: 'custom', message: `${field.label} needs a positive number` });
    } else if (typeof c.value !== 'string' || !c.value) {
      ctx.addIssue({ code: 'custom', message: `${field.label} needs a value` });
    }
    const options = 'options' in field ? (field.options as readonly string[]) : null;
    if (options) {
      const values = Array.isArray(c.value) ? c.value : [c.value];
      const bad = values.filter((v) => !options.includes(String(v)));
      if (bad.length) ctx.addIssue({ code: 'custom', message: `Unknown ${field.label.toLowerCase()}: ${bad.join(', ')}` });
    }
  });

export const CustomRuleSchema = z.object({
  id: z.string().regex(/^CUSTOM_[A-Z0-9_]{1,48}$/).optional(),
  name: z.string().trim().min(3, 'Give the rule a name').max(80),
  enabled: z.boolean().default(true),
  // Custom rules may only tighten the policy. Approvals stay with the built-in rules.
  effect: z.enum(['DENIED', 'ESCALATED']),
  conditions: z.array(ConditionSchema).min(1, 'Add at least one condition').max(6),
  customerText: z
    .string()
    .trim()
    .min(10, 'Explain the rule to the customer in a short phrase')
    .max(200)
    .refine((t) => !/[<>{}]/.test(t), 'Plain text only')
    .refine((t) => !containsInternalTerms(t), 'Customer wording must not mention fraud, flags, rule ids or internal systems'),
});

export const PolicyDraftSchema = z
  .object({
    config: PolicyConfigSchema,
    customRules: z.array(CustomRuleSchema).max(50),
  })
  .superRefine((d, ctx) => {
    const names = d.customRules.map((r) => r.name.toLowerCase());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length) ctx.addIssue({ code: 'custom', message: `Rule names must be unique: ${[...new Set(dupes)].join(', ')}` });
  });

export type PolicyDraft = { config: PolicyConfig; customRules: CustomRule[] };

const slug = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'RULE';

/** Validates a draft and gives every rule a stable id (kept if it already has one). */
export function normalizeDraft(input: unknown): PolicyDraft {
  const parsed = PolicyDraftSchema.parse(input);
  const used = new Set<string>();
  const customRules = parsed.customRules.map((r) => {
    let id = r.id ?? `CUSTOM_${slug(r.name)}`;
    for (let n = 2; used.has(id); n++) id = `CUSTOM_${slug(r.name)}_${n}`;
    used.add(id);
    return { ...r, id, conditions: r.conditions as CustomRule['conditions'] };
  });
  return { config: parsed.config, customRules };
}
