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

export type ExpiredCardAction = 'renew' | 'topUp';

/**
 * Единственная кнопка карточки истёкшей платной подписки: продление или
 * пополнение баланса — без развилки «две кнопки рядом» (#49).
 *
 * `hasBalance` — грубая проверка «есть хоть немного денег» (порог в
 * `SubscriptionCardExpired`), она не знает цену продления. Поэтому реальный
 * отказ `renewSubscription` по нехватке средств (баланс есть, но меньше
 * цены) обязан перебивать `hasBalance`: иначе кнопка «Продлить» осталась бы
 * висеть после отказа без единого рабочего действия на экране.
 */
export function resolveExpiredCardAction(params: {
  hasBalance: boolean;
  renewFailedInsufficientBalance: boolean;
}): ExpiredCardAction {
  if (params.renewFailedInsufficientBalance) {
    return 'topUp';
  }
  return params.hasBalance ? 'renew' : 'topUp';
}

export type TimeLeftUnit = 'days' | 'hours' | 'minutes';

export interface TimeLeftDisplay {
  value: number;
  unit: TimeLeftUnit;
}

/**
 * Крупная цифра плитки «Осталось» на активной карточке подписки.
 *
 * Бэкенд отдаёт `days_left` округлением вниз (`delta.days`), поэтому в
 * последние сутки живой подписки поле равно нулю — плитка показывала бы
 * «0 дн.», и человек читал бы это как «уже кончилась» (#34). Тем же
 * округлением вниз `hours_left` обнуляется в последний час — без отдельной
 * ветки плитка показывала бы «0 ч.» (#38).
 *
 * Приём заимствован у апстримного `src/pages/Subscription.tsx` (~ строка 881,
 * блок инфо о триале): там при `days_left <= 0` показываются `hours_left` и
 * `minutes_left` — но апстрим спускается только на один уровень и дальше
 * склеивает обе единицы в одну строку (`0ч 45м`), по `minutes_left` отдельно
 * не ветвится. Спуск ещё на один уровень (часы кончились — показать одни
 * минуты) — уже своё правило, продиктованное версткой плитки: цифра тут одна,
 * конкатенация двух единиц в неё не поместится. Сторож в `dashboardState.test.ts`
 * читает апстримный файл текстом и проверяет, что заимствованная часть на месте.
 */
export function resolveTimeLeftDisplay(subscription: Subscription): TimeLeftDisplay {
  if (subscription.days_left > 0) {
    return { value: subscription.days_left, unit: 'days' };
  }
  if (subscription.hours_left > 0) {
    return { value: subscription.hours_left, unit: 'hours' };
  }
  return { value: subscription.minutes_left, unit: 'minutes' };
}
