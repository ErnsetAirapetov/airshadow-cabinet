import type { Subscription } from '../../types';

/**
 * Что делает кнопка:
 * - `renew`    — продление текущего тарифа, страница `/subscriptions/:id/renew`;
 * - `change`   — переход на другой тариф, витрина `/subscription/purchase`;
 * - `purchase` — оформление подписки с нуля (истёкшая) или выход из триала,
 *                та же витрина, но по смыслу это не «смена тарифа».
 */
export type SubscriptionCtaKind = 'renew' | 'change' | 'purchase';

/** Визуальный вес: `accent` — основное действие, `subtle` — второстепенное. */
export type SubscriptionCtaTone = 'accent' | 'critical' | 'subtle';

export interface SubscriptionCtaAction {
  kind: SubscriptionCtaKind;
  to: string;
  tone: SubscriptionCtaTone;
  /** Ключ i18n заголовка кнопки — тексты живут только в locales/*.json. */
  labelKey: string;
  /** Ключ i18n подписи под заголовком. */
  hintKey: string;
}

const PURCHASE_ROUTE = '/subscription/purchase';

const CHANGE_TARIFF: Omit<SubscriptionCtaAction, 'hintKey'> = {
  kind: 'change',
  to: PURCHASE_ROUTE,
  tone: 'subtle',
  labelKey: 'subscription.switchTariff.title',
};

/**
 * Решает, какие кнопки показать под карточкой подписки.
 *
 * Раньше действие было одно и перегруженное: та же кнопка «Продлить подписку»
 * в мультитарифе вела на продление, а в одно-тарифном режиме — в витрину
 * тарифов (cabinet#19). Теперь продление и смена тарифа — разные кнопки, и
 * ссылка на продление строится по `subscription.id` независимо от режима.
 */
export function resolveSubscriptionCta(subscription: Subscription | null): SubscriptionCtaAction[] {
  const isExpired =
    !subscription ||
    (!subscription.is_active && !subscription.is_trial && !subscription.is_limited);

  // Подписки нет или она истекла — продлевать нечего, нужен новый тариф.
  if (isExpired) {
    return [
      {
        kind: 'purchase',
        to: PURCHASE_ROUTE,
        tone: 'critical',
        labelKey: 'subscription.getSubscription',
        hintKey: 'subscription.cta.expiredHint',
      },
    ];
  }

  // Триал продлить нельзя — из него только выходят на платный тариф.
  if (subscription.is_trial) {
    return [
      {
        kind: 'purchase',
        to: PURCHASE_ROUTE,
        tone: 'accent',
        labelKey: 'subscription.trialUpgrade.title',
        hintKey: 'subscription.cta.trialHint',
      },
    ];
  }

  // Суточный тариф списывается сам — ручное продление для него бессмысленно,
  // но сменить тариф пользователь по-прежнему может.
  if (subscription.is_daily) {
    return [{ ...CHANGE_TARIFF, hintKey: 'subscription.cta.dailyHint' }];
  }

  const change: SubscriptionCtaAction = {
    ...CHANGE_TARIFF,
    hintKey: 'subscription.cta.changeHint',
  };

  // Страховка: без id страницу продления не собрать — тогда остаётся только
  // смена тарифа, но никак не кнопка «Продлить», ведущая в витрину.
  if (!subscription.id) return [change];

  return [
    {
      kind: 'renew',
      to: `/subscriptions/${subscription.id}/renew`,
      tone: 'accent',
      labelKey: 'subscription.extend',
      hintKey: 'subscription.cta.renewHint',
    },
    change,
  ];
}
