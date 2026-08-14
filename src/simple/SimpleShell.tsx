import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import CampaignBonusNotifier from '@/components/CampaignBonusNotifier';
import { PromptDialogHost } from '@/components/PromptDialogHost';
import SuccessNotificationModal from '@/components/SuccessNotificationModal';
import WebSocketNotifications from '@/components/WebSocketNotifications';
import { useBackgroundConsumer } from '@/components/backgrounds/BackgroundHost';
import { useTelegramSDK } from '@/hooks/useTelegramSDK';
import { NAV_BOTTOM_OFFSET, NAV_HEIGHT, SimpleBottomNav } from './components/SimpleBottomNav';
import { SimpleMenu } from './components/SimpleMenu';
import { MenuIcon } from './components/icons';
import { SIMPLE_NS } from './i18n';

/**
 * Оболочка простого режима: свой каркас навигации вместо апстримного `Layout`.
 *
 * ⚠️ Апстримный `src/components/layout/AppShell/**` НЕ трогаем — он остаётся
 * экспертному режиму. Здесь своя навигация: нижнее меню на четыре пункта и
 * бургер с профилем, информацией, выходом из аккаунта и переходом в экспертный
 * режим.
 *
 * Шапка намеренно почти пустая. У апстримной есть уведомления, переключатель
 * языка, поиск, тема и лого — всё это и есть та перегруженность, от которой
 * уходим.
 *
 * ⚠️ Но `AppShell` даёт странице не только навигацию, и это приходится
 * повторять, иначе простой режим тихо лишается работающих механизмов:
 *
 *   - четыре инфраструктурных хоста (без `PromptDialogHost` общие хуки диалогов
 *     молча ничего не показывают, без остальных пропадают уведомления и модалка
 *     успешной оплаты);
 *   - `useBackgroundConsumer()` — `BackgroundHost` рисует фон, только пока есть
 *     хоть один потребитель, и регистрирует его единственный вызов из `AppShell`;
 *   - скрытие нижнего меню при открытой клавиатуре — «Поддержка» с текстовым
 *     полем живёт в этом же меню.
 *
 * Всё, что берётся из апстримных компонентов помимо примитивов, перечислено
 * поимённо в `scripts/check-mode-boundaries.mjs`.
 */
export function SimpleShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const { t } = useTranslation(SIMPLE_NS);
  const location = useLocation();
  const { isFullscreen, safeAreaInset, contentSafeAreaInset, platform } = useTelegramSDK();

  // В полноэкранном режиме Telegram рисует поверх контента свои кнопки (закрыть
  // и меню) — в правом верхнем углу, ровно там, где стоит бургер. `env()` их не
  // отдаёт, он знает только про чёлку устройства, поэтому берём инсеты из SDK и
  // добавляем высоту телеграмных контролов. Приём и числа — из AppHeader.
  const safeTop = Math.max(safeAreaInset.top, contentSafeAreaInset.top);
  const headerPaddingTop = isFullscreen
    ? `${safeTop + (platform === 'android' ? 48 : 45)}px`
    : 'calc(16px + env(safe-area-inset-top, 0px))';

  // Регистрируем потребителя фона — иначе BackgroundHost ничего не рисует.
  useBackgroundConsumer();

  // Сброс на смене маршрута: иначе меню останется спрятанным после навигации.
  useEffect(() => {
    setKeyboardOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const isTextEntry = (node: HTMLElement | null) =>
      !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);

    const onFocusIn = (event: FocusEvent) => {
      if (isTextEntry(event.target as HTMLElement)) {
        setKeyboardOpen(true);
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!isTextEntry(event.relatedTarget as HTMLElement | null)) {
        setKeyboardOpen(false);
      }
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return (
    // min-h-viewport, а не min-h-screen: утилита заведена в globals.css ради
    // 100dvh и телеграмного --tg-viewport-stable-height. 100vh на мобильном
    // врёт из-за адресной строки, а в Mini App расходится с реальным вьюпортом.
    <div className="min-h-viewport">
      <header
        className="flex items-center justify-end px-4"
        style={{ paddingTop: headerPaddingTop }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={t('nav.openMenu')}
          className="rounded-full border border-dark-700/40 bg-dark-900/60 p-2.5 text-dark-200 backdrop-blur transition-colors hover:text-white"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </header>

      {/*
        Отступ снизу — от той же геометрии, что и сама панель, плюс зазор.
        Числа берутся из SimpleBottomNav, поэтому панель и отступ правятся
        вместе, а не расходятся молча.
      */}
      <main
        className="mx-auto max-w-3xl px-4 py-6"
        style={{
          paddingBottom: `calc(${NAV_BOTTOM_OFFSET + NAV_HEIGHT + 16}px + env(safe-area-inset-bottom, 0px))`,
        }}
      >
        {children}
      </main>

      <SimpleBottomNav hidden={keyboardOpen} />
      <SimpleMenu open={menuOpen} onOpenChange={setMenuOpen} />

      {/* Инфраструктура, которую в экспертном режиме монтирует AppShell. */}
      <WebSocketNotifications />
      <CampaignBonusNotifier />
      <SuccessNotificationModal />
      <PromptDialogHost />
    </div>
  );
}
