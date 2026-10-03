import session, { type SessionData } from 'express-session';
import { db } from './db.js';
import { sessionLifetime } from './config.js';

type Callback = (error?: unknown) => void;
export class PrismaSessionStore extends session.Store {
  get(id: string, callback: (error: unknown, data?: SessionData | null) => void) {
    db.session
      .findUnique({ where: { id } })
      .then(async (record) => {
        if (!record) return callback(null, null);
        if (record.expiresAt <= new Date()) {
          await db.session.deleteMany({ where: { id } });
          return callback(null, null);
        }
        callback(null, JSON.parse(record.data) as SessionData);
      })
      .catch(callback);
  }
  set(id: string, data: SessionData, callback: Callback = () => {}) {
    const expiresAt = data.cookie.expires
      ? new Date(data.cookie.expires)
      : new Date(Date.now() + sessionLifetime);
    const record = { data: JSON.stringify(data), expiresAt };
    db.session
      .upsert({ where: { id }, create: { id, ...record }, update: record })
      .then(() => callback())
      .catch(callback);
  }
  destroy(id: string, callback: Callback = () => {}) {
    db.session
      .deleteMany({ where: { id } })
      .then(() => callback())
      .catch(callback);
  }
  touch(id: string, data: SessionData, callback: Callback = () => {}) {
    const expiresAt = data.cookie.expires
      ? new Date(data.cookie.expires)
      : new Date(Date.now() + sessionLifetime);
    db.session
      .updateMany({ where: { id }, data: { expiresAt } })
      .then(() => callback())
      .catch(callback);
  }
}
