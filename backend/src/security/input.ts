export const MAX_MESSAGE_CHARS = 2000;

// Zero-width, bidi override and other invisible characters used to smuggle instructions.
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/g;
// Control characters except tab, newline and carriage return.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Normalizes customer text before it reaches detection or the model:
 * NFKC folds look-alike characters (full-width letters, ligatures) so pattern
 * matching sees what a human reads, and invisible characters are removed.
 */
export function sanitizeInput(raw: string): { text: string; removedInvisible: number } {
  const normalized = raw.normalize('NFKC');
  const removedInvisible = (normalized.match(INVISIBLE) ?? []).length;
  const text = normalized
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
  return { text, removedInvisible };
}

interface Pattern {
  id: string;
  weight: number;
  re: RegExp;
}

/**
 * Heuristic signatures of prompt injection and social engineering. This layer is
 * cheap, deterministic and runs even when the model is unavailable. The model adds
 * a semantic second opinion; either one alone is enough to flag the request.
 */
const PATTERNS: Pattern[] = [
  { id: 'ignore_instructions', weight: 3, re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|all|your|the|any)\b[^.\n]{0,30}\b(instructions?|rules?|polic(y|ies)|prompts?|guidelines?|constraints?)/i },
  { id: 'role_hijack', weight: 3, re: /\b(you are now|act as|pretend (to be|you are)|roleplay as|from now on you)\b/i },
  { id: 'system_prompt_probe', weight: 3, re: /\b(system|developer|hidden|initial)\s+(prompt|message|instructions?)\b/i },
  { id: 'mode_switch', weight: 3, re: /\b(developer|debug|admin|god|jailbreak|dan)\s+mode\b/i },
  { id: 'authority_claim', weight: 2, re: /\b(i am|i'm|this is|as)\s+(an?\s+|the\s+)?((store|shop|site|support|customer service)\s+)?(admin|administrator|manager|supervisor|developer|engineer|ceo|owner|staff|employee|support agent)\b/i },
  { id: 'system_override', weight: 3, re: /\b(system|admin|security|policy)\s+(override|update|notice|instruction)s?\b|\bauthori[sz](e|ed|ing)\s+(you|this|the|a)\b/i },
  { id: 'block_review', weight: 2, re: /\b(do not|don'?t|never|without)\s+(escalat\w*|review\w*|flag\w*|check\w*|verif\w*)/i },
  { id: 'forced_outcome', weight: 2, re: /\b(you must|you have to|you will|i order you to|i command you to)\b[^.\n]{0,30}\b(approve|refund|accept)/i },
  { id: 'policy_override', weight: 2, re: /\b(approve|refund)\b[^.\n]{0,40}\b(regardless|no matter what|without (checking|review|verification)|anyway|override)\b/i },
  { id: 'fake_markup', weight: 3, re: /<\/?\s*(system|assistant|instructions?|customer_message|admin|tool)[^>]*>|\[\/?(system|inst)\]|<\|im_(start|end)\|>/i },
  { id: 'output_forging', weight: 2, re: /\b(respond|reply|output|say)\s+(only\s+)?(with\s+)?["']?(approved|decision\s*[:=])/i },
  { id: 'encoded_payload', weight: 1, re: /\b(base64|rot13|hex)\b.{0,20}\b(decode|instructions?)\b|[A-Za-z0-9+/]{60,}={0,2}/i },
];

export const INJECTION_THRESHOLD = 3;

/** Plain-English meaning of each signal, written for support staff rather than engineers. */
export const SIGNAL_LABELS: Record<string, string> = {
  ignore_instructions: 'Told the assistant to ignore its instructions or the refund policy',
  role_hijack: 'Tried to give the assistant a new role ("you are now...")',
  system_prompt_probe: "Asked for the assistant's hidden instructions",
  mode_switch: 'Tried to switch the assistant into a special "admin" or "developer" mode',
  authority_claim: 'Claimed to be staff, a manager or an administrator',
  system_override: 'Wrote a fake "system override" or claimed to authorise the refund',
  block_review: 'Asked for the request not to be reviewed or escalated',
  forced_outcome: 'Demanded that the assistant approve the refund',
  policy_override: 'Asked for approval regardless of the refund policy',
  fake_markup: 'Included hidden code that pretends to be an instruction from our system',
  output_forging: 'Told the assistant exactly what to reply',
  encoded_payload: 'Included scrambled or encoded text that could hide instructions',
  invisible_characters: 'Contained invisible characters that can hide text',
};

export const describeSignal = (id: string) => SIGNAL_LABELS[id] ?? id.replaceAll('_', ' ');

export interface InjectionScan {
  score: number;
  matches: string[];
  flagged: boolean;
  /** The exact words that triggered each signal, so reviewers can see them highlighted. */
  evidence: Array<{ signal: string; label: string; text: string }>;
}

/**
 * The words to show a reviewer. For fake markup, that is everything from the first forged tag
 * to the last one, so the whole injected "instruction" is highlighted, not just one tag.
 */
function evidenceText(p: Pattern, text: string, first: RegExpMatchArray): string {
  if (p.id === 'fake_markup') {
    const all = [...text.matchAll(new RegExp(p.re.source, 'gi'))];
    const start = all[0]?.index ?? first.index ?? 0;
    const last = all.at(-1);
    const end = last && last.index !== undefined ? last.index + last[0].length : start + first[0].length;
    return text.slice(start, end).slice(0, 300);
  }
  return first[0].slice(0, 200);
}

export function scanForInjection(text: string, removedInvisible = 0): InjectionScan {
  const hits = PATTERNS.map((p) => ({ p, m: text.match(p.re) })).filter((h) => h.m);
  let score = hits.reduce((s, h) => s + h.p.weight, 0);
  const ids = hits.map((h) => h.p.id);
  const evidence = hits.map((h) => ({ signal: h.p.id, label: describeSignal(h.p.id), text: evidenceText(h.p, text, h.m!) }));
  if (removedInvisible > 0) {
    score += 2;
    ids.push('invisible_characters');
    evidence.push({ signal: 'invisible_characters', label: describeSignal('invisible_characters'), text: '' });
  }
  return { score, matches: ids, flagged: score >= INJECTION_THRESHOLD, evidence };
}
