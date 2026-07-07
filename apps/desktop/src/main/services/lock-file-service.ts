import { hostname } from 'node:os';
import { rm, writeFile } from 'node:fs/promises';
import type { DatabaseSession } from './database-session-store';

export interface LockState {
  readOnly: boolean;
  ownsLock: boolean;
}

export class LockFileService {
  async acquire(filePath: string, forceReadWrite: boolean): Promise<LockState> {
    const lockPath = this.lockPath(filePath);
    if (forceReadWrite) {
      await rm(lockPath, { force: true });
    }

    try {
      await writeFile(
        lockPath,
        `${JSON.stringify({ pid: process.pid, host: hostname(), openedAt: new Date().toISOString() }, null, 2)}\n`,
        { flag: 'wx', encoding: 'utf8', mode: 0o600 },
      );
      return { readOnly: false, ownsLock: true };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EEXIST') {
        return { readOnly: true, ownsLock: false };
      }
      throw error;
    }
  }

  async release(session: DatabaseSession): Promise<void> {
    if (session.ownsLock) {
      await this.releaseFile(session.path);
      session.ownsLock = false;
    }
  }

  async releaseFile(filePath: string): Promise<void> {
    await rm(this.lockPath(filePath), { force: true });
  }

  private lockPath(filePath: string): string {
    return `${filePath}.passdeck.lock`;
  }
}
