import type { BiometricAuthContext } from './bio-auth-context';

/**
 * Токен для IPC-передачи от renderer к main процессу.
 * Хранит только зашифрованный ciphertext и iv, tag — не содержит чувствительных данных.
 */
export interface BioTokenForIPC {
  sessionId: string;
  ciphertext: string; // Hex-encoded encrypted token
  iv: string;         // Hex-encoded IV
  tag: string;        // Hex-encoded auth tag
}

/**
 * Результат биометрической разблокировки, передаваемый от main к renderer.
 */
export interface BioAuthResult {
  success: boolean;
  error?: 'BIO_AUTH_FALLBACK_REQUIRED' | 'BIO_KEYCHAIN_ERROR' | 'BIO_TIMEOUT' | 'BIO_INVALID_TOKEN';
  details?: string;
}
