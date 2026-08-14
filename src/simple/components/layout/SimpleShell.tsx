import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { isLogoPreloaded } from '@/api/branding';
import CampaignBonusNotifier from '@/components/CampaignBonusNotifier';
import { PromptDialogHost } from '@/components/PromptDialogHost';
import SuccessNotificationModal from '@/components/SuccessNotificationModal';
import WebSocketNotifications from '@/components/WebSocketNotifications';
import { useBackgroundConsumer } from '@/components/backgrounds/BackgroundHost';
import {
  ChevronExpandIcon,
  CreditCardIcon,
  HomeIcon,
  InfoIcon,
  LogoutIcon,
  ShieldIcon,
  SubscriptionIcon,
  SupportIcon,
  UserIcon,
} from '@/components/icons';
import { useBranding } from '@/hooks/useBranding';
import { useHeaderHeight } from '@/hooks/useHeaderHeight';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';
import { useTelegramSDK } from '@/hooks/useTelegramSDK';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/platform';
import { useAuthStore } from '@/store/auth';
import { SIMPLE_NS } from '../../i18n';
import { useModeStore } from '@/store/mode';
import { MobileBottomNav } from './MobileBottomNav';
import { SimpleHeader } from './SimpleHeader';

/**
 * Оболочка простого режима — копия апстримного
 * `src/components/layout/AppShell/AppShell.tsx`, упрощённая.
 *
 * ⚠️ Предыдущая версия была написана с нуля и потому умела только мобильную
 * вёрстку: на десктопе простой режим открывался узкой колонкой с плавающим
 * меню внизу (#39). Здесь адаптив, безопасные зоны Telegram, скрытие меню под
 * клавиатурой, восстановление скролла, регистрация потребителя фона и
 * инфраструктурные хосты приезжают из апстрима готовыми и нашей заботой быть
 * перестают.
 *
 * Что выброшено относительно апстрима:
 *
 *   - фича-флаги навигации (рефералка, колесо, конкурсы, опросы, подарки) —
 *     состав простого режима фиксирован;
 *   - переключатель темы, колокольчик уведомлений, переключатель языка, поиск —
 *     это и есть та перегруженность шапки, от которой уходим;
 *   - в правом углу вместо них ровно два действия: «Все возможности» и выход.
 *
 * Состав панели — требование владельца: только разрешённые в простом режиме
 * пункты плюс админка администратору.
 */
export function SimpleShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { t: tSimple } = useTranslation(SIMPLE_NS);
  const location = useLocation();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const logout = useAuthStore((state) => state.logout);
  const setMode = useModeStore((state) => state.setMode);
  const { isFullscreen, safeAreaInset, contentSafeAreaInset, platform, isMobile } =
    useTelegramSDK();
  const { mobile: headerHeight } = useHeaderHeight();
  const haptic = useHaptic();

  const { appName, logoLetter, hasCustomLogo, logoUrl } = useBranding();
  useScrollRestoration();
  // Анимированный фон рендерит BackgroundHost в App (не перемонтируется при
  // смене роута) — здесь только регистрируем, что на этом роуте он нужен.
  useBackgroundConsumer();

  // Полноэкранные поправки — только в мобильном Telegram.
  const isMobileFullscreen = isFullscreen && isMobile;

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  // Сброс на смене маршрута: иначе нижнее меню останется спрятанным после
  // навигации из поля ввода.
  useEffect(() => {
    setIsKeyboardOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        setIsKeyboardOpen(true);
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (
        !relatedTarget ||
        (relatedTarget.tagName !== 'INPUT' &&
          relatedTarget.tagName !== 'TEXTAREA' &&
          !relatedTarget.isContentEditable)
      ) {
        setIsKeyboardOpen(false);
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // Разрешённые в простом режиме пункты — без фича-флагов и без вариантов.
  const desktopNav = [
    { path: '/', label: t('nav.dashboard'), icon: HomeIcon },
    { path: '/subscriptions', label: t('nav.subscription'), icon: SubscriptionIcon },
    { path: '/balance', label: t('nav.balance'), icon: CreditCardIcon },
    { path: '/support', label: t('nav.support'), icon: SupportIcon },
    { path: '/profile', label: t('nav.profile'), icon: UserIcon },
    { path: '/info', label: t('nav.info'), icon: InfoIcon },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleNavClick = () => {
    haptic.impact('light');
  };

  const renderNavLink = (
    path: string,
    label: string,
    Icon: React.ComponentType<{ className?: string }>,
    admin = false,
  ) => {
    const active = admin ? location.pathname.startsWith('/admin') : isActive(path);
    return (
      <Link
        key={path}
        to={path}
        onClick={handleNavClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-200',
          active
            ? admin
              ? 'text-warning-300'
              : 'text-dark-50'
            : admin
              ? 'text-warning-500/70 hover:bg-warning-500/10 hover:text-warning-300'
              : 'text-dark-400 hover:bg-dark-800/60 hover:text-dark-100',
        )}
      >
        {active && (
          <motion.span
            layoutId="simple-desktop-nav-active"
            className={cn(
              'absolute inset-0 rounded-full shadow-sm',
              admin
                ? 'bg-warning-500/15 ring-1 ring-warning-500/20'
                : 'bg-dark-700/80 ring-1 ring-dark-600/40',
            )}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          />
        )}
        <Icon className="relative h-4 w-4 shrink-0" />
        <span className="relative whitespace-nowrap">{label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-viewport">
      {/* Инфраструктура, которую в экспертном режиме монтирует AppShell. */}
      <WebSocketNotifications />
      <CampaignBonusNotifier />
      <SuccessNotificationModal />
      <PromptDialogHost />

      {/* Десктопная шапка. w-screen вместо left-0 right-0: right-0 упирается в
          край вьюпорта БЕЗ скроллбара, и капсула по центру прыгала бы на
          полширины скроллбара между страницами со скроллом и без. */}
      <header className="fixed left-0 top-0 z-50 hidden w-screen border-b border-dark-800/50 bg-dark-950/95 lg:block">
        <div className="mx-auto grid h-14 max-w-[1600px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2.5 justify-self-start"
            onClick={handleNavClick}
          >
            <div className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dark-800">
              <span
                className={cn(
                  'absolute text-sm font-bold text-accent-400 transition-opacity duration-200',
                  hasCustomLogo && isLogoPreloaded() ? 'opacity-0' : 'opacity-100',
                )}
              >
                {logoLetter}
              </span>
              {hasCustomLogo && logoUrl && (
                <img
                  src={logoUrl}
                  alt={appName || 'Logo'}
                  className={cn(
                    'absolute h-full w-full object-contain transition-opacity duration-200',
                    isLogoPreloaded() ? 'opacity-100' : 'opacity-0',
                  )}
                />
              )}
            </div>
            <span className="text-base font-semibold text-dark-100">{appName}</span>
          </Link>

          {/* Навигация единой «капсулой»: все пункты видны всегда, без скролла
              и сворачивания. Центрируется средней колонкой grid. */}
          <nav className="flex items-center gap-0.5 justify-self-center rounded-full border border-dark-800/70 bg-dark-900/50 p-1 shadow-sm backdrop-blur-sm">
            {desktopNav.map((item) => renderNavLink(item.path, item.label, item.icon))}
            {isAdmin && (
              <>
                <div className="mx-1 h-5 w-px shrink-0 bg-dark-700/60" />
                {renderNavLink('/admin', t('admin.nav.title'), ShieldIcon, true)}
              </>
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-2 justify-self-end">
            {/* Режимы в интерфейсе не называем: человек видит обещание «все
                возможности», а не ярлык «ты новичок». */}
            <button
              type="button"
              onClick={() => {
                haptic.impact('light');
                setMode('expert');
              }}
              className="flex items-center gap-1.5 rounded-xl border border-dark-700/50 bg-dark-800/50 px-3 py-2 text-[13px] font-medium text-dark-300 transition-colors duration-200 hover:bg-dark-700 hover:text-accent-400"
            >
              <ChevronExpandIcon className="h-4 w-4" />
              {tSimple('mode.toExpert')}
            </button>
            <button
              type="button"
              onClick={() => {
                haptic.impact('light');
                logout();
              }}
              className="rounded-xl border border-dark-700/50 bg-dark-800/50 p-2 text-dark-400 transition-colors duration-200 hover:bg-dark-700 hover:text-accent-400"
              title={t('nav.logout')}
            >
              <LogoutIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Мобильная шапка */}
      <SimpleHeader
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        headerHeight={headerHeight}
        isFullscreen={isMobileFullscreen}
        safeAreaInset={safeAreaInset}
        contentSafeAreaInset={contentSafeAreaInset}
        telegramPlatform={platform}
      />

      {/* Распорки под фиксированные шапки */}
      <div className="hidden h-14 lg:block" />
      <div className="lg:hidden" style={{ height: headerHeight }} />

      <main className="mx-auto max-w-6xl px-4 py-6 pb-28 lg:px-6 lg:pb-8">{children}</main>

      <MobileBottomNav isKeyboardOpen={isKeyboardOpen} />
    </div>
  );
}
