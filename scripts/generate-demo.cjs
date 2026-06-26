const fs = require('node:fs/promises');
const path = require('node:path');
const { argon2d, argon2id } = require('hash-wasm');
const { Consts, CryptoEngine, Kdbx, KdbxCredentials, ProtectedValue } = require('kdbxweb');

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

CryptoEngine.setArgon2Impl(
  async (password, salt, memory, iterations, length, parallelism, type) => {
    const options = {
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      iterations,
      parallelism,
      memorySize: memory,
      hashLength: length,
      outputType: 'binary',
    };
    return toArrayBuffer(
      type === CryptoEngine.Argon2TypeArgon2id ? await argon2id(options) : await argon2d(options),
    );
  },
);

async function main() {
  const password = 'PassDeck-Demo-2026!';
  const credentials = new KdbxCredentials(ProtectedValue.fromString(password));
  await credentials.ready;
  const db = Kdbx.create(credentials, 'PassDeck Demo');
  db.setVersion(4);
  db.header.versionMinor = 1;
  db.setKdf(Consts.KdfId.Argon2id);
  db.meta.generator = 'PassDeck demo generator';
  db.meta.historyMaxItems = 10;
  db.createRecycleBin();

  const root = db.getDefaultGroup();
  root.name = 'PassDeck Demo';
  const work = db.createGroup(root, 'Работа');
  const personal = db.createGroup(root, 'Личное');
  const servers = db.createGroup(work, 'Серверы');

  const addEntry = (group, title, username, secret, url, notes, tags, custom = {}) => {
    const entry = db.createEntry(group);
    entry.fields.set('Title', ProtectedValue.fromString(title));
    entry.fields.set('UserName', ProtectedValue.fromString(username));
    entry.fields.set('Password', ProtectedValue.fromString(secret));
    entry.fields.set('URL', ProtectedValue.fromString(url));
    entry.fields.set('Notes', ProtectedValue.fromString(notes));
    entry.tags = tags;
    for (const [key, value] of Object.entries(custom)) {
      entry.fields.set(key, value);
    }
    entry.times.update();
    return entry;
  };

  addEntry(
    work,
    'Git repository',
    'demo.devops',
    'Demo-Git-Password-2026!',
    'https://git.example.test',
    'Тестовая запись. Реальных данных нет.',
    ['demo', 'git'],
    { Environment: 'Test' },
  );
  addEntry(
    servers,
    'Linux server',
    'demo-admin',
    'Demo-SSH-Password-2026!',
    'ssh://server.example.test',
    'Auto-Type: {USERNAME}{TAB}{PASSWORD}{ENTER}',
    ['demo', 'server'],
    { Host: 'server.example.test' },
  );
  const mail = addEntry(
    personal,
    'Personal mail',
    'demo@example.test',
    'Demo-Mail-Password-2026!',
    'https://mail.example.test',
    'Синтетическая запись для проверки интерфейса.',
    ['demo', 'mail'],
  );
  const attachment = await db.createBinary(
    toArrayBuffer(Buffer.from('PassDeck demo attachment\n', 'utf8')),
  );
  mail.binaries.set('demo.txt', attachment);

  const out = path.resolve(__dirname, '..', 'test-data', 'PassDeck-Demo.kdbx');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, Buffer.from(await db.save()));
  console.log(out);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
