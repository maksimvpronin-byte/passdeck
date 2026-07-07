import type { Kdbx } from 'kdbxweb';
import { PassDeckError } from './errors';

export interface FileFingerprint {
  mtimeMs: number;
  size: number;
}

export interface DatabaseSession {
  id: string;
  path: string;
  name: string;
  db: Kdbx | undefined;
  locked: boolean;
  readOnly: boolean;
  dirty: boolean;
  ownsLock: boolean;
  fingerprint: FileFingerprint | undefined;
}

export type UnlockedDatabaseSession = DatabaseSession & { db: Kdbx };

export class DatabaseSessionStore {
  private readonly sessions = new Map<string, DatabaseSession>();

  list(): DatabaseSession[] {
    return [...this.sessions.values()];
  }

  add(session: DatabaseSession): void {
    this.sessions.set(session.id, session);
  }

  get(sessionId: string): DatabaseSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PassDeckError('SESSION_NOT_FOUND', 'Сессия базы не найдена.');
    }
    return session;
  }

  getUnlocked(sessionId: string): UnlockedDatabaseSession {
    const session = this.get(sessionId);
    if (!session.db || session.locked) {
      throw new PassDeckError('LOCKED', 'База заблокирована.');
    }
    return session as UnlockedDatabaseSession;
  }

  getWritable(sessionId: string): UnlockedDatabaseSession {
    const session = this.getUnlocked(sessionId);
    if (session.readOnly) {
      throw new PassDeckError('READ_ONLY', 'База открыта только для чтения.');
    }
    return session;
  }

  findByPath(filePath: string): DatabaseSession | undefined {
    return this.list().find((session) => session.path === filePath);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }

  openPaths(): string[] {
    return this.list().map((session) => session.path);
  }
}
