import { argon2d, argon2id } from 'hash-wasm';
import { CryptoEngine } from 'kdbxweb';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

let configured = false;

export function configureArgon2(): void {
  if (configured) {
    return;
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
        outputType: 'binary' as const,
      };

      const result =
        type === CryptoEngine.Argon2TypeArgon2id ? await argon2id(options) : await argon2d(options);

      return toArrayBuffer(result);
    },
  );

  configured = true;
}
