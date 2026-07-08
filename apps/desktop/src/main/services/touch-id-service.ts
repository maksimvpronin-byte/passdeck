import { PassDeckError } from './errors';
import { ElectronTouchIdSecretStore, type TouchIdSecretStore } from './touch-id-secret-store';

export type TouchIdStatus = {
  available: boolean;
  enabled: boolean;
  reason?: string;
};

function isTouchIdCancel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|отмен|canceled|cancelled/i.test(message);
}

function isMissingSecret(error: unknown): boolean {
  const nodeError = error as NodeJS.ErrnoException;
  return nodeError.code === 'ENOENT';
}

export class TouchIdService {
  constructor(private readonly store: TouchIdSecretStore = new ElectronTouchIdSecretStore()) {}

  async status(filePath?: string): Promise<TouchIdStatus> {
    const availability = this.store.availability();
    const enabled =
      filePath && availability.available ? await this.store.hasStoredPassword(filePath) : false;
    return { ...availability, enabled };
  }

  async storePassword(filePath: string, password: string): Promise<void> {
    this.assertAvailable();
    try {
      await this.store.storePassword(filePath, password);
    } catch (error) {
      throw this.toTouchIdError(error);
    }
  }

  async getPassword(filePath: string): Promise<string> {
    this.assertAvailable();
    try {
      return await this.store.getPassword(filePath);
    } catch (error) {
      throw this.toTouchIdError(error);
    }
  }

  async forget(filePath: string): Promise<void> {
    await this.store.forget(filePath);
  }

  private assertAvailable(): void {
    const availability = this.store.availability();
    if (!availability.available) {
      throw new PassDeckError(
        'TOUCH_ID_UNAVAILABLE',
        `${availability.reason || 'Touch ID недоступен.'} Введите мастер-пароль.`,
      );
    }
  }

  private toTouchIdError(error: unknown): PassDeckError {
    if (error instanceof PassDeckError) {
      return error;
    }
    if (isTouchIdCancel(error)) {
      return new PassDeckError('TOUCH_ID_CANCELLED', 'Touch ID отменён. Введите мастер-пароль.');
    }
    if (isMissingSecret(error)) {
      return new PassDeckError(
        'TOUCH_ID_SECRET_MISSING',
        'Пароль для Touch ID не найден. Введите мастер-пароль.',
      );
    }
    return new PassDeckError(
      'TOUCH_ID_FAILED',
      'Не удалось выполнить Touch ID. Введите мастер-пароль.',
    );
  }
}
