import type { Subscription, SubscriptionStatusResponse } from '@/types';

/**
 * Состояние подписки для простой главной.
 *
 * Вынесено в чистый модуль намеренно: компонентных тестов в репе не бывает
 * (`vitest.config.ts` — `environment: 'node'`, ни jsdom, ни testing-library), и
 * без такого модуля ветки «грузится / упало / нет подписки / приостановлена /
 * истекла» остались бы непроверенными вообще.
 *
 * ⚠️ Работаем прямо на апстримном типе `Subscription`, без своего view-типа:
 * простые карточки — копии апстримных и принимают именно его. Свой промежуточный
 * тип означал бы конвертацию туда-обратно на каждой карточке.
 *
 * ⚠️ Одна подписка — одна карточка. Ветвлений «а если их несколько» здесь нет:
 * дев одно-тарифный, прод уходит с мультитарифа до раскатки нового интерфейса
 * (решение владельца, docs/architecture/two-modes.md).
 */

export type DashboardSubscriptionState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'none' }
  | { kind: 'active'; subscription: Subscription }
  /** Трафик исчерпан: срок ещё идёт, но доступ уже не работает. */
  | { kind: 'limited'; subscription: Subscription }
  | { kind: 'expired'; subscription: Subscription };

export type DashboardSubscriptionInput = {
  /** Ответ `/cabinet/subscription`; `undefined` — ответа ещё нет. */
  status: SubscriptionStatusResponse | undefined;
  isLoading: boolean;
  isError: boolean;
};

const PURCHASE_ROUTE = '/subscription/purchase';

/** Истечение по сроку: отдельно от исчерпанного трафика. */
function isExpired(subscription: Subscription): boolean {
  return subscription.is_expired || subscription.status === 'disabled';
}

/**
 * Состояние подписки по ответу `/cabinet/subscription`.
 *
 * ⚠️ Ветка ошибки обязательна, а не украшение. У запроса стоит `retry: false`, а
 * `refetchOnWindowFocus` выключен глобально: без неё «ответа нет» означало бы и
 * «грузится», и «упало», то есть любая сетевая осечка вешала бы вечный скелет на
 * экране, с которого покупают.
 *
 * Данные важнее ошибки: если прошлый успешный ответ есть, упавшее фоновое
 * обновление подписку не прячет.
 *
 * ⚠️ Порядок веток повторяет апстрим (`SubscriptionCardExpired` показывается и
 * для `is_limited`, и для истёкшей, а внутри различает их сам): исчерпанный
 * трафик перебивает истечение, потому что действие у него другое.
 */
export function resolveDashboardSubscription(
  input: DashboardSubscriptionInput,
): DashboardSubscriptionState {
  const { status, isError } = input;

  if (status === undefined) {
    return isError ? { kind: 'error' } : { kind: 'loading' };
  }

  const subscription = status.subscription;
  if (!status.has_subscription || subscription === null) {
    return { kind: 'none' };
  }

  if (subscription.is_limited) {
    return { kind: 'limited', subscription };
  }

  return isExpired(subscription)
    ? { kind: 'expired', subscription }
    : { kind: 'active', subscription };
}

/**
 * Куда ведёт продление.
 *
 * Правило скопировано из `src/components/subscription/purchaseCta.ts`
 * (`resolveSubscriptionCta`) — импортировать оттуда нельзя, это апстримный
 * `components/`, граница режимов такой импорт не пропускает. Копируется только
 * выбор адреса: тона и i18n-ключи там апстримные, простому режиму они не нужны.
 * Файл переезжает в `src/simple/` задачей #29 — тогда дубль схлопнется. Против
 * молчаливого расхождения копии стоит сторож в `dashboardState.test.ts`.
 *
 * Продлевать нечего у истёкшей (нужен новый тариф), у триала (из него только
 * выходят на платный) и у суточного тарифа (списывается сам) — все они ведут в
 * витрину. Без `id` страницу продления не собрать, поэтому туда же.
 */
export function resolveRenewHref(subscription: Subscription): string {
  if (isExpired(subscription) || subscription.is_trial || subscription.is_daily) {
    return PURCHASE_ROUTE;
  }
  if (!subscription.id) {
    return PURCHASE_ROUTE;
  }
  return `/subscriptions/${subscription.id}/renew`;
}
