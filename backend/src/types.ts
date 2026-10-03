export type PublicUser = { id: string; name: string; email: string };

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}
declare module 'express-serve-static-core' {
  interface Request {
    user?: PublicUser;
  }
}
