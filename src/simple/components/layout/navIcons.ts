import type { ComponentType } from 'react';

import {
  CreditCardIcon,
  HomeIcon,
  InfoIcon,
  SubscriptionIcon,
  SupportIcon,
  UserIcon,
  WalletIcon,
} from '@/components/icons';
import type { SimpleNavPath } from './navItems';

/** Иконка пункта — апстримный компонент, принимающий только класс. */
export type SimpleNavIcon = ComponentType<{ className?: string }>;

/**
 * Иконки пунктов простого режима — вынесены из `navItems.ts` намеренно.
 *
 * `navItems.ts` обязан оставаться без импортов из `@/**`, иначе сторож состава не
 * сможет прочитать его импортом (`environment: 'node'`, alias `@/` в vitest нет).
 * Иконки же — значения, а не строки, и тип у них апстримный. Поэтому состав живёт
 * там, презентация — здесь.
 *
 * ⚠️ Полноту карты сторожит `tsc`, а не тест: `Record<SimpleNavPath, …>` не
 * собирается, если у пункта из `SIMPLE_NAV_ITEMS` нет иконки.
 */
export const SIMPLE_NAV_ICONS: Record<SimpleNavPath, SimpleNavIcon> = {
  '/': HomeIcon,
  '/subscriptions': SubscriptionIcon,
  '/balance': CreditCardIcon,
  '/support': SupportIcon,
  '/profile': UserIcon,
  '/info': InfoIcon,
};

/**
 * Иконки нижнего меню — те же, кроме баланса.
 *
 * Отличие ровно одно и оно осознанное: внизу у баланса стоит кошелёк, и правка
 * #66 нижнее меню менять не должна. Наследование через спред, а не второй
 * перечень: перечислить иконки заново — снова копия, которая разъедется.
 */
export const SIMPLE_BOTTOM_NAV_ICONS: Record<SimpleNavPath, SimpleNavIcon> = {
  ...SIMPLE_NAV_ICONS,
  '/balance': WalletIcon,
};
