import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { cn } from '@/lib/utils';
import { usePlatform } from '@/platform';
import { SIMPLE_BOTTOM_NAV_ICONS } from './navIcons';
import { isSimpleNavActive, SIMPLE_BOTTOM_NAV_ITEMS } from './navItems';

/**
 * Копия апстримного `src/components/layout/AppShell/MobileBottomNav.tsx`.
 *
 * Упрощение ровно одно: состав фиксирован. У апстрима четвёртый слот делят
 * колесо и рефералка по фича-флагам, и «Поддержка» из-за этого ездит; здесь
 * четыре пункта простого режима и никаких флагов.
 *
 * Эти четыре — **подмножество** общего списка `navItems.ts` по признаку
 * `inBottomNav`, а не свой перечень (#66): своего перечня хватило, чтобы состав
 * навигации в трёх местах разъехался молча. Иконка баланса тут по-прежнему
 * кошелёк, а не карта, — отличие живёт в `SIMPLE_BOTTOM_NAV_ICONS`.
 *
 * ⚠️ `lg:hidden` — не украшение: на десктопе работает верхняя панель, и без
 * этого класса нижнее меню всплывало бы поверх неё (дефект #39).
 */
export function MobileBottomNav({ isKeyboardOpen }: { isKeyboardOpen: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { haptic } = usePlatform();

  return (
    <nav
      aria-label={t('nav.dashboard')}
      className={cn(
        'fixed z-50 transition-all duration-200 lg:hidden',
        'bg-dark-900/95 backdrop-blur-linear',
        'border border-dark-700/30',
        isKeyboardOpen ? 'pointer-events-none opacity-0' : 'opacity-100',
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
        {SIMPLE_BOTTOM_NAV_ITEMS.map((item) => {
          const Icon = SIMPLE_BOTTOM_NAV_ICONS[item.path];
          const active = isSimpleNavActive(location.pathname, item.path);

          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => haptic.impact('light')}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-w-[56px] flex-1 shrink-0 flex-col items-center justify-center rounded-2xl px-3 py-2.5 transition-all duration-200',
                active ? 'text-accent-400' : 'text-dark-400 hover:text-dark-200',
              )}
            >
              {active && (
                <motion.div
                  layoutId="simple-bottom-nav-active"
                  className="absolute inset-0 rounded-2xl bg-accent-500/15"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <Icon className="relative z-10 h-5 w-5" />
              <span className="relative z-10 mt-1 whitespace-nowrap text-2xs">
                {t(item.labelKey)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
