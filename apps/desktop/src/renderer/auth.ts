/**
 * Модуль авторизации по биометрии (Touch ID / Face ID).
 * 
 * Интегрирован с macOS Keychain для безопасного хранения секретов.
 */

import type { BrowserWindow } from 'electron';
import type { BioTokenForIPC, BioInitResponse } from '../main/services/bio-auth-service';

const FALLBACK_CODE = 'BIO_FALLBACK_REQUIRED';

/**
 * Обработка результата биометрической авторизации.
 */
async function handleBioAuthResult(result: string): Promise<string | null> {
  const [code, details] = result.split('|') ?? ['UNKNOWN', ''];
  
  if (code === 'OK') {
    console.log('[Auth] Bio unlock successful:', details);
    return 'SUCCESS';
  } else if (code === 'ERROR') {
    console.warn('[Auth] Bio unlock error:', details);
    
    // При любой ошибке биометрии — fallback в мастер-пароль
    return FALLBACK_CODE;
  }
  
  console.error('[Auth] Unknown bio auth result:', code, details);
  return FALLBACK_CODE;
}

/**
 * Запрос токена разблокировки в main-процесс.
 * Токен создаётся в main process и передаётся через IPC.
 */
async function requestBioToken(): Promise<BioInitResponse | null> {
  try {
    const mainWindow = window as unknown as { passdeck?: { auth: { bioInit: typeof window.passdeck.auth.bioInit } } };
    
    if (!mainWindow?.passdeck?.auth) {
      console.error('[Auth] Bio auth API not available in preload context');
      return null;
    }
    
    const response = await mainWindow.passdeck.auth.bioInit();
    
    if (!response.ok) {
      console.error('[Auth] Bio init failed:', response.error, response.details);
      return null;
    }
    
    return response;
  } catch (error) {
    console.error('[Auth] Bio init error:', error);
    return null;
  }
}

/**
 * Кнопка разблокировки по Touch ID.
 */
export const BioUnlockButton: React.FC<{ onUnlockAttempt?: () => void }> = ({ onUnlockAttempt }) => {
  const handleClick = async () => {
    try {
      console.log('[Auth] User attempted biometric unlock');
      
      // Шаг 1: Запрашиваем токен у main-процесса
      const bioInitResponse = await requestBioToken();
      
      if (!bioInitResponse) {
        console.warn('[Auth] Failed to get bio token from main process');
        return FALLBACK_CODE;
      }

      // Шаг 2: Отправляем токен в main-процесс для разблокировки
      const unlockResponse = await window.passdeck.auth.bioUnlock(bioInitResponse.data);
      
      if (unlockResponse === 'OK') {
        console.log('[Auth] Bio unlock successful');
        onUnlockAttempt?.();
        return 'SUCCESS';
      } else {
        // Ошибка биометрии — возвращаем код для fallback в мастер-пароль
        console.warn('[Auth] Bio unlock failed, returning to password mode:', unlockResponse);
        return FALLBACK_CODE;
      }
    } catch (error: any) {
      console.error('[Auth] Bio unlock exception:', error?.message || error);
      return FALLBACK_CODE;
    }
  };

  const [isUnlocking, setIsUnlocking] = React.useState(false);
  
  return (
    <div className="biometric-auth-container">
      <button
        type="button"
        className="biometric-unlock-btn"
        onClick={() => {
          if (!isUnlocking) setIsUnlocking(true);
        }}
        disabled={isUnlocking}
        aria-label="Разблокировать по Touch ID или Face ID"
      >
        {isUnlocking ? (
          <>
            <svg viewBox="0 0 24 24" width="20" height="20" className="loading-spinner">
              <circle
                cx="12"
                cy="12"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              />
            </svg>
            Разблокировка...
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" width="24" height="24" className="fingerprint-icon">
              <path
                fill="currentColor"
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 4h2v2h-2z"
              />
            </svg>
            Разблокировать по Touch ID
          </>
        )}
      </button>

      <p className="biometric-desc">
        Используйте отпечаток пальца или Face ID для безопасного открытия базы
      </p>

      {process.platform === 'darwin' && (
        <>
          <div className="biometric-setup-hint">
            Для настройки биометрии откройте «Настройки PassDeck» → Раздел «Безопасность»
          </div>
          
          <div className="biometric-notice">
            После настройки Touch ID / Face ID автоматически разблокирует PassDeck при входе.
          </div>
        </>
      )}
    </div>
  );
};
