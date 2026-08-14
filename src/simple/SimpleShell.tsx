import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import CampaignBonusNotifier from '@/components/CampaignBonusNotifier';
import { PromptDialogHost } from '@/components/PromptDialogHost';
import SuccessNotificationModal from '@/components/SuccessNotificationModal';
import WebSocketNotifications from '@/components/WebSocketNotifications';
import { SimpleBottomNav } from './components/SimpleBottomNav';
import { SimpleMenu } from './components/SimpleMenu';
import { MenuIcon } from './components/icons';
import { SIMPLE_NS } from './i18n';

/**
 * Оболочка простого режима: свой каркас навигации вместо апстримного `Layout`.
 *
 * ⚠️ Апстримный `src/components/layout/AppShell/**` НЕ трогаем — он остаётся
 * экспертному режиму. Здесь своя навигация: нижнее меню на четыре пункта и
 * бургер с профилем, информацией и выходом в экспертный режим.
 *
 * Шапка намеренно почти пустая. У апстримной есть уведомления, переключатель
 * языка, поиск и прочее — всё это и есть та перегруженность, от которой уходим.
 *
 * ⚠️ Апстримный `AppShell` монтирует не только навигацию, но и четыре
 * инфраструктурных хоста. Их приходится монтировать и здесь, иначе простой режим
 * тихо лишается работающих механизмов: без `PromptDialogHost` общие хуки диалогов
 * молча ничего не показывают, без остальных пропадают уведомления и модалка
 * успешной оплаты. Это единственное, что мы берём из апстримных компонентов
 * помимо примитивов, — исключение перечислено поимённо в
 * `scripts/check-mode-boundaries.mjs`.
 */
export function SimpleShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useTranslation(SIMPLE_NS);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-end px-4 pt-4">
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
        Отступ снизу — под плавающее меню. Без него последний блок страницы
        уезжает под панель и его не домотать.
      */}
      <main className="pb-32">{children}</main>

      <SimpleBottomNav />
      <SimpleMenu open={menuOpen} onOpenChange={setMenuOpen} />

      {/* Инфраструктура, которую в экспертном режиме монтирует AppShell. */}
      <WebSocketNotifications />
      <CampaignBonusNotifier />
      <SuccessNotificationModal />
      <PromptDialogHost />
    </div>
  );
}
