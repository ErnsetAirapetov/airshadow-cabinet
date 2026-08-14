import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Subscription, SubscriptionStatusResponse } from '@/types';
import {
  resolveDashboardSubscription,
  resolveLimitedHref,
  resolveRenewHref,
} from './dashboardState';

/**
 * Вся ветвящаяся логика простой главной живёт в чистом модуле именно ради этих
 * тестов: в репе нет ни jsdom, ни testing-library, компонентных тестов не бывает
 * (vitest.config.ts, `environment: 'node'`). Значит либо логика вынесена и
 * проверена, либо не проверена вовсе.
 */

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

const response = (subscription: Subscription | null): SubscriptionStatusResponse => ({
  has_subscription: subscription !== null,
  subscription,
});

const resolve = (overrides: Partial<Parameters<typeof resolveDashboardSubscription>[0]> = {}) =>
  resolveDashboardSubscription({
    status: response(status()),
    isLoading: false,
    isError: false,
    ...overrides,
  });

describe('resolveDashboardSubscription — данных ещё нет', () => {
  it('запрос идёт — скелет', () => {
    expect(resolve({ status: undefined, isLoading: true }).kind).toBe('loading');
  });

  it('ответа нет и ошибки нет — тоже скелет', () => {
    // Запрос может быть ещё не запущен (enabled), это не ошибка.
    expect(resolve({ status: undefined }).kind).toBe('loading');
  });
});

describe('resolveDashboardSubscription — ошибка запроса', () => {
  it('запрос упал и данных нет — состояние ошибки, а не вечный скелет', () => {
    // ⚠️ Ради этого состояние и заведено. У запроса `retry: false`, а
    // `refetchOnWindowFocus` выключен глобально: без отдельной ветки любая
    // сетевая осечка или 5xx вешала бы на экране покупки скелет навсегда —
    // ни текста, ни кнопки повтора.
    expect(resolve({ status: undefined, isError: true }).kind).toBe('error');
  });

  it('ошибка при уже загруженных данных не прячет подписку', () => {
    // Фоновое обновление упало, но данные с прошлого успешного ответа есть.
    // Стереть их ради экрана ошибки значит наказать человека за чужой сбой.
    expect(resolve({ isError: true }).kind).toBe('active');
  });

  it('ошибка приоритетнее флага загрузки, если данных так и нет', () => {
    expect(resolve({ status: undefined, isLoading: true, isError: true }).kind).toBe('error');
  });
});

describe('resolveDashboardSubscription — состояния подписки', () => {
  it('подписки нет', () => {
    expect(resolve({ status: response(null) }).kind).toBe('none');
  });

  it('has_subscription=false перевешивает непустое поле subscription', () => {
    // Бэкенд может отдать объект с флагом false; главная обязана верить флагу,
    // иначе покажет карточку подписки тому, у кого её нет.
    expect(resolve({ status: { has_subscription: false, subscription: status() } }).kind).toBe(
      'none',
    );
  });

  it('активная подписка отдаёт дату, остаток дней и id', () => {
    expect(resolve()).toMatchObject({
      kind: 'active',
      subscription: {
        id: 7,
        endDate: '2026-09-01T00:00:00',
        daysLeft: 18,
        isTrial: false,
        isExpired: false,
        hasConnectionLink: true,
      },
    });
  });

  it('остаток дней берётся у бэкенда, а не пересчитывается', () => {
    // days_left считает бэкенд (app/database/models.py), и он единственный
    // знает про паузы суточного тарифа. Пересчёт по end_date дал бы своё число.
    const state = resolve({ status: response(status({ days_left: 3 })) });

    expect(state.kind === 'active' && state.subscription.daysLeft).toBe(3);
  });

  it('истёкшая подписка', () => {
    const state = resolve({
      status: response(status({ status: 'expired', is_active: false, is_expired: true })),
    });

    expect(state.kind).toBe('expired');
  });

  it('отключённая подписка (disabled) — тоже истёкшая', () => {
    expect(
      resolve({ status: response(status({ status: 'disabled', is_active: false })) }).kind,
    ).toBe('expired');
  });

  it('исчерпанный трафик (limited) — отдельное состояние, как в апстриме', () => {
    // Истечение по сроку и исчерпание трафика лечатся разными действиями:
    // первое — продлением, второе — покупкой пакета трафика. Апстрим их и
    // разделяет (SubscriptionCardExpired, ветка isLimited), решение владельца —
    // повторить это в простом режиме: докупить трафик можно прямо с главной.
    expect(
      resolve({
        status: response(status({ status: 'limited', is_active: false, is_limited: true })),
      }).kind,
    ).toBe('limited');
  });

  it('исчерпанный трафик перебивает истечение — действие важнее срока', () => {
    expect(
      resolve({
        status: response(
          status({ status: 'limited', is_active: false, is_limited: true, is_expired: true }),
        ),
      }).kind,
    ).toBe('limited');
  });

  it('ссылка подписки от панели переносится в состояние', () => {
    // По ней страница решает, показывать ли кнопку подключения: без ссылки
    // подключать нечего, и апстрим блок прячет.
    const withoutLink = resolve({ status: response(status({ subscription_url: null })) });

    expect(withoutLink.kind === 'active' && withoutLink.subscription.hasConnectionLink).toBe(false);
  });

  it('признаки триала и суточного тарифа переносятся из ответа', () => {
    const state = resolve({ status: response(status({ is_trial: true, is_daily: true })) });

    expect(state.kind === 'active' && state.subscription).toMatchObject({
      isTrial: true,
      isDaily: true,
    });
  });
});

describe('resolveRenewHref', () => {
  const sub = (
    overrides: Partial<Parameters<typeof resolveRenewHref>[0]> = {},
  ): Parameters<typeof resolveRenewHref>[0] => ({
    id: 7,
    endDate: '2026-09-01T00:00:00',
    daysLeft: 18,
    isTrial: false,
    isDaily: false,
    isExpired: false,
    isLimited: false,
    hasConnectionLink: true,
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

  it('истёкшая с исчерпанным трафиком — по-прежнему витрина', () => {
    expect(resolveRenewHref(sub({ isLimited: true, isExpired: true }))).toBe(
      '/subscription/purchase',
    );
  });
});

describe('resolveLimitedHref', () => {
  it('ведёт в витрину тарифов — единственное действие, доступное всегда', () => {
    // ⚠️ Здесь была ссылка на `/subscriptions/‹id›` под кнопкой «Докупить
    // трафик». Снята по наблюдению со стенда: блок докупки на странице
    // подписки у `limited` не отрисовывается, кнопка вела бы в тупик.
    // Окончательный состав состояния — за владельцем.
    expect(resolveLimitedHref()).toBe('/subscription/purchase');
  });
});

/**
 * Сторож против молчаливого расхождения копии.
 *
 * `resolveRenewHref` — копия правила адреса из апстримного
 * `src/components/subscription/purchaseCta.ts` (импортировать его простому
 * режиму нельзя, граница). Копия живёт до задачи #29, которой файл переедет к
 * нам. До тех пор апстрим может поменять правило, и разошлись бы мы молча:
 * сборка зелёная, кнопка ведёт не туда.
 *
 * Файл читается ТЕКСТОМ по той же причине, что и реестр в `routes.test.tsx`:
 * импорт потянул бы апстримный `types` через alias `@/`, которого нет в
 * `vitest.config.ts`.
 */
describe('копия правила адреса не разошлась с апстримным purchaseCta', () => {
  const source = readFileSync('src/components/subscription/purchaseCta.ts', 'utf8');

  it('исходник на месте — иначе сторож сверял бы пустоту', () => {
    expect(source).toContain('resolveSubscriptionCta');
  });

  it('витрина тарифов — тот же адрес', () => {
    expect(source).toContain("'/subscription/purchase'");
  });

  it('адрес продления собирается из id подписки', () => {
    expect(source).toContain('/subscriptions/${subscription.id}/renew');
  });

  it('ветки триала, суточного тарифа и отсутствия id никуда не делись', () => {
    expect(source).toContain('subscription.is_trial');
    expect(source).toContain('subscription.is_daily');
    expect(source).toContain('!subscription.id');
  });
});
