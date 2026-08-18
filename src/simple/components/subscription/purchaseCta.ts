import type { Subscription } from '@/types';

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
 * Полный набор действий подписки — ДО разделения на кнопки и пункт блока (#61).
 *
 * ⚠️ Единственный источник истины для обоих потребителей. Владелец потребовал
 * перенести «Сменить тариф» в блок «Дополнительные опции», и соблазн был
 * написать блоку своё условие «когда показывать пункт». Второе правило
 * разъехалось бы с первым молча, со сборкой зелёной: пункт либо задвоился бы с
 * кнопкой, либо пропал бы у того, у кого кнопка была. Поэтому набор считается
 * один раз здесь, а `resolveSubscriptionCta` и `resolveTariffChangeOption`
 * только делят его между собой — их выдачи по построению не пересекаются и в
 * сумме дают этот набор.
 */
function resolveAllSubscriptionActions(subscription: Subscription | null): SubscriptionCtaAction[] {
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

/**
 * Смена тарифа, переехавшая в блок «Дополнительные опции» (#61), или `null`.
 *
 * ⚠️ Переезжает ТОЛЬКО второстепенное действие, то есть смена тарифа, стоявшая
 * второй кнопкой под продлением. Единственное действие экрана второстепенным не
 * бывает: у суточной подписки продления нет вовсе, у подписки без id его не
 * собрать, и там смена тарифа — единственный способ что-то сделать. Унеси её
 * оттуда в блок — и она задвоилась бы (кнопка осталась бы всё равно) либо
 * пропала бы у того, кому блок не показывают.
 */
export function resolveTariffChangeOption(
  subscription: Subscription | null,
): SubscriptionCtaAction | null {
  const actions = resolveAllSubscriptionActions(subscription);
  const change = actions.find((action) => action.kind === 'change');

  if (!change || actions.length === 1) return null;

  return change;
}

/**
 * Решает, какие кнопки показать под карточкой подписки.
 *
 * Раньше действие было одно и перегруженное: та же кнопка «Продлить подписку»
 * в мультитарифе вела на продление, а в одно-тарифном режиме — в витрину
 * тарифов (cabinet#19). Продление и смена тарифа стали разными кнопками, а
 * ссылка на продление строится по `subscription.id` независимо от режима.
 *
 * ⚠️ С #61 отсюда вычитается то, что уехало в блок «Дополнительные опции»:
 * владелец забраковал вид смены тарифа второстепенной кнопкой. Вычитание —
 * именно вычитание из общего набора, а не своя ветка: так пункт и кнопка не
 * могут ни разойтись, ни задвоиться.
 */
export function resolveSubscriptionCta(subscription: Subscription | null): SubscriptionCtaAction[] {
  const actions = resolveAllSubscriptionActions(subscription);
  const moved = resolveTariffChangeOption(subscription);

  if (moved === null) return actions;

  return actions.filter((action) => action.kind !== moved.kind);
}
