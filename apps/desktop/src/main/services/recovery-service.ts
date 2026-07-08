import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface RecoveryMetadata {
  sourcePath: string;
  recoveryPath: string;
  createdAt: string;
  sourceFingerprint?: {
    mtimeMs: number;
    size: number;
  };
}

type RecoveryJob = {
  timer: NodeJS.Timeout;
};

export class RecoveryService {
  private readonly jobs = new Map<string, RecoveryJob>();

  constructor(
    private readonly recoveryDir: string,
    private readonly delayMs = 60_000,
  ) {}

  schedule(
    sourcePath: string,
    sourceFingerprint: RecoveryMetadata['sourceFingerprint'],
    createEncryptedSnapshot: () => Promise<Buffer>,
  ): void {
    if (this.jobs.has(sourcePath)) {
      return;
    }

    const timer = setTimeout(() => {
      this.jobs.delete(sourcePath);
      void this.writeRecovery(sourcePath, sourceFingerprint, createEncryptedSnapshot).catch(
        () => undefined,
      );
    }, this.delayMs);
    timer.unref();
    this.jobs.set(sourcePath, { timer });
  }

  async clear(sourcePath: string): Promise<void> {
    const job = this.jobs.get(sourcePath);
    if (job) {
      clearTimeout(job.timer);
      this.jobs.delete(sourcePath);
    }

    await rm(this.recoveryPath(sourcePath), { force: true });
    await rm(this.metadataPath(sourcePath), { force: true });
  }

  shutdown(): void {
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
    }
    this.jobs.clear();
  }

  async list(): Promise<RecoveryMetadata[]> {
    try {
      const entries = await readdir(this.recoveryDir, { withFileTypes: true });
      const metadataFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(this.recoveryDir, entry.name));

      const metadata: RecoveryMetadata[] = [];
      for (const filePath of metadataFiles) {
        const raw = await readFile(filePath, 'utf8');
        metadata.push(JSON.parse(raw) as RecoveryMetadata);
      }
      return metadata.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async writeRecovery(
    sourcePath: string,
    sourceFingerprint: RecoveryMetadata['sourceFingerprint'],
    createEncryptedSnapshot: () => Promise<Buffer>,
  ): Promise<void> {
    const recoveryPath = this.recoveryPath(sourcePath);
    const metadataPath = this.metadataPath(sourcePath);
    const snapshot = await createEncryptedSnapshot();
    const metadata: RecoveryMetadata = {
      sourcePath,
      recoveryPath,
      createdAt: new Date().toISOString(),
      ...(sourceFingerprint ? { sourceFingerprint } : {}),
    };

    await mkdir(this.recoveryDir, { recursive: true });
    await writeFile(recoveryPath, snapshot, { mode: 0o600 });
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  private recoveryPath(sourcePath: string): string {
    return path.join(this.recoveryDir, `${this.key(sourcePath)}.kdbx`);
  }

  private metadataPath(sourcePath: string): string {
    return path.join(this.recoveryDir, `${this.key(sourcePath)}.json`);
  }

  private key(sourcePath: string): string {
    return createHash('sha256').update(path.resolve(sourcePath)).digest('hex');
  }
}
