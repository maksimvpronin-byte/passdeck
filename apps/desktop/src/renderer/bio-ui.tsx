import { ipcRenderer } from 'electron';
import type { BrowserWindow } from 'electron';

export interface BioUnlockProps {
  onUnlockAttempt: () => void;
  onFallback: () => void;
}

/**
 * Компонент разблокировки по биометрии (Touch ID / Face ID).
 */
export const BioUnlockComponent: React.FC<BioUnlockProps> = ({ onUnlockAttempt, onFallback }) => {
  return (
    <div className="biometric-auth-section">
      <button
        type="button"
        className="biometric-unlock-btn"
        onClick={onUnlockAttempt}
        aria-label="Разблокировать по Touch ID или Face ID"
      >
        {/* Иконка отпечатка пальца */}
        <svg viewBox="0 0 24 24" width="28" height="28" className="fingerprint-icon">
          <path fill="currentColor" d="M17.82 6.05c-.24-.11-.52-.09-.71.05l-2.67 1.44c-.26.14-.33.47-.15.69l1.82 2.69c.15.22.11.52-.09.69L12 12.2c-.19 0-.38-.12-.46-.29l-2.28-4.5c-.07-.15-.24-.24-.42-.22l-4.29.76c-.33.06-.54.41-.38.71l1.2 2.37c.13.25.33.45.57.57L6.46 13.5c.26.14.36.48.21.74l-1.46 2.65c-.11.19-.09.45.04.61.06.08.14.15.24.18l2.58.95c.26.1.43.37.42.65v2.99c0 .26-.21.48-.47.48h-3.91c-.26 0-.48-.21-.48-.47v-2.99c0-.26-.21-.48-.47-.48-.26 0-.48.21-.48.47v5.91c0 .26.21.48.47.48H6.5c.26 0 .48-.21.48-.47V14.2c0-.26-.21-.48-.47-.48l-2.37 1.2c-.23.12-.49.12-.72 0l-1.2-2.37c-.16-.31-.05-.7.28-.74l4.28-.76c.18-.03.37.05.44.22l2.28 4.5c.08.17.27.29.46.29h3.54c.26 0 .48-.21.48-.47v-2.99c0-.26-.21-.48-.47-.48l-1.83-2.69c-.18-.22-.11-.55.15-.69l2.67-1.44c.29-.16.44-.52.34-.82L17.06 7.6c-.07-.11-.15-.23-.24-.32z"/>
        </svg>
        Разблокировать по Touch ID / Face ID
      </button>

      <p className="biometric-desc">
        Используйте отпечаток пальца или Face ID для безопасного открытия базы PassDeck.
      </p>

      {process.platform === 'darwin' && (
        <div className="biometric-notice">
          После настройки биометрия будет автоматически разблокировать базу при входе.
        </div>
      )}
    </div>
  );
};

/**
 * Компонент настройки биометрии (первый запуск).
 */
export const BioSetupSection: React.FC<{ onConfigure: () => void }> = ({ onConfigure }) => {
  return (
    <div className="biometric-setup-section">
      <h3>Настройка биометрической авторизации</h3>
      <p className="setup-description">
        PassDeck будет использовать Touch ID / Face ID вашего Mac для автоматического разблокирования.
        Ваши данные защищены — ключи хранятся только в защищённом хранилище системы (Keychain).
      </p>
      <button
        type="button"
        className="bio-setup-btn"
        onClick={onConfigure}
      >
        Настроить биометрию
      </button>
    </div>
  );
};

/**
 * Компонент статуса разблокировки.
 */
export const BioStatus: React.FC<{ status: 'locked' | 'unlocking' | 'unlocked' }> = ({ status }) => {
  if (status === 'locked') {
    return null; // Кнопка будет отображена
  }

  if (status === 'unlocking') {
    return (
      <div className="biometric-unlock-loading">
        <svg viewBox="0 0 24 24" width="32" height="32" className="loading-icon">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none">
            {() => null} {/* Вставка анимации через CSS */}
          </circle>
        </svg>
        <p>Разблокировка...</p>
      </div>
    );
  }

  if (status === 'unlocked') {
    return (
      <div className="biometric-unlocked">
        <svg viewBox="0 0 24 24" width="32" height="32" className="success-icon">
          <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        <p>База успешно разблокирована</p>
      </div>
    );
  }

  return null;
};

export interface BiometricUnlockError {
  code: string;
  message: string;
}

const ErrorMessages: Record<string, string> = {
  'BIO_FALLBACK_REQUIRED': 'Биометрия не распознала ваш отпечаток. Пожалуйста, введите мастер-пароль.',
  'BIO_TIMEOUT': 'Операция слишком долго длится. Пожалуйста, попробуйте ещё раз.',
  'BIO_INVALID_TOKEN': 'Ошибка токена биометрии. Пожалуйста, используйте мастер-пароль.',
  'BIO_KEYCHAIN_ERROR': 'Ошибка доступа к защищённому хранилищу. Используйте мастер-пароль.',
  'BIO_NO_DEVICE': 'Биометрическое устройство не обнаружено.',
};

export const BiometricError: React.FC<{ error: BioUnlockError }> = ({ error }) => {
  const message = ErrorMessages[error.code] || 'Произошла ошибка. Используйте мастер-пароль.';

  return (
    <div className="biometric-error">
      <svg viewBox="0 0 24 24" width="32" height="32" className="error-icon">
        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <p>{message}</p>
    </div>
  );
};

export const BiometricAuthUI: React.FC<{
  onUnlockAttempt: () => void;
  onFallback: () => void;
}> = ({ onUnlockAttempt, onFallback }) => {
  return (
    <div className="biometric-auth-container">
      <BioUnlockComponent onUnlockAttempt={onUnlockAttempt} onFallback={onFallback} />
    </div>
  );
};
