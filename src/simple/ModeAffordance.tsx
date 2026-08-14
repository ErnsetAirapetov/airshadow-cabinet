import { useTranslation } from 'react-i18next';
import { SIMPLE_NS } from './i18n';
import { useModeStore, useUiMode } from './mode';

/**
 * Возврат из экспертного режима в простой.
 *
 * ⚠️ Почему это плавающий элемент, а не пункт в профиле, как хотелось владельцу:
 * страница профиля — апстримная (`src/pages/Profile.tsx`), а править апстримные
 * страницы нам нельзя, иначе возвращается ровно та болезнь, от которой мы
 * уходим. Поэтому вход в переключатель рендерится глобально из `App.tsx` —
 * единственного апстримного файла, которым мы владеем осознанно.
 *
 * В простом режиме элемент не рисуется: там пункт «Все возможности» живёт в
 * бургер-меню `SimpleShell`.
 *
 * Вид намеренно скромный и будет доведён отдельной задачей (#26).
 */
export function ModeAffordance() {
  const mode = useUiMode();
  const setMode = useModeStore((state) => state.setMode);
  const { t } = useTranslation(SIMPLE_NS);

  if (mode !== 'expert') {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => setMode('simple')}
      className="fixed bottom-4 left-4 z-40 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white/80 backdrop-blur transition-colors hover:text-white"
    >
      {t('mode.toSimple')}
    </button>
  );
}
