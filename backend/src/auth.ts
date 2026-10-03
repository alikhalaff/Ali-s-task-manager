import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import argon2 from 'argon2';
import { rateLimit } from 'express-rate-limit';
import { db } from './db.js';
import { config, publicOrigin } from './config.js';
import { AppError } from './errors.js';
import { loginSchema, registerSchema } from './validation.js';
import type { PublicUser } from './types.js';

export const userSelect = { id: true, name: true, email: true } as const;
const passwordOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
// Equalize expensive password verification for existing and unknown accounts.
// Generate once at startup, never once per failed login.
const dummyPasswordHash = await argon2.hash(randomBytes(32), passwordOptions);
export function csrfToken(req: Request) {
  req.session.csrfToken ??= randomBytes(32).toString('hex');
  return req.session.csrfToken;
}
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const expected = req.session.csrfToken;
  const actual = req.get('x-csrf-token');
  if (
    (origin && origin !== publicOrigin) ||
    !expected ||
    !actual ||
    Buffer.byteLength(expected) !== Buffer.byteLength(actual) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  ) {
    return next(
      new AppError(403, 'CSRF_INVALID', 'Your session changed. Reload the page and try again.'),
    );
  }
  next();
};
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const user = req.session.userId
    ? await db.user.findUnique({ where: { id: req.session.userId }, select: userSelect })
    : null;
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  req.user = user;
  next();
};
async function signIn(req: Request, user: PublicUser) {
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
  req.session.userId = user.id;
  const token = csrfToken(req);
  await new Promise<void>((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );
  return { user, csrfToken: token };
}
export const authRoutes = Router();
authRoutes.get('/session', async (req, res) => {
  const user = req.session.userId
    ? await db.user.findUnique({ where: { id: req.session.userId }, select: userSelect })
    : null;
  if (!user) delete req.session.userId;
  res.json({ user, csrfToken: csrfToken(req) });
});
authRoutes.use(
  ['/register', '/login'],
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.AUTH_RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.NODE_ENV === 'test',
    message: {
      code: 'RATE_LIMITED',
      message: 'Too many authentication attempts. Try again in 15 minutes.',
    },
  }),
);
authRoutes.post('/register', async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await argon2.hash(input.password, passwordOptions);
  const user = await db.user.create({
    data: { name: input.name, email: input.email, passwordHash },
    select: userSelect,
  });
  res.status(201).json(await signIn(req, user));
});
authRoutes.post('/login', async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await db.user.findUnique({ where: { email: input.email } });
  const passwordValid = await argon2.verify(
    user?.passwordHash ?? dummyPasswordHash,
    input.password,
  );
  if (!user || !passwordValid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  res.json(await signIn(req, { id: user.id, name: user.name, email: user.email }));
});
authRoutes.post('/logout', async (req, res) => {
  await new Promise<void>((resolve, reject) =>
    req.session.destroy((error) => (error ? reject(error) : resolve())),
  );
  res.clearCookie('taskmanager.sid', {
    path: '/api',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
  });
  res.status(204).end();
});
