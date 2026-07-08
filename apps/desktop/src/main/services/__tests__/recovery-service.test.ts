import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RecoveryService } from '../recovery-service';

const temporaryDirectories: string[] = [];

async function createRecoveryService(delayMs = 1) {
  const root = await mkdtemp(path.join(tmpdir(), 'passdeck-recovery-test-'));
  temporaryDirectories.push(root);
  const recoveryDir = path.join(root, 'recovery');
  return { root, recoveryDir, service: new RecoveryService(recoveryDir, delayMs) };
}

function waitForTimer(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('RecoveryService', () => {
  it('writes a single encrypted recovery snapshot and metadata', async () => {
    const { root, service } = await createRecoveryService();
    const sourcePath = path.join(root, 'Demo.kdbx');

    service.schedule(sourcePath, { mtimeMs: 100, size: 42 }, () =>
      Promise.resolve(Buffer.from('encrypted-kdbx')),
    );
    service.schedule(sourcePath, { mtimeMs: 200, size: 84 }, () =>
      Promise.resolve(Buffer.from('ignored')),
    );

    await waitForTimer();

    const recoveries = await service.list();
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]).toMatchObject({
      sourcePath,
      sourceFingerprint: { mtimeMs: 100, size: 42 },
    });
    await expect(readFile(recoveries[0]!.recoveryPath, 'utf8')).resolves.toBe('encrypted-kdbx');
  });

  it('clears pending and written recovery files', async () => {
    const { root, service } = await createRecoveryService();
    const sourcePath = path.join(root, 'Demo.kdbx');

    service.schedule(sourcePath, undefined, () => Promise.resolve(Buffer.from('encrypted-kdbx')));
    await waitForTimer();
    expect(await service.list()).toHaveLength(1);

    await service.clear(sourcePath);

    expect(await service.list()).toHaveLength(0);
  });
});
