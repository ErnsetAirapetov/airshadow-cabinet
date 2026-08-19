import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PiArrowsOutSimple } from 'react-icons/pi';
import { Link, useLocation } from 'react-router';

import { isLogoPreloaded } from '@/api/branding';
import { themeColorsApi } from '@/api/themeColors';
import CampaignBonusNotifier from '@/components/CampaignBonusNotifier';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { PromptDialogHost } from '@/components/PromptDialogHost';
import SuccessNotificationModal from '@/components/SuccessNotificationModal';
import TicketNotificationBell from '@/components/TicketNotificationBell';
import WebSocketNotifications from '@/components/WebSocketNotifications';
import { useBackgroundConsumer } from '@/components/backgrounds/BackgroundHost';
import { LogoutIcon, MoonIcon, ShieldIcon, SunIcon } from '@/components/icons';
import { useBranding } from '@/hooks/useBranding';
import { useHeaderHeight } from '@/hooks/useHeaderHeight';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';
import { useTelegramSDK } from '@/hooks/useTelegramSDK';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/platform';
import { useAuthStore } from '@/store/auth';
import { useModeStore } from '@/store/mode';
import { SIMPLE_NS } from '../../i18n';
import { MobileBottomNav } from './MobileBottomNav';
import { SimpleHeader } from './SimpleHeader';
import { SIMPLE_NAV_ICONS } from './navIcons';
import { isSimpleNavActive, SIMPLE_NAV_ITEMS } from './navItems';

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
 *   - поиск (командная палитра).
 *
 * Правый угол десктопной шапки — апстримный один в один (#42, #43, #47):
 * режим, тема, колокольчик, язык, выход, все пятеро одинаковыми квадратными
 * иконками. Владелец сравнил на стенде обе шапки и потребовал именно этого,
 * поэтому колокольчик вернулся, а кнопка режима лишилась текстовой подписи.
 * Язык и колокольчик берутся апстримными компонентами НАПРЯМУЮ (поимённо
 * открыты в `INFRA_ALLOWLIST` гейта `scripts/check-mode-boundaries.mjs`): копия
 * при требовании «один в один» даёт только расхождение при синке. Тумблер темы
 * показывается, только если админ включил обе темы: иначе `useTheme` молча
 * отказывается переключаться, и кнопка выглядит сломанной.
 *
 * Состав панели — требование владельца: только разрешённые в простом режиме
 * пункты плюс админка администратору. Сам перечень живёт в `navItems.ts` и
 * читается всеми тремя местами навигации (#66): до этого он был записан трижды,
 * и два из трёх перечней разъехались молча.
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
  const { toggleTheme, isDark } = useTheme();

  const { appName, logoLetter, hasCustomLogo, logoUrl } = useBranding();
  useScrollRestoration();
  // Анимированный фон рендерит BackgroundHost в App (не перемонтируется при
  // смене роута) — здесь только регистрируем, что на этом роуте он нужен.
  useBackgroundConsumer();

  // Видимость тумблера темы. Запрос тот же, что у апстримного AppShell, — и
  // ключ тот же, поэтому переключение режима не стоит лишнего похода в сеть.
  const { data: enabledThemes } = useQuery({
    queryKey: ['enabled-themes'],
    queryFn: themeColorsApi.getEnabledThemes,
    staleTime: 1000 * 60 * 5,
  });
  const canToggleTheme = enabledThemes?.dark && enabledThemes?.light;

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

  const handleNavClick = () => {
    haptic.impact('light');
  };

  const renderNavLink = (
    path: string,
    label: string,
    Icon: React.ComponentType<{ className?: string }>,
    admin = false,
  ) => {
    const active = admin
      ? location.pathname.startsWith('/admin')
      : isSimpleNavActive(location.pathname, path);
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
              и сворачивания. Центрируется средней колонкой grid.

              Состав берётся из общего списка `navItems.ts` — того же, что читают
              бургер и нижнее меню (#66). Своего перечня здесь больше нет: три
              копии состава разъехались молча, при зелёной сборке. */}
          <nav className="flex items-center gap-0.5 justify-self-center rounded-full border border-dark-800/70 bg-dark-900/50 p-1 shadow-sm backdrop-blur-sm">
            {SIMPLE_NAV_ITEMS.map((item) =>
              renderNavLink(item.path, t(item.labelKey), SIMPLE_NAV_ICONS[item.path]),
            )}
            {isAdmin && (
              <>
                <div className="mx-1 h-5 w-px shrink-0 bg-dark-700/60" />
                {renderNavLink('/admin', t('admin.nav.title'), ShieldIcon, true)}
              </>
            )}
          </nav>

          {/* Состав, порядок и вид — как в апстримном AppShell (#47): режим,
              тема, колокольчик, язык, выход. Владелец сравнил обе шапки на
              стенде и потребовал «один в один», поэтому сверяться тут надо с
              `src/components/layout/AppShell/AppShell.tsx` построчно, а не «на
              глаз». Порядок сторожит `src/simple/components/headerActions.test.ts`. */}
          <div className="flex shrink-0 items-center gap-2 justify-self-end">
            {/* Режимы в интерфейсе не называем: человек видит обещание «все
                возможности», а не ярлык «ты новичок». Подпись живёт в
                title/aria-label — кнопка с текстом рядом с четырьмя иконками
                ломала ряд, и её владелец забраковал (#47). */}
            <button
              type="button"
              onClick={() => {
                haptic.impact('light');
                setMode('expert');
              }}
              className="rounded-xl border border-dark-700/50 bg-dark-800/50 p-2 text-dark-400 transition-colors duration-200 hover:bg-dark-700 hover:text-accent-400"
              aria-label={tSimple('mode.toExpert')}
              title={tSimple('mode.toExpert')}
            >
              <PiArrowsOutSimple className="h-5 w-5" />
            </button>
            {/* `hidden`, а не условный рендер: разметка кнопки остаётся той же,
                что у апстрима, и отличие сводится к одному классу. */}
            <button
              type="button"
              onClick={() => {
                haptic.impact('light');
                toggleTheme();
              }}
              className={cn(
                'rounded-xl border border-dark-700/50 bg-dark-800/50 p-2 text-dark-400 transition-colors duration-200 hover:bg-dark-700 hover:text-accent-400',
                !canToggleTheme && 'hidden',
              )}
              aria-label={
                isDark ? t('theme.light') || 'Light mode' : t('theme.dark') || 'Dark mode'
              }
              title={isDark ? t('theme.light') || 'Light mode' : t('theme.dark') || 'Dark mode'}
            >
              {isDark ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
            </button>
            <TicketNotificationBell isAdmin={location.pathname.startsWith('/admin')} />
            <LanguageSwitcher />
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
