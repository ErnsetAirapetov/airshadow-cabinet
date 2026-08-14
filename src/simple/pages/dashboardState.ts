import type { Subscription, SubscriptionStatusResponse } from '@/types';

/**
 * Состояние подписки для простой главной — вся ветвящаяся логика страницы.
 *
 * Вынесена в чистый модуль намеренно: компонентных тестов в репе не бывает
 * (`vitest.config.ts` — `environment: 'node'`, ни jsdom, ни testing-library), и
 * без такого модуля ветки «нет подписки / трафик исчерпан / истекла / запрос
 * упал» остались бы непроверенными вообще.
 *
 * ⚠️ Одна подписка — одна карточка. Ветвлений «а если их несколько» здесь нет:
 * дев одно-тарифный, прод уходит с мультитарифа до раскатки нового интерфейса
 * (решение владельца, записано в docs/architecture/two-modes.md).
 *
 * ⚠️ Простая главная НЕ импортирует апстримные страницы и компоненты — граница
 * из docs/architecture/two-modes.md. Логику наследуем: типы и api общие.
 */

/** Подписка в том виде, в каком её показывает простая главная. */
export type SimpleSubscription = {
  id: number;
  endDate: string | null;
  daysLeft: number;
  isTrial: boolean;
  isDaily: boolean;
  isExpired: boolean;
  /** Трафик исчерпан: срок ещё идёт, но доступ уже не работает. */
  isLimited: boolean;
  /**
   * Панель отдала ссылку подписки. Без неё апстрим прячет блок подключения —
   * подключать нечего, пока ссылки нет.
   */
  hasConnectionLink: boolean;
};

export type DashboardSubscriptionState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'none' }
  | { kind: 'active'; subscription: SimpleSubscription }
  | { kind: 'limited'; subscription: SimpleSubscription }
  | { kind: 'expired'; subscription: SimpleSubscription };

export type DashboardSubscriptionInput = {
  /** Ответ `/cabinet/subscription`; `undefined` — ответа ещё нет. */
  status: SubscriptionStatusResponse | undefined;
  isLoading: boolean;
  isError: boolean;
};

const PURCHASE_ROUTE = '/subscription/purchase';

function toSubscription(subscription: Subscription): SimpleSubscription {
  return {
    id: subscription.id,
    endDate: subscription.end_date,
    // Остаток дней считает бэкенд — он единственный знает про паузы суточного
    // тарифа, поэтому своему пересчёту здесь предпочитаем его число.
    daysLeft: subscription.days_left,
    isTrial: subscription.is_trial,
    isDaily: subscription.is_daily ?? false,
    isExpired: subscription.is_expired || subscription.status === 'disabled',
    isLimited: subscription.is_limited,
    hasConnectionLink: Boolean(subscription.subscription_url),
  };
}

/**
 * ⚠️ Порядок веток повторяет апстрим (`SubscriptionCardExpired`): исчерпанный
 * трафик перебивает истечение, потому что действие у него другое — докупить
 * трафик, а не продлить срок.
 */
function toState(subscription: SimpleSubscription): DashboardSubscriptionState {
  if (subscription.isLimited) {
    return { kind: 'limited', subscription };
  }
  return subscription.isExpired
    ? { kind: 'expired', subscription }
    : { kind: 'active', subscription };
}

/**
 * Состояние подписки для главной по ответу `/cabinet/subscription`.
 *
 * ⚠️ Ветка ошибки обязательна, а не украшение. У запроса стоит `retry: false`, а
 * `refetchOnWindowFocus` выключен глобально: без неё «ответа нет» означало бы и
 * «грузится», и «упало», то есть любая сетевая осечка вешала бы вечный скелет на
 * экране, с которого покупают. Апстримная главная в этой же ситуации хотя бы
 * деградирует мягко — просто не рисует карточку.
 *
 * Данные важнее ошибки: если прошлый успешный ответ есть, упавшее фоновое
 * обновление подписку не прячет.
 */
export function resolveDashboardSubscription(
  input: DashboardSubscriptionInput,
): DashboardSubscriptionState {
  const { status, isError } = input;

  if (status === undefined) {
    return isError ? { kind: 'error' } : { kind: 'loading' };
  }

  if (!status.has_subscription || status.subscription === null) {
    return { kind: 'none' };
  }

  return toState(toSubscription(status.subscription));
}

/**
 * Куда вести из состояния «доступ приостановлен» (`limited`).
 *
 * ⚠️ Здесь была кнопка «Докупить трафик» на `/subscriptions/‹id›` — снята по
 * наблюдению со стенда: блок докупки живёт на странице подписки инлайн-аккордеоном
 * и у подписки в `limited` исчезает целиком. Кнопка вела бы в тупик — обещали
 * действие, которого на той странице нет.
 *
 * Пока владелец не решил состав этого состояния, ведём в витрину тарифов:
 * оформление доступно всегда.
 *
 * Для будущего решения (прочитано в коде бота, наблюдением не подтверждено):
 * статус `limited` бэкенд ставит ТОЛЬКО эхом панели RemnaWave, то есть по
 * исчерпанию трафика; нехватка денег даёт `disabled`. Покупку пакета трафика
 * кабинетное API на `limited` при этом разрешает и штатно реактивирует
 * подписку — запрет живёт только в отрисовке апстрима.
 */
export function resolveLimitedHref(): string {
  return PURCHASE_ROUTE;
}

/**
 * Куда ведёт продление.
 *
 * Правило скопировано из `src/components/subscription/purchaseCta.ts`
 * (`resolveSubscriptionCta`) — импортировать оттуда нельзя, это апстримный
 * `components/`, граница режимов такой импорт не пропускает. Копируется только
 * выбор адреса: тона и i18n-ключи там апстримные, простой главной они не нужны.
 * Файл переезжает в `src/simple/` отдельной задачей (#29) вместе с откатом
 * `PurchaseCTAButton` — тогда дубль схлопнется. Против молчаливого расхождения
 * копии стоит сторож в `dashboardState.test.ts`.
 *
 * Продлевать нечего у истёкшей (нужен новый тариф), у триала (из него только
 * выходят на платный) и у суточного тарифа (списывается сам) — все они ведут в
 * витрину. Без `id` страницу продления не собрать, поэтому туда же.
 */
export function resolveRenewHref(subscription: SimpleSubscription): string {
  if (subscription.isExpired || subscription.isTrial || subscription.isDaily) {
    return PURCHASE_ROUTE;
  }
  if (!subscription.id) {
    return PURCHASE_ROUTE;
  }
  return `/subscriptions/${subscription.id}/renew`;
}
