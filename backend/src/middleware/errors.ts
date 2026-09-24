import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFound: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'validation_error', message: 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Body parser errors (malformed JSON, payload too large) carry a status.
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status >= 500) logger.error({ err, reqId: req.id }, 'Unhandled error');
  res.status(status).json({
    error: {
      code: status === 500 ? 'internal_error' : 'bad_request',
      message: status === 500 ? 'Something went wrong. Please try again.' : String(err.message ?? 'Bad request'),
      requestId: req.id,
    },
  });
};
