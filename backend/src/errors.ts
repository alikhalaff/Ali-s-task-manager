import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from './generated/client.js';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(422).json({
      code: 'VALIDATION_ERROR',
      message: 'Please check the highlighted fields.',
      details: error.flatten().fieldErrors,
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({
      code: 'EMAIL_EXISTS',
      message: 'An account with this email already exists.',
      details: { email: ['This email is already registered.'] },
    });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ code: 'INVALID_JSON', message: 'The request body must be valid JSON.' });
    return;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    res.status(413).json({ code: 'BODY_TOO_LARGE', message: 'The request is too large.' });
    return;
  }
  console.error('Unhandled API error:', error instanceof Error ? error.message : 'Unknown error');
  res
    .status(500)
    .json({ code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' });
};
