import { initDataUser } from '@telegram-apps/sdk-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PiArrowsOutSimple } from 'react-icons/pi';
import { Link, useLocation } from 'react-router';
import { useShallow } from 'zustand/shallow';

import {
  brandingApi,
  getCachedBranding,
  isLogoPreloaded,
  preloadLogo,
  setCachedBranding,
} from '@/api/branding';
import { themeColorsApi } from '@/api/themeColors';
import {
  CloseIcon,
  CogIcon,
  InfoIcon,
  LogoutIcon,
  MenuIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from '@/components/icons';
import { useTheme } from '@/hooks/useTheme';
import type { TelegramPlatform } from '@/hooks/useTelegramSDK';
import { cn } from '@/lib/utils';
import { usePlatform } from '@/platform';
import { useAuthStore } from '@/store/auth';
import { displayName } from '@/utils/displayName';
import { SIMPLE_NS } from '../../i18n';
import LanguageSwitcher from '../LanguageSwitcher';
import { useModeStore } from '@/store/mode';

const FALLBACK_NAME = import.meta.env.VITE_APP_NAME || 'Cabinet';
const FALLBACK_LOGO = import.meta.env.VITE_APP_LOGO || 'V';

interface SimpleHeaderProps {
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  headerHeight: number;
  isFullscreen: boolean;
  safeAreaInset: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset: { top: number; bottom: number; left: number; right: number };
  telegramPlatform?: TelegramPlatform;
}

/**
 * Копия апстримного `src/components/layout/AppShell/AppHeader.tsx` — мобильная
 * шапка простого режима.
 *
 * Что выброшено относительно апстрима: колокольчик уведомлений и поиск. Из
 * ящика убраны пункты, которые уже стоят в нижнем меню (главная, подписка,
 * баланс, поддержка): дублировать четыре кнопки, видимые на том же экране,
 * незачем.
 *
 * Тумблер темы и переключатель языка (задача #43) в апстриме живут в верхней
 * строке шапки рядом с кнопкой меню; здесь — в ящике, рядом с блоком
 * пользователя, тем же приёмом, что правый угол десктопной шапки (#42): без
 * них человек с другим языком аккаунта или светлой темой не может это
 * поправить, не уходя в экспертный режим. Тумблер темы виден, только если
 * админ включил обе темы — иначе `useTheme` молча отказывается переключать, и
 * кнопка выглядит сломанной. Переключатель языка — общая с десктопом копия
 * `src/simple/components/LanguageSwitcher.tsx`, второй копии не заводим.
 *
 * Что сохранено дословно, потому что писалось не нами и не нами должно
 * чиниться: безопасные зоны полноэкранного Telegram, блокировка скролла под
 * открытым ящиком, брендирование логотипа, блок пользователя.
 */
export function SimpleHeader({
  mobileMenuOpen,
  setMobileMenuOpen,
  headerHeight,
  isFullscreen,
  safeAreaInset,
  contentSafeAreaInset,
  telegramPlatform,
}: SimpleHeaderProps) {
  const { t } = useTranslation();
  const { t: tSimple } = useTranslation(SIMPLE_NS);
  const location = useLocation();
  const { user, logout, isAdmin } = useAuthStore(
    useShallow((state) => ({ user: state.user, logout: state.logout, isAdmin: state.isAdmin })),
  );
  const { haptic } = usePlatform();
  const setMode = useModeStore((state) => state.setMode);
  const { toggleTheme, isDark } = useTheme();
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);
  const [logoLoaded, setLogoLoaded] = useState(() => isLogoPreloaded());

  // Видимость тумблера темы — тот же запрос и ключ, что у десктопной шапки
  // (#42), поэтому переключение режима не стоит лишнего похода в сеть.
  const { data: enabledThemes } = useQuery({
    queryKey: ['enabled-themes'],
    queryFn: themeColorsApi.getEnabledThemes,
    staleTime: 1000 * 60 * 5,
  });
  const canToggleTheme = enabledThemes?.dark && enabledThemes?.light;

  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: async () => {
      const data = await brandingApi.getBranding();
      setCachedBranding(data);
      await preloadLogo(data);
      return data;
    },
    initialData: getCachedBranding() ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: 60000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const appName = branding ? branding.name : FALLBACK_NAME;
  const logoLetter = branding?.logo_letter || FALLBACK_LOGO;
  const hasCustomLogo = branding?.has_custom_logo || false;
  const logoUrl = branding ? brandingApi.getLogoUrl(branding) : null;

  useEffect(() => {
    try {
      const telegramUser = initDataUser();
      if (telegramUser?.photo_url) {
        setUserPhotoUrl(telegramUser.photo_url);
      }
    } catch {
      // Не в Telegram либо init data недоступна.
    }
  }, []);

  // Блокировка скролла под открытым ящиком — работает и в iframe Mini App.
  useEffect(() => {
    if (!mobileMenuOpen) return;

    const preventDefault = (event: TouchEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.mobile-menu-content')) return;
      event.preventDefault();
    };

    document.addEventListener('touchmove', preventDefault, { passive: false });
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('touchmove', preventDefault);
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const isActive = (path: string) => location.pathname.startsWith(path);
  const isAdminActive = () => location.pathname.startsWith('/admin');

  return (
    <>
      <header
        className="glass fixed left-0 right-0 top-0 z-50 shadow-lg shadow-black/10 lg:hidden"
        style={{
          paddingTop: isFullscreen
            ? `${Math.max(safeAreaInset.top, contentSafeAreaInset.top) + (telegramPlatform === 'android' ? 48 : 45)}px`
            : undefined,
        }}
      >
        <div
          className="mx-auto w-full px-4"
          onClick={() => mobileMenuOpen && setMobileMenuOpen(false)}
        >
          <div className="flex h-16 items-center justify-between">
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className={cn('flex flex-shrink-0 items-center gap-2.5', !appName && 'mr-4')}
            >
              <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-linear-lg border border-dark-700/50 bg-dark-800/80 shadow-md">
                <span
                  className={cn(
                    'absolute text-lg font-bold text-accent-400 transition-opacity duration-200',
                    hasCustomLogo && logoLoaded ? 'opacity-0' : 'opacity-100',
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
                      logoLoaded ? 'opacity-100' : 'opacity-0',
                    )}
                    onLoad={() => setLogoLoaded(true)}
                  />
                )}
              </div>
              {appName && (
                <span className="whitespace-nowrap text-base font-semibold text-dark-100">
                  {appName}
                </span>
              )}
            </Link>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                haptic.impact('light');
                setMobileMenuOpen(!mobileMenuOpen);
              }}
              className={cn(
                'rounded-xl p-2.5 transition-all duration-200',
                mobileMenuOpen
                  ? 'bg-dark-700 text-dark-100'
                  : 'text-dark-400 hover:bg-dark-800 hover:text-dark-100',
              )}
              aria-label={tSimple('nav.openMenu')}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <CloseIcon className="h-6 w-6" />
              ) : (
                <MenuIcon className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 animate-fade-in lg:hidden"
          style={{ top: headerHeight }}
        >
          <div
            className="absolute inset-0 bg-dark-950/60"
            onClick={() => setMobileMenuOpen(false)}
          />

          <div
            className="mobile-menu-content absolute inset-x-0 bottom-0 top-0 overflow-y-auto overscroll-contain border-t border-dark-800/50 bg-dark-900/95 pb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="mx-auto max-w-6xl px-4 py-4">
              <div className="mb-4 flex items-center justify-between border-b border-dark-800/50 pb-4">
                <div className="flex min-w-0 items-center gap-3">
                  {userPhotoUrl ? (
                    <img
                      src={userPhotoUrl}
                      alt="Avatar"
                      className="h-10 w-10 rounded-full object-cover"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                        event.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full bg-dark-700',
                      userPhotoUrl ? 'hidden' : '',
                    )}
                  >
                    <UserIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-dark-100">
                      {displayName(user)}
                    </div>
                    <div className="truncate text-xs text-dark-500">
                      @{user?.username || `ID: ${user?.telegram_id}`}
                    </div>
                  </div>
                </div>

                {/* Язык и тема — то же, что в правом углу десктопной шапки
                    (#42): без них человек с другим языком аккаунта или
                    светлой темой не может это поправить, не уходя в
                    экспертный режим. */}
                <div className="flex flex-shrink-0 items-center gap-2">
                  <LanguageSwitcher />
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
                    title={
                      isDark ? t('theme.light') || 'Light mode' : t('theme.dark') || 'Dark mode'
                    }
                  >
                    {isDark ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/*
                Главная, подписка, баланс и поддержка сюда не дублируются — они
                стоят в нижнем меню, видимом на том же экране.
              */}
              <nav className="space-y-1">
                <Link
                  to="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className={isActive('/profile') ? 'nav-item-active' : 'nav-item'}
                >
                  <UserIcon className="h-5 w-5" />
                  {t('nav.profile')}
                </Link>

                {/* Юридические документы живут внутри «Информации» — пункт
                    обязан оставаться достижимым. */}
                <Link
                  to="/info"
                  onClick={() => setMobileMenuOpen(false)}
                  className={isActive('/info') ? 'nav-item-active' : 'nav-item'}
                >
                  <InfoIcon className="h-5 w-5" />
                  {t('nav.info')}
                </Link>

                {isAdmin && (
                  <>
                    <div className="divider my-3" />
                    <Link
                      to="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        'nav-item',
                        isAdminActive()
                          ? 'bg-warning-500/10 text-warning-400'
                          : 'text-warning-500/70',
                      )}
                    >
                      <CogIcon className="h-5 w-5" />
                      {t('admin.nav.title')}
                    </Link>
                  </>
                )}

                <div className="divider my-3" />

                {/* Режимы в интерфейсе не называем: человек видит обещание
                    «все возможности», а не ярлык «ты новичок». */}
                <button
                  type="button"
                  onClick={() => {
                    haptic.impact('light');
                    setMode('expert');
                    setMobileMenuOpen(false);
                  }}
                  className="nav-item w-full"
                >
                  <PiArrowsOutSimple className="h-5 w-5" />
                  {tSimple('mode.toExpert')}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="nav-item w-full text-error-400"
                >
                  <LogoutIcon className="h-5 w-5" />
                  {t('nav.logout')}
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
