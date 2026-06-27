/**
 * Дефолтные типы для IPC коммуникации между main и preload процессами.
 * 
 * Эти типы используются только в контексте IPC — не экспортируются в глобальный API рендерера.
 */

import type { BiometricAuthContext, BioTokenForIPC, AuthResult } from '../main/services/bio-auth-service';

// Экспортируем только сериализуемые поля для IPC
export type PassDeckApi = Omit<
  typeof globalThis.passdeck,
  'auth' | 'bioInit' | 'bioUnlock' // auth:bio-init и auth:bio-unlock передаются напрямую через window.passdeck.auth
>;

// Тип ответа от биометрической инициализации
export interface BioInitResponse {
  ok: boolean;
  data?: BioTokenForIPC;
  error?: string;
  details?: string;
}

// Результат разблокировки по биометрии
export type BioUnlockResponse = AuthResult;
