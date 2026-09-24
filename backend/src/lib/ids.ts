import { randomBytes } from 'node:crypto';

// Crockford base32 without ambiguous characters (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Short, human-friendly case reference such as RF-7K3M9Q, safe to read over the phone. */
export function caseReference(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `RF-${out}`;
}

export function nonce(bytes = 6): string {
  return randomBytes(bytes).toString('hex');
}
