import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { config, sessionLifetime } from './config.js';
import { db } from './db.js';
import { PrismaSessionStore } from './session-store.js';
import { authRoutes, csrfProtection } from './auth.js';
import { taskRoutes } from './tasks.js';
import { AppError, errorHandler } from './errors.js';
import './types.js';

export const app = express();
app.disable('x-powered-by');
// Nginx is the only public entry point in Compose; the API port is not published.
if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: config.API_RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.NODE_ENV === 'test',
    message: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute.' },
  }),
);
app.use(
  '/api',
  session({
    name: 'taskmanager.sid',
    store: new PrismaSessionStore(),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      path: '/api',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.COOKIE_SECURE,
      maxAge: sessionLifetime,
    },
  }),
);
app.use('/api/auth', csrfProtection, authRoutes);
app.use('/api/tasks', taskRoutes);
app.use((_req, _res, next) =>
  next(new AppError(404, 'NOT_FOUND', 'This endpoint does not exist.')),
);
app.use(errorHandler);
