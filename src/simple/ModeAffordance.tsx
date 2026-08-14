import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth';
import { useBlockingStore } from '@/store/blocking';
import { SIMPLE_NS } from './i18n';
import { useModeStore, useUiMode } from './mode';

/**
 * Возврат из экспертного режима в простой.
 *
 * ⚠️ Почему плавающий элемент, а не пункт в профиле, как хотелось владельцу:
 * страница профиля — апстримная (`src/pages/Profile.tsx`), а править апстримные
 * страницы нам нельзя, иначе возвращается ровно та болезнь, от которой уходим.
 * Поэтому вход рендерится глобально из `App.tsx` — единственного апстримного
 * файла, которым мы владеем осознанно.
 *
 * В простом режиме элемент не рисуется: там пункт «Все возможности» живёт в
 * бургер-меню `SimpleShell`.
 *
 * Живёт над `<Routes>`, поэтому сам следит за тем, где ему не место: на экранах
 * входа и регистрации (пользователь не авторизован) и поверх блокирующих экранов
 * обслуживания или блокировки. Иначе кнопка смены вида появлялась бы там, где
 * никакого вида ещё нет.
 *
 * По высоте поднят над мобильным нижним меню апстрима (оно `z-50`, прижато к
 * низу) — иначе кнопка прячется под ним.
 *
 * ⚠️ 120px — не подобранное на глаз число (прежние 88px давали перекрытие в 4px,
 * #36). Апстрим сам резервирует место под нижнее меню: `main` в `AppShell`
 * получает `pb-28`, то есть 112px. Берём этот же резерв плюс 8px зазора. Если
 * апстрим изменит высоту панели, он изменит и `pb-28` — считать надо от него.
 */
export function ModeAffordance() {
  const mode = useUiMode();
  const setMode = useModeStore((state) => state.setMode);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const blockingType = useBlockingStore((state) => state.blockingType);
  const { t } = useTranslation(SIMPLE_NS);

  if (mode !== 'expert' || !isAuthenticated || blockingType) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => setMode('simple')}
      className="fixed bottom-[calc(120px+env(safe-area-inset-bottom,0px))] left-4 z-[60] rounded-full border border-dark-700/40 bg-dark-900/80 px-3 py-1.5 text-xs text-dark-200 backdrop-blur transition-colors hover:text-white lg:bottom-4"
    >
      {t('mode.toSimple')}
    </button>
  );
}
