import type { AppSettings } from '@passdeck/shared';
import { Modal } from './Modal';

type SettingsModalProps = {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
};

export function SettingsModal({ settings, onUpdate, onClose }: SettingsModalProps) {
  return (
    <Modal title="Настройки" onClose={onClose}>
      <div className="form">
        <label>
          <span>Тема</span>
          <select
            value={settings.theme}
            onChange={(event) =>
              onUpdate({ theme: event.target.value as AppSettings['theme'] })
            }
          >
            <option value="dark">Тёмная</option>
            <option value="light">Светлая</option>
            <option value="system">Системная</option>
          </select>
        </label>
        <label>
          <span>Автоблокировка, минут (0 — отключить)</span>
          <input
            type="number"
            min="0"
            max="1440"
            value={settings.autoLockMinutes}
            onChange={(event) => onUpdate({ autoLockMinutes: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Очистка пароля из буфера, секунд</span>
          <input
            type="number"
            min="0"
            max="3600"
            value={settings.clipboardPasswordSeconds}
            onChange={(event) =>
              onUpdate({ clipboardPasswordSeconds: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>Закрытие окна</span>
          <select
            value={settings.closeBehavior}
            onChange={(event) =>
              onUpdate({
                closeBehavior: event.target.value as AppSettings['closeBehavior'],
              })
            }
          >
            <option value="quit">Завершать приложение</option>
            <option value="tray">Сворачивать в трей</option>
          </select>
        </label>
        <section className="autotype-help">
          <div className="autotype-help-title">Auto-Type</div>
          <div className="autotype-help-sequence">
            Windows: Ctrl+Alt+A
            <br />
            macOS: ⌘ Command + ⌥ Option + A
          </div>
          <p className="autotype-help-note">
            Сначала выберите запись в PassDeck, затем перейдите в поле логина сайта или приложения
            и нажмите сочетание клавиш.
          </p>
        </section>
        <div className="security-note">
          <strong>Локальный режим</strong>
          <span>Сеть, телеметрия и журналирование отключены.</span>
        </div>
        <div className="form__actions">
          <button className="button button--primary" type="button" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}
