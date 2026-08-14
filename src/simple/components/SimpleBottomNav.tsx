import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { usePlatform } from '@/platform';
import { SIMPLE_NS } from '../i18n';
import { HomeIcon, SubscriptionIcon, SupportIcon, WalletIcon } from './icons';

/**
 * Нижнее меню простого режима — ровно четыре пункта, без флагов и вариантов.
 *
 * У апстримного `MobileBottomNav` состав плавает: колесо вытесняет рефералку,
 * рефералка — ещё что-то. Здесь состав фиксирован: это и есть упрощение.
 *
 * В отличие от апстрима меню видно на всех ширинах (у апстрима `lg:hidden`, а
 * на десктопе своя боковая панель). Своей боковой панели у простого режима нет
 * и не будет, поэтому на широком экране прижимаем меню по центру.
 */
const ITEMS = [
  { path: '/', labelKey: 'nav.dashboard', Icon: HomeIcon },
  { path: '/subscriptions', labelKey: 'nav.subscription', Icon: SubscriptionIcon },
  { path: '/balance', labelKey: 'nav.balance', Icon: WalletIcon },
  { path: '/support', labelKey: 'nav.support', Icon: SupportIcon },
];

export function SimpleBottomNav({ hidden = false }: { hidden?: boolean }) {
  const { t } = useTranslation(SIMPLE_NS);
  const location = useLocation();
  const { haptic } = usePlatform();

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <nav
      aria-label={t('nav.primary')}
      className={cn(
        'fixed z-50 mx-auto max-w-md border border-dark-700/30 bg-dark-900/95 backdrop-blur-linear transition-opacity duration-200',
        // Прячем при открытой клавиатуре: «Поддержка» с текстовым полем — пункт
        // этого же меню, и панель встала бы поверх поля ввода.
        hidden ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
      style={{
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        left: '16px',
        right: '16px',
        borderRadius: 'var(--bento-radius, 24px)',
        padding: '8px 4px',
        boxShadow: '0 4px 30px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
      }}
    >
      <div className="flex justify-around">
        {ITEMS.map(({ path, labelKey, Icon }) => {
          const active = isActive(path);
          return (
            <Link
              key={path}
              to={path}
              onClick={() => haptic.impact('light')}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-[56px] flex-1 shrink-0 flex-col items-center justify-center rounded-2xl px-3 py-2.5 transition-colors duration-200',
                active ? 'bg-accent-500/15 text-accent-400' : 'text-dark-400 hover:text-dark-200',
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="mt-1 whitespace-nowrap text-2xs">{t(labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
