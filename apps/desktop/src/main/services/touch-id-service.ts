import { app, safeStorage, systemPreferences } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type TouchIdStatus = {
  available: boolean;
  enabled: boolean;
  reason?: string;
};

export class TouchIdService {
  async status(filePath?: string): Promise<TouchIdStatus> {
    const availability = this.availability();
    const enabled = filePath ? await this.hasStoredPassword(filePath) : false;
    return { ...availability, enabled };
  }

  async storePassword(filePath: string, password: string): Promise<void> {
    this.assertAvailable();
    await systemPreferences.promptTouchID('Включить разблокировку PassDeck через Touch ID');
    const encrypted = safeStorage.encryptString(password);
    await fs.mkdir(this.storageDir(), { recursive: true });
    await fs.writeFile(this.passwordFile(filePath), encrypted);
  }

  async getPassword(filePath: string): Promise<string> {
    this.assertAvailable();
    await systemPreferences.promptTouchID('Разблокировать PassDeck через Touch ID');
    const encrypted = await fs.readFile(this.passwordFile(filePath));
    return safeStorage.decryptString(encrypted);
  }

  async forget(filePath: string): Promise<void> {
    await fs.rm(this.passwordFile(filePath), { force: true });
  }

  private availability(): { available: boolean; reason?: string } {
    if (process.platform !== 'darwin') { return { available: false, reason: 'Touch ID доступен только на macOS.' }; }
    if (!safeStorage.isEncryptionAvailable()) { return { available: false, reason: 'safeStorage недоступен.' }; }
    if (!systemPreferences.canPromptTouchID()) { return { available: false, reason: 'Touch ID недоступен или не настроен в macOS.' }; }
    return { available: true };
  }

  private assertAvailable(): void {
    const availability = this.availability();
    if (!availability.available) { throw new Error(availability.reason || 'Touch ID недоступен.'); }
  }

  private async hasStoredPassword(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.passwordFile(filePath));
      return true;
    } catch {
      return false;
    }
  }

  private storageDir(): string {
    return path.join(app.getPath('userData'), 'touch-id');
  }

  private passwordFile(filePath: string): string {
    const key = createHash('sha256').update(path.resolve(filePath)).digest('hex');
    return path.join(this.storageDir(), key + '.bin');
  }
}
