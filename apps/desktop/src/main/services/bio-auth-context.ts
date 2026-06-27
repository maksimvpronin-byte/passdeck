import type { SettingsStore } from './settings-store';
import type { BioAuthService } from './bio-auth-service';

/**
 * Контекст для биометрической авторизации.
 * Используется в IPC-регистраторе для доступа к сервисам без прямой зависимости.
 */
export interface BiometricAuthContext {
  settings: SettingsStore;
  bioService: BioAuthService;
}
