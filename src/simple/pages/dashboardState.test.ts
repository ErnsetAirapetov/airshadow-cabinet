import { describe, expect, it } from 'vitest';
import type {
  Subscription,
  SubscriptionListItem,
  SubscriptionStatusResponse,
  SubscriptionsListResponse,
} from '@/types';
import { resolveDashboardSubscription, resolveRenewHref } from './dashboardState';

/**
 * Вся ветвящаяся логика простой главной живёт в чистом модуле именно ради этих
 * тестов: в репе нет ни jsdom, ни testing-library, компонентных тестов не бывает
 * (vitest.config.ts, `environment: 'node'`). Значит либо логика вынесена и
 * проверена, либо не проверена вовсе.
 */

const NOW = new Date('2026-08-14T12:00:00Z');

function status(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 7,
    status: 'active',
    is_trial: false,
    start_date: '2026-08-01T00:00:00',
    end_date: '2026-09-01T00:00:00',
    days_left: 18,
    hours_left: 0,
    minutes_left: 0,
    time_left_display: '18 дней',
    traffic_limit_gb: 100,
    traffic_used_gb: 1,
    traffic_used_percent: 1,
    device_limit: 3,
    connected_squads: [],
    servers: [],
    autopay_enabled: false,
    autopay_days_before: 3,
    subscription_url: 'https://sub.example/token',
    hide_subscription_link: false,
    is_active: true,
    is_expired: false,
    is_limited: false,
    ...overrides,
  };
}

function item(overrides: Partial<SubscriptionListItem> = {}): SubscriptionListItem {
  return {
    id: 1,
    status: 'active',
    tariff_id: 1,
    tariff_name: 'Базовый',
    traffic_limit_gb: 100,
    traffic_used_gb: 1,
    device_limit: 3,
    end_date: '2026-09-01T00:00:00Z',
    subscription_url: 'https://sub.example/token',
    subscription_crypto_link: null,
    is_trial: false,
    autopay_enabled: false,
    connected_squads: null,
    ...overrides,
  };
}

const single = (subscription: Subscription | null): SubscriptionStatusResponse => ({
  has_subscription: subscription !== null,
  subscription,
});

const list = (
  subscriptions: SubscriptionListItem[],
  multiTariff: boolean,
): SubscriptionsListResponse => ({
  subscriptions,
  multi_tariff_enabled: multiTariff,
});

describe('resolveDashboardSubscription — пока данных нет', () => {
  it('список не загружен — режим ещё неизвестен, показываем скелет', () => {
    // Без ответа /cabinet/subscriptions неизвестно даже, из какого источника
    // брать подписку. Показать «подписки нет» здесь — соврать пользователю.
    expect(
      resolveDashboardSubscription({
        list: undefined,
        status: undefined,
        statusLoading: false,
        now: NOW,
      }).kind,
    ).toBe('loading');
  });

  it('одно-тарифный режим: список есть, статус ещё грузится — скелет', () => {
    expect(
      resolveDashboardSubscription({
        list: list([], false),
        status: undefined,
        statusLoading: true,
        now: NOW,
      }).kind,
    ).toBe('loading');
  });
});

describe('resolveDashboardSubscription — одно-тарифный режим', () => {
  it('подписки нет', () => {
    expect(
      resolveDashboardSubscription({
        list: list([], false),
        status: single(null),
        statusLoading: false,
        now: NOW,
      }).kind,
    ).toBe('none');
  });

  it('активная подписка отдаёт дату, остаток дней и id', () => {
    const state = resolveDashboardSubscription({
      list: list([], false),
      status: single(status()),
      statusLoading: false,
      now: NOW,
    });

    expect(state).toMatchObject({
      kind: 'active',
      subscription: {
        id: 7,
        endDate: '2026-09-01T00:00:00',
        daysLeft: 18,
        isTrial: false,
        isExpired: false,
      },
    });
  });

  it('остаток дней берётся у бэкенда, а не пересчитывается', () => {
    // days_left считает бэкенд (Subscription.days_left), и он единственный
    // знает про паузы суточного тарифа. Пересчёт по end_date дал бы своё число.
    const state = resolveDashboardSubscription({
      list: list([], false),
      status: single(status({ days_left: 3 })),
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind === 'active' && state.subscription.daysLeft).toBe(3);
  });

  it('истёкшая подписка', () => {
    const state = resolveDashboardSubscription({
      list: list([], false),
      status: single(
        status({ status: 'expired', is_active: false, is_expired: true, days_left: 0 }),
      ),
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind).toBe('expired');
    expect(state.kind === 'expired' && state.subscription.isExpired).toBe(true);
  });

  it('отключённая подписка (disabled) — тоже истёкшая', () => {
    expect(
      resolveDashboardSubscription({
        list: list([], false),
        status: single(status({ status: 'disabled', is_active: false })),
        statusLoading: false,
        now: NOW,
      }).kind,
    ).toBe('expired');
  });

  it('исчерпанный трафик (limited) — подписка ЖИВА: срок ещё идёт', () => {
    // Апстрим показывает для limited карточку истёкшей, но истечение по сроку и
    // исчерпание трафика — разные вещи: «действует до» и остаток дней остаются
    // правдой. Продлевать при этом нечего, поэтому состояние активное.
    expect(
      resolveDashboardSubscription({
        list: list([], false),
        status: single(status({ status: 'limited', is_active: false, is_limited: true })),
        statusLoading: false,
        now: NOW,
      }).kind,
    ).toBe('active');
  });
});

describe('resolveDashboardSubscription — мультитариф', () => {
  it('подписок нет', () => {
    expect(
      resolveDashboardSubscription({
        list: list([], true),
        status: undefined,
        statusLoading: false,
        now: NOW,
      }).kind,
    ).toBe('none');
  });

  it('статус игнорируется: в мультитарифе /cabinet/subscription не запрашивается', () => {
    const state = resolveDashboardSubscription({
      list: list([item({ id: 42 })], true),
      status: single(status({ id: 7 })),
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind === 'active' && state.subscription.id).toBe(42);
  });

  it('главной берётся живая подписка с самым поздним концом', () => {
    const state = resolveDashboardSubscription({
      list: list(
        [
          item({ id: 1, end_date: '2026-08-20T12:00:00Z' }),
          item({ id: 2, end_date: '2026-12-01T12:00:00Z' }),
          item({ id: 3, status: 'expired', end_date: '2027-01-01T12:00:00Z' }),
        ],
        true,
      ),
      status: undefined,
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind === 'active' && state.subscription.id).toBe(2);
  });

  it('живых нет — берём самую позднюю из мёртвых и показываем как истёкшую', () => {
    const state = resolveDashboardSubscription({
      list: list(
        [
          item({ id: 1, status: 'expired', end_date: '2026-01-01T12:00:00Z' }),
          item({ id: 2, status: 'disabled', end_date: '2026-06-01T12:00:00Z' }),
        ],
        true,
      ),
      status: undefined,
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind).toBe('expired');
    expect(state.kind === 'expired' && state.subscription.id).toBe(2);
  });

  it('при равном сроке порядок детерминирован — меньший id', () => {
    const state = resolveDashboardSubscription({
      list: list(
        [
          item({ id: 5, end_date: '2026-09-01T12:00:00Z' }),
          item({ id: 2, end_date: '2026-09-01T12:00:00Z' }),
        ],
        true,
      ),
      status: undefined,
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind === 'active' && state.subscription.id).toBe(2);
  });

  it('подписка без даты конца не вытесняет датированную', () => {
    const state = resolveDashboardSubscription({
      list: list(
        [item({ id: 1, end_date: null }), item({ id: 2, end_date: '2026-09-01T12:00:00Z' })],
        true,
      ),
      status: undefined,
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind === 'active' && state.subscription.id).toBe(2);
  });

  it('остаток дней считается от даты конца, как на бэкенде — вниз', () => {
    // Бэкенд отдаёт `delta.days` (models.py: days_left), то есть неполные сутки
    // не считаются днём. Округление вверх показывало бы на день больше, чем
    // напишет бот в уведомлении.
    const state = resolveDashboardSubscription({
      list: list([item({ end_date: '2026-08-17T23:00:00Z' })], true),
      status: undefined,
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind === 'active' && state.subscription.daysLeft).toBe(3);
  });

  it('дата конца в прошлом — ноль дней, а не отрицательное число', () => {
    const state = resolveDashboardSubscription({
      list: list([item({ status: 'expired', end_date: '2026-08-01T12:00:00Z' })], true),
      status: undefined,
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind === 'expired' && state.subscription.daysLeft).toBe(0);
  });

  it('признаки триала и суточного тарифа переносятся из списка', () => {
    const state = resolveDashboardSubscription({
      list: list([item({ is_trial: true, is_daily: true })], true),
      status: undefined,
      statusLoading: false,
      now: NOW,
    });

    expect(state.kind === 'active' && state.subscription).toMatchObject({
      isTrial: true,
      isDaily: true,
    });
  });
});

describe('resolveRenewHref', () => {
  const sub = (overrides: Partial<Parameters<typeof resolveRenewHref>[0]> = {}) => ({
    id: 7,
    endDate: '2026-09-01T00:00:00',
    daysLeft: 18,
    isTrial: false,
    isDaily: false,
    isExpired: false,
    ...overrides,
  });

  it('платная живая подписка ведёт на страницу продления', () => {
    expect(resolveRenewHref(sub())).toBe('/subscriptions/7/renew');
  });

  it('триал продлевать нечего — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ isTrial: true }))).toBe('/subscription/purchase');
  });

  it('суточный тариф списывается сам — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ isDaily: true }))).toBe('/subscription/purchase');
  });

  it('истёкшая подписка — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ isExpired: true }))).toBe('/subscription/purchase');
  });

  it('без id ссылку на продление не собрать — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ id: 0 }))).toBe('/subscription/purchase');
  });
});
