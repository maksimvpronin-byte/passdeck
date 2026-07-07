import { readFile } from 'node:fs/promises';
import { Consts, Kdbx, KdbxCredentials, ProtectedValue } from 'kdbxweb';
import { configureArgon2 } from './argon2';

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

export class KdbxOperations {
  constructor() {
    configureArgon2();
  }

  async load(filePath: string, password: string): Promise<Kdbx> {
    const raw = await readFile(filePath);
    const credentials = new KdbxCredentials(ProtectedValue.fromString(password));
    await credentials.ready;
    return Kdbx.load(bufferToArrayBuffer(raw), credentials, { preserveXml: true });
  }

  async create(name: string, password: string): Promise<Kdbx> {
    const credentials = new KdbxCredentials(ProtectedValue.fromString(password));
    await credentials.ready;
    const db = Kdbx.create(credentials, name || 'PassDeck');
    db.setVersion(4);
    db.header.versionMinor = 1;
    db.setKdf(Consts.KdfId.Argon2id);
    db.meta.generator = 'PassDeck 0.2.0';
    db.meta.historyMaxItems = 10;
    db.createRecycleBin();
    return db;
  }

  async save(db: Kdbx): Promise<Buffer> {
    return Buffer.from(await db.save());
  }
}
