import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/primitives';
import { usePlatform } from '@/platform';
import { useAuthStore } from '@/store/auth';
import { SIMPLE_NS } from '../i18n';
import { useModeStore } from '../mode';
import { ExpandIcon, InfoIcon, LogoutIcon, UserIcon } from './icons';

/**
 * Бургер-меню простого режима: профиль, информация, переход в экспертный режим
 * и выход из аккаунта.
 *
 * Юридические документы обязаны оставаться достижимыми — они живут внутри
 * «Информации», поэтому пункт нельзя убирать ради красоты.
 */
const LINKS = [
  { path: '/profile', labelKey: 'nav.profile', Icon: UserIcon },
  { path: '/info', labelKey: 'nav.info', Icon: InfoIcon },
];

const ROW =
  'flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-sm text-dark-100 transition-colors hover:bg-white/5';

export function SimpleMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(SIMPLE_NS);
  const setMode = useModeStore((state) => state.setMode);
  const logout = useAuthStore((state) => state.logout);
  const { haptic } = usePlatform();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('nav.menu')}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-1 pb-2">
          {LINKS.map(({ path, labelKey, Icon }) => (
            <Link key={path} to={path} onClick={() => onOpenChange(false)} className={ROW}>
              <Icon className="h-5 w-5 text-dark-400" />
              {t(labelKey)}
            </Link>
          ))}

          <div className="my-2 h-px bg-dark-700/40" />

          {/*
            Переход в экспертный режим. Режимы в интерфейсе не называем: человек
            видит обещание «все возможности», а не ярлык «ты новичок».
          */}
          <button
            type="button"
            onClick={() => {
              haptic.impact('light');
              setMode('expert');
              onOpenChange(false);
            }}
            className={ROW}
          >
            <ExpandIcon className="h-5 w-5 text-dark-400" />
            {t('mode.toExpert')}
          </button>

          {/*
            Выход из аккаунта. В апстриме он живёт только в шапке AppShell, и
            без этого пункта пользователь простого режима не смог бы выйти,
            не переключившись в экспертный. Для кабинета с оплатами это дыра,
            а не упрощение.
          */}
          <button
            type="button"
            onClick={() => {
              haptic.impact('light');
              onOpenChange(false);
              logout();
            }}
            className={`${ROW} text-error-400`}
          >
            <LogoutIcon className="h-5 w-5" />
            {t('nav.logout')}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
