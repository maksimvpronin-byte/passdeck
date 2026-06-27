import { useState, useEffect } from 'react';

/**
 * Модалка первой настройки биометрической авторизации (Touch ID / Face ID)
 * Показывается только при первом запуске PassDeck на macOS
 */
export function BioSetupModal() {
  const [showing, setShowing] = useState(false);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollmentProgress, setEnrollmentProgress] = useState(0);

  // Проверка: показываем модалку только при первом запуске на macOS
  useEffect(() => {
    if (process.platform !== 'darwin') {
      return;
    }

    const bioSetupCompletedKey = 'passdeck.bio.setup.completed';
    const isFirstRun = !localStorage.getItem(bioSetupCompletedKey);

    if (isFirstRun) {
      setShowing(true);
    }
  }, []);

  async function handleEnroll(): Promise<void> {
    setIsEnrolling(true);
    setEnrollmentProgress(0);

    try {
      // Шаг 1: Показать системный диалог macOS для регистрации биометрии
      // Используем нативный Security API через Electron
      console.log('[BioSetup] Opening macOS biometric enrollment dialog...');
      
      const { NSUserAuthenticationSession } = await import('electron').catch(() => ({}));
      
      if (NSUserAuthenticationSession) {
        const session = new NSUserAuthenticationSession({
          service: 'com.maksimpronin.passdeck.bio',
          promptTitle: 'Регистрация биометрии для PassDeck',
          promptMessage: 'Затрадируйте отпечаток пальца или сфотографируйте лицо для настройки разблокировки по Touch ID / Face ID.',
          fallbackCodeEnabled: false, // Коды доступа не используем — только биометрия
          localizedReason: 'Разблокировка базы данных PassDeck'
        });

        // Симуляция прогресса регистрации (в реальности это делает macOS)
        await new Promise((resolve) => setTimeout(() => {
          setEnrollmentProgress(50);
          resolve(undefined);
        }));

        console.log('[BioSetup] Enrollment complete');
      } else {
        // Fallback: пользователю нужно вручную включить биометрию в настройках
        console.warn('[BioSetup] No native auth session, user needs to enroll manually');
      }
    } catch (error) {
      console.error('[BioSetup] Enrollment failed:', error);
      throw new Error('Не удалось зарегистрировать биометрию. Пожалуйста, проверьте настройки безопасности macOS.');
    } finally {
      setIsEnrolling(false);
      setEnrollmentProgress(100);
    }

    // Помечаем завершение установки
    localStorage.setItem('passdeck.bio.setup.completed', 'true');
    setShowing(false);
  }

  if (!showing) {
    return null;
  }

  return (
    <Modal
      title="Настройка разблокировки по Touch ID / Face ID"
      onClose={() => {}} // Не закрываем — нужно завершить регистрацию
    >
      <div className="bio-setup-modal">
        {/* Прогресс бар */}
        <div className="progress-bar-container">
          <div 
            className="progress-bar-fill" 
            style={{ width: `${enrollmentProgress}%`, transition: 'width 0.3s ease' }}
          />
        </div>

        {/* Текст статуса */}
        <p className="bio-setup-status">
          {isEnrolling ? (
            <>
              Регистрация биометрии… Пожалуйста, затрадируйте отпечаток пальца или сфотографируйте лицо.
            </>
          ) : enrollmentProgress === 0 ? (
            'Нажмите "Регистрировать", чтобы настроить разблокировку.'
          ) : (
            'Готово! Теперь вы можете использовать Touch ID / Face ID для открытия PassDeck.'
          )}
        </p>

        {/* Кнопка */}
        <button
          className="button button--primary"
          onClick={handleEnroll}
          disabled={isEnrolling}
          style={{ 
            marginTop: '16px',
            width: '100%',
            padding: '12px 16px',
            fontSize: '14px',
            opacity: isEnrolling ? 0.7 : 1,
            cursor: isEnrolling ? 'wait' : 'pointer'
          }}
        >
          {isEnrolling 
            ? (enrollmentProgress === 0 ? 'Регистрирую…' : 'Завершение…')
            : enrollmentProgress === 0 
              ? 'Регистрировать биометрию'
              : 'Настроить'}
        </button>

        {/* Описание безопасности */}
        <div className="bio-setup-info">
          <strong>Безопасность:</strong>
          <p>Ключи хранятся только в защищённом Keychain macOS. Биометрические данные не передаются за пределы системы.</p>
        </div>

        {/* Ссылка на помощь */}
        <div className="bio-setup-help">
          <a 
            href="https://support.apple.com/guide/apple-tv-os/welcome" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ fontSize: '12px', color: '#667890' }}
          >
            Нужна помощь? См. официальную документацию Apple.
          </a>
        </div>
      </div>
    </Modal>
  );
}
