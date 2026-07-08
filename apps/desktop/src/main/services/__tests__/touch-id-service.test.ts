import { describe, expect, it } from 'vitest';
import { TouchIdService } from '../touch-id-service';
import type { TouchIdAvailability, TouchIdSecretStore } from '../touch-id-secret-store';

class FakeTouchIdStore implements TouchIdSecretStore {
  availabilityValue: TouchIdAvailability = { available: true };
  hasStoredPasswordValue = false;
  storedPassword = 'secret';
  getPasswordError: Error | undefined;
  storePasswordError: Error | undefined;

  availability(): TouchIdAvailability {
    return this.availabilityValue;
  }

  async hasStoredPassword(): Promise<boolean> {
    await Promise.resolve();
    return this.hasStoredPasswordValue;
  }

  async storePassword(): Promise<void> {
    await Promise.resolve();
    if (this.storePasswordError) {
      throw this.storePasswordError;
    }
  }

  async getPassword(): Promise<string> {
    await Promise.resolve();
    if (this.getPasswordError) {
      throw this.getPasswordError;
    }
    return this.storedPassword;
  }

  async forget(): Promise<void> {}
}

describe('TouchIdService', () => {
  it('reports availability and stored password status', async () => {
    const store = new FakeTouchIdStore();
    store.hasStoredPasswordValue = true;
    const service = new TouchIdService(store);

    await expect(service.status('/tmp/demo.kdbx')).resolves.toEqual({
      available: true,
      enabled: true,
    });
  });

  it('falls back to master password when Touch ID is unavailable', async () => {
    const store = new FakeTouchIdStore();
    store.availabilityValue = { available: false, reason: 'Touch ID недоступен.' };
    const service = new TouchIdService(store);

    await expect(service.getPassword('/tmp/demo.kdbx')).rejects.toMatchObject({
      code: 'TOUCH_ID_UNAVAILABLE',
      message: 'Touch ID недоступен. Введите мастер-пароль.',
    });
  });

  it('normalizes cancelled prompts', async () => {
    const store = new FakeTouchIdStore();
    store.getPasswordError = new Error('User canceled');
    const service = new TouchIdService(store);

    await expect(service.getPassword('/tmp/demo.kdbx')).rejects.toMatchObject({
      code: 'TOUCH_ID_CANCELLED',
      message: 'Touch ID отменён. Введите мастер-пароль.',
    });
  });

  it('normalizes missing stored secrets', async () => {
    const store = new FakeTouchIdStore();
    store.getPasswordError = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const service = new TouchIdService(store);

    await expect(service.getPassword('/tmp/demo.kdbx')).rejects.toMatchObject({
      code: 'TOUCH_ID_SECRET_MISSING',
      message: 'Пароль для Touch ID не найден. Введите мастер-пароль.',
    });
  });
});
