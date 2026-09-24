import { SignJWT, jwtVerify } from 'jose';
import { timingSafeEqual, createHash } from 'node:crypto';
import { env } from '../config/env.js';

export type Principal = { kind: 'customer'; customerId: string } | { kind: 'admin'; username: string };

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'refund-desk';

export async function signToken(p: Principal, ttl: string): Promise<string> {
  const subject = p.kind === 'customer' ? p.customerId : p.username;
  return new SignJWT({ kind: p.kind })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<Principal | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, algorithms: ['HS256'] });
    if (!payload.sub) return null;
    if (payload.kind === 'customer') return { kind: 'customer', customerId: payload.sub };
    if (payload.kind === 'admin') return { kind: 'admin', username: payload.sub };
    return null;
  } catch {
    return null;
  }
}

/** Constant-time comparison that does not leak the password length. */
export function passwordMatches(candidate: string, expected: string): boolean {
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
