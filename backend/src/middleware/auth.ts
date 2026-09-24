import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';
import { verifyToken, type Principal } from '../lib/auth.js';

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export function requireRole(kind: Principal['kind']) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    const principal = token ? await verifyToken(token) : null;
    if (!principal) return next(HttpError.unauthorized());
    if (principal.kind !== kind) return next(HttpError.forbidden());
    req.principal = principal;
    next();
  };
}

export function customerId(req: Request): string {
  if (req.principal?.kind !== 'customer') throw HttpError.unauthorized();
  return req.principal.customerId;
}

export function adminName(req: Request): string {
  if (req.principal?.kind !== 'admin') throw HttpError.unauthorized();
  return req.principal.username;
}
