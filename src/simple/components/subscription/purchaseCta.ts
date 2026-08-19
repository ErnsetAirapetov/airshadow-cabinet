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

/**
 * Адрес витрины тарифов.
 *
 * ⚠️ Экспортируется с #67: в витрину уходит не только кнопка покупки, но и
 * общий блок действия истёкшей подписки — у подписки с непродлеваемым статусом
 * это единственный путь вперёд. Копия литерала в блоке разъехалась бы с этой
 * молча, а адрес витрины у простого режима один.
 */
export const PURCHASE_ROUTE = '/subscription/purchase';

const CHANGE_TARIFF: Omit<SubscriptionCtaAction, 'hintKey'> = {
  kind: 'change',
  to: PURCHASE_ROUTE,
  tone: 'subtle',
  labelKey: 'subscription.switchTariff.title',
};

/**
 * Подписка ЕСТЬ и она истекла — единственное правило «истекла» простого режима.
 *
 * ⚠️ Отсутствие подписки сюда НЕ входит, и это суть развода #65. Прежде оба
 * случая отвечали на одно условие (`!subscription || (...)`), и одинаковый
 * ответ был неверен: без подписки продлевать нечего и нужна витрина, а у
 * истёкшей есть `id`, тариф и цена — её продлевают, как на главной.
 *
 * Предикат экспортируется, чтобы страница подписки спрашивала ТО ЖЕ правило
 * (`pages/subscriptionState.ts`): второе условие «истекла» разъехалось бы с
 * этим молча, и экран получил бы либо две кнопки, либо ни одной.
 *
 * ⚠️ Не путать с `isExpired` из `pages/dashboardState.ts` — там правило другое
 * (`is_expired || status === 'disabled'`) и относится к выбору карточки
 * главной; канон, раздел «Заимствование логики».
 */
export function isExpiredPaidSubscription(subscription: Subscription | null): boolean {
  if (!subscription) return false;

  return !subscription.is_active && !subscription.is_trial && !subscription.is_limited;
}

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
 * сумме дают этот набор. Свойство доказано перебором состояний в
 * `purchaseCta.test.ts`, и развод ветки «истекла» (#65) его сохранил: пустой
 * набор делится на две пустые выдачи.
 */
function resolveAllSubscriptionActions(subscription: Subscription | null): SubscriptionCtaAction[] {
  // Подписки нет вовсе — продлевать нечего, нужен новый тариф.
  if (!subscription) {
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

  // Подписка есть и истекла — действий здесь НЕТ, и это не пропажа (#65).
  // Единственную кнопку экрана («Продлить подписку» либо «Пополнить баланс»)
  // считает общий блок `ExpiredSubscriptionAction`: у истёкшей подписки есть
  // id и цена, поэтому её продлевают, а не оформляют заново. Отдай мы здесь
  // «Оформить подписку» — рядом с той кнопкой встала бы вторая, ровно то, что
  // владелец и просил убрать.
  if (isExpiredPaidSubscription(subscription)) {
    return [];
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
