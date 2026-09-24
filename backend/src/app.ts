import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { adminRouter } from './routes/admin.routes.js';
import { customerRouter } from './routes/customer.routes.js';
import { publicRouter } from './routes/public.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Behind the nginx frontend proxy.

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()), credentials: false }));
  app.use(express.json({ limit: '16kb' }));

  app.use('/api', publicRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', customerRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
