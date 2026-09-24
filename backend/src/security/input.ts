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
  { id: 'authority_claim', weight: 2, re: /\b(i am|i'm|this is)\s+(an?\s+)?(admin|administrator|manager|supervisor|developer|engineer|ceo|staff|employee|support agent)\b/i },
  { id: 'forced_outcome', weight: 2, re: /\b(you must|you have to|you will|i order you to|i command you to)\b[^.\n]{0,30}\b(approve|refund|accept)/i },
  { id: 'policy_override', weight: 2, re: /\b(approve|refund)\b[^.\n]{0,40}\b(regardless|no matter what|without (checking|review|verification)|anyway|override)\b/i },
  { id: 'fake_markup', weight: 3, re: /<\/?\s*(system|assistant|instructions?|customer_message|admin|tool)[^>]*>|\[\/?(system|inst)\]|<\|im_(start|end)\|>/i },
  { id: 'output_forging', weight: 2, re: /\b(respond|reply|output|say)\s+(only\s+)?(with\s+)?["']?(approved|decision\s*[:=])/i },
  { id: 'encoded_payload', weight: 1, re: /\b(base64|rot13|hex)\b.{0,20}\b(decode|instructions?)\b|[A-Za-z0-9+/]{60,}={0,2}/i },
];

export const INJECTION_THRESHOLD = 3;

export interface InjectionScan {
  score: number;
  matches: string[];
  flagged: boolean;
}

export function scanForInjection(text: string, removedInvisible = 0): InjectionScan {
  const matches = PATTERNS.filter((p) => p.re.test(text));
  let score = matches.reduce((s, p) => s + p.weight, 0);
  const ids = matches.map((p) => p.id);
  if (removedInvisible > 0) {
    score += 2;
    ids.push('invisible_characters');
  }
  return { score, matches: ids, flagged: score >= INJECTION_THRESHOLD };
}
