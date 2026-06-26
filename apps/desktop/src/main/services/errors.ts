import type { ApiResult } from '@passdeck/shared';
import { KdbxError } from 'kdbxweb';

export class PassDeckError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'PassDeckError';
  }
}

export function toApiError<T>(error: unknown): ApiResult<T> {
  if (error instanceof PassDeckError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  if (error instanceof KdbxError) {
    const code =
      error.code === 'InvalidKey' ? 'INVALID_PASSWORD' : `KDBX_${error.code.toUpperCase()}`;
    const message =
      error.code === 'InvalidKey'
        ? 'Неверный мастер-пароль или неподдерживаемый способ разблокировки.'
        : 'Не удалось открыть или обработать базу KDBX.';
    return {
      ok: false,
      error: {
        code,
        message,
        details: error.message,
      },
    };
  }

  const details = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      message: 'Произошла непредвиденная ошибка.',
      details,
    },
  };
}
