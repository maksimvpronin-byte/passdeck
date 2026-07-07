#!/usr/bin/env node

const { performance } = require('node:perf_hooks');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { argon2d, argon2id } = require('hash-wasm');
const { CryptoEngine, Kdbx, KdbxCredentials, ProtectedValue } = require('kdbxweb');

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function configureArgon2() {
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
      const result =
        type === CryptoEngine.Argon2TypeArgon2id ? await argon2id(options) : await argon2d(options);
      return toArrayBuffer(result);
    },
  );
}

async function timed(label, action) {
  const started = performance.now();
  const result = await action();
  const elapsed = performance.now() - started;
  console.log(`${label}: ${elapsed.toFixed(1)} ms`);
  return result;
}

async function main() {
  configureArgon2();

  const filePath = path.resolve(process.argv[2] || 'test-data/PassDeck-Demo.kdbx');
  const password = process.argv[3] || 'PassDeck-Demo-2026!';
  const raw = await timed('read', () => readFile(filePath));
  const credentials = new KdbxCredentials(ProtectedValue.fromString(password));
  await timed('credentials.ready', () => credentials.ready);
  const db = await timed('kdbx.load', () =>
    Kdbx.load(toArrayBuffer(raw), credentials, { preserveXml: true }),
  );
  const saved = await timed('kdbx.save', () => db.save());
  console.log(`input bytes: ${raw.byteLength}`);
  console.log(`saved bytes: ${saved.byteLength}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
