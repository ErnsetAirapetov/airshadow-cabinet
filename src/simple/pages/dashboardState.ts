import type {
  Subscription,
  SubscriptionListItem,
  SubscriptionStatusResponse,
  SubscriptionsListResponse,
} from '@/types';

/**
 * Состояние подписки для простой главной — вся ветвящаяся логика страницы.
 *
 * Вынесена в чистый модуль намеренно: компонентных тестов в репе не бывает
 * (`vitest.config.ts` — `environment: 'node'`, ни jsdom, ни testing-library), и
 * без такого модуля ветки «мультитариф / одно-тарифный / истекла / нет вовсе»
 * остались бы непроверенными вообще.
 *
 * ⚠️ Простая главная НЕ импортирует апстримные страницы и компоненты — граница
 * из docs/architecture/two-modes.md. Логику наследуем: типы и api общие.
 */

/** Подписка в том виде, в каком её показывает простая главная. */
export type SimpleSubscription = {
  id: number;
  /** ISO-строка от бэкенда либо `null` — в списке мультитарифа она обнуляемая. */
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
  | { kind: 'none' }
  | { kind: 'active'; subscription: SimpleSubscription }
  | { kind: 'limited'; subscription: SimpleSubscription }
  | { kind: 'expired'; subscription: SimpleSubscription };

export type DashboardSubscriptionInput = {
  /** Ответ `/cabinet/subscriptions`; `undefined` — ещё не загружен. */
  list: SubscriptionsListResponse | undefined;
  /** Ответ `/cabinet/subscription`; в мультитарифе не запрашивается. */
  status: SubscriptionStatusResponse | undefined;
  statusLoading: boolean;
  now?: Date;
};

const PURCHASE_ROUTE = '/subscription/purchase';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Статусы, при которых подписка ещё работает или хотя бы не кончилась по сроку. */
const LIVE_STATUSES = new Set(['active', 'trial', 'limited']);

/**
 * Остаток дней по дате конца — только для мультитарифа: в списке
 * (`SubscriptionListItem`) поля `days_left` нет, в отличие от одно-тарифного
 * ответа.
 *
 * Округляем ВНИЗ, как бэкенд (`app/database/models.py`, `days_left` → `delta.days`):
 * неполные сутки за день не считаются. Округление вверх показало бы на день
 * больше, чем напишет бот в уведомлении об окончании.
 */
function daysUntil(endDate: string | null, now: Date): number {
  if (!endDate) {
    return 0;
  }
  const end = new Date(endDate).getTime();
  if (Number.isNaN(end)) {
    return 0;
  }
  return Math.max(0, Math.floor((end - now.getTime()) / DAY_MS));
}

function fromStatus(subscription: Subscription): SimpleSubscription {
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

function fromListItem(item: SubscriptionListItem, now: Date): SimpleSubscription {
  return {
    id: item.id,
    endDate: item.end_date,
    daysLeft: daysUntil(item.end_date, now),
    isTrial: item.is_trial,
    isDaily: item.is_daily ?? false,
    isExpired: !LIVE_STATUSES.has(item.status),
    isLimited: item.status === 'limited',
    hasConnectionLink: Boolean(item.subscription_url),
  };
}

/**
 * Какую подписку показывает главная, когда их несколько.
 *
 * Живые вперёд мёртвых, среди равных — та, что кончается позже; при полном
 * равенстве — меньший id, чтобы порядок не зависел от порядка ответа сервера.
 * Остальные подписки достижимы через «Подписка» в нижнем меню — главная
 * показывает состояние, а не управляет парком.
 */
function pickPrimary(items: SubscriptionListItem[]): SubscriptionListItem | null {
  let best: SubscriptionListItem | null = null;

  for (const item of items) {
    if (best === null || isBetterPrimary(item, best)) {
      best = item;
    }
  }

  return best;
}

function isBetterPrimary(candidate: SubscriptionListItem, current: SubscriptionListItem): boolean {
  const candidateLive = LIVE_STATUSES.has(candidate.status);
  const currentLive = LIVE_STATUSES.has(current.status);
  if (candidateLive !== currentLive) {
    return candidateLive;
  }

  // Подписка без даты конца сравнима только с такой же: считаем её концом ноль,
  // чтобы датированная всегда побеждала.
  const candidateEnd = candidate.end_date ? new Date(candidate.end_date).getTime() : 0;
  const currentEnd = current.end_date ? new Date(current.end_date).getTime() : 0;
  if (candidateEnd !== currentEnd) {
    return candidateEnd > currentEnd;
  }

  return candidate.id < current.id;
}

/**
 * Состояние подписки для главной по ответам тех же запросов, что у апстримной
 * главной: `/cabinet/subscriptions` и (только в одно-тарифном режиме)
 * `/cabinet/subscription`.
 *
 * ⚠️ Пока не пришёл список — `loading`, а не «подписки нет»: из ответа списка
 * узнаётся сам режим (`multi_tariff_enabled`), то есть источник данных. Показать
 * в этот момент предложение триала значит соврать оплатившему человеку.
 */
export function resolveDashboardSubscription(
  input: DashboardSubscriptionInput,
): DashboardSubscriptionState {
  const { list, status, statusLoading, now = new Date() } = input;

  if (list === undefined) {
    return { kind: 'loading' };
  }

  if (list.multi_tariff_enabled) {
    const primary = pickPrimary(list.subscriptions ?? []);
    if (primary === null) {
      return { kind: 'none' };
    }
    return toState(fromListItem(primary, now));
  }

  if (statusLoading || status === undefined) {
    return { kind: 'loading' };
  }

  if (!status.has_subscription || status.subscription === null) {
    return { kind: 'none' };
  }

  return toState(fromStatus(status.subscription));
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
 * Куда ведёт продление.
 *
 * Правило скопировано из `src/components/subscription/purchaseCta.ts`
 * (`resolveSubscriptionCta`) — импортировать оттуда нельзя, это апстримный
 * `components/`, граница режимов такой импорт не пропускает. Копируется только
 * выбор адреса: тона и i18n-ключи там апстримные, простой главной они не нужны.
 * Файл переезжает в `src/simple/` отдельной задачей (#29) вместе с откатом
 * `PurchaseCTAButton` — тогда дубль схлопнется.
 *
 * Продлевать нечего у истёкшей (нужен новый тариф), у триала (из него только
 * выходят на платный) и у суточного тарифа (списывается сам) — все они ведут в
 * витрину. Без `id` страницу продления не собрать, поэтому туда же.
 */
/**
 * Куда ведёт «Докупить трафик» при исчерпанном лимите — на страницу подписки,
 * где живут пакеты трафика. Адрес тот же, что у апстримной карточки истёкшей
 * подписки в ветке `isLimited`: покупка пакета доступна прямо оттуда, и это
 * ровно то, что человеку нужно сделать, чтобы вернуть доступ.
 */
export function resolveTrafficHref(subscription: SimpleSubscription): string {
  return subscription.id ? `/subscriptions/${subscription.id}` : '/subscriptions';
}

export function resolveRenewHref(subscription: SimpleSubscription): string {
  if (subscription.isExpired || subscription.isTrial || subscription.isDaily) {
    return PURCHASE_ROUTE;
  }
  if (!subscription.id) {
    return PURCHASE_ROUTE;
  }
  return `/subscriptions/${subscription.id}/renew`;
}
