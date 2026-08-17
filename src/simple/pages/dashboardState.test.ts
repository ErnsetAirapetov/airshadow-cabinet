import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Subscription, SubscriptionStatusResponse } from '@/types';
import {
  resolveDashboardSubscription,
  resolveExpiredCardAction,
  resolveRenewHref,
  resolveTimeLeftDisplay,
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

  it('активная подписка отдаётся карточке как есть, без своего view-типа', () => {
    // Карточки простого режима — копии апстримных и принимают `Subscription`.
    // Промежуточный тип означал бы конвертацию туда-обратно на каждой карточке.
    expect(resolve()).toMatchObject({
      kind: 'active',
      subscription: { id: 7, end_date: '2026-09-01T00:00:00', days_left: 18 },
    });
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

  it('приостановленная подписка (limited) — отдельное состояние', () => {
    // Отдельное от истечения: срок ещё идёт, дата остаётся правдой, а доступ
    // не работает. Апстримная карточка истёкшей подписки различает эти случаи
    // сама (ветка `isLimited`), поэтому состояние доезжает до неё отдельным.
    expect(
      resolve({
        status: response(status({ status: 'limited', is_active: false, is_limited: true })),
      }).kind,
    ).toBe('limited');
  });

  it('приостановка перебивает истечение — состояния не сливаем', () => {
    expect(
      resolve({
        status: response(
          status({ status: 'limited', is_active: false, is_limited: true, is_expired: true }),
        ),
      }).kind,
    ).toBe('limited');
  });

  it('подписка доезжает целиком — карточке нужны и трафик, и лимит устройств', () => {
    const state = resolve({ status: response(status({ subscription_url: null })) });

    expect(state.kind === 'active' && state.subscription).toMatchObject({
      subscription_url: null,
      traffic_limit_gb: 100,
      device_limit: 3,
    });
  });
});

describe('resolveTimeLeftDisplay', () => {
  const sub = status;

  it('больше суток осталось — дни', () => {
    expect(resolveTimeLeftDisplay(sub({ days_left: 5, hours_left: 10, minutes_left: 0 }))).toEqual({
      value: 5,
      unit: 'days',
    });
  });

  it('последние сутки — часы (#34)', () => {
    expect(resolveTimeLeftDisplay(sub({ days_left: 0, hours_left: 8, minutes_left: 40 }))).toEqual({
      value: 8,
      unit: 'hours',
    });
  });

  it('последний час — минуты, а не «0 ч.» (#38)', () => {
    // Бэкенд обнуляет hours_left в последний час так же, как обнулял days_left в
    // последние сутки (#34) — то же округление вниз. Плитка показывала бы «0 ч.»
    // живой подписке, которой осталось меньше часа.
    expect(resolveTimeLeftDisplay(sub({ days_left: 0, hours_left: 0, minutes_left: 45 }))).toEqual({
      value: 45,
      unit: 'minutes',
    });
  });

  it('последняя минута — 0 минут, не более ранняя единица', () => {
    expect(resolveTimeLeftDisplay(sub({ days_left: 0, hours_left: 0, minutes_left: 0 }))).toEqual({
      value: 0,
      unit: 'minutes',
    });
  });
});

describe('resolveExpiredCardAction — одна кнопка вместо развилки (#49)', () => {
  it('баланса нет — пополнение', () => {
    expect(
      resolveExpiredCardAction({ hasBalance: false, renewFailedInsufficientBalance: false }),
    ).toBe('topUp');
  });

  it('баланс есть — продление', () => {
    expect(
      resolveExpiredCardAction({ hasBalance: true, renewFailedInsufficientBalance: false }),
    ).toBe('renew');
  });

  it('продление отказало по нехватке средств — пополнение, даже если hasBalance true', () => {
    // Грубая проверка `hasBalance` (порог «есть хоть рубль») пропускает случай,
    // когда денег меньше цены продления. Реальный отказ бэкенда обязан
    // перебивать её — иначе кнопка «Продлить» осталась бы висеть без действия.
    expect(
      resolveExpiredCardAction({ hasBalance: true, renewFailedInsufficientBalance: true }),
    ).toBe('topUp');
  });
});

describe('resolveRenewHref', () => {
  const sub = status;

  it('платная живая подписка ведёт на страницу продления', () => {
    expect(resolveRenewHref(sub())).toBe('/subscriptions/7/renew');
  });

  it('триал продлевать нечего — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ is_trial: true }))).toBe('/subscription/purchase');
  });

  it('суточный тариф списывается сам — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ is_daily: true }))).toBe('/subscription/purchase');
  });

  it('истёкшая подписка — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ is_active: false, is_expired: true }))).toBe(
      '/subscription/purchase',
    );
  });

  it('без id ссылку на продление не собрать — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ id: 0 }))).toBe('/subscription/purchase');
  });

  it('истёкшая с исчерпанным трафиком — по-прежнему витрина', () => {
    expect(resolveRenewHref(sub({ is_limited: true, is_expired: true }))).toBe(
      '/subscription/purchase',
    );
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

/**
 * Сторож против молчаливого расхождения правила «часы/минуты вместо нуля».
 *
 * `resolveTimeLeftDisplay` заимствует приём у апстримного
 * `src/pages/Subscription.tsx` (~ строка 881, блок инфо о триале): при
 * `days_left <= 0` бэкенд округляет дни вниз, и там же в последний час
 * `hours_left` тоже обнуляется — апстрим в этом случае показывает `minutes_left`.
 * Правило одно, второе (своё) не заводим (#38). Апстрим может поменять его
 * молча: сборка останется зелёной, а плитка снова покажет «0 ч.».
 *
 * Файл читается ТЕКСТОМ по той же причине, что и сторож `purchaseCta` выше:
 * импорт потянул бы апстримный граф через alias `@/`, которого нет в
 * `vitest.config.ts`.
 */
describe('правило часы/минуты не разошлось с апстримным Subscription.tsx', () => {
  const source = readFileSync('src/pages/Subscription.tsx', 'utf8');

  it('исходник на месте — иначе сторож сверял бы пустоту', () => {
    expect(source).toContain('subscription.days_left > 0');
  });

  it('в последние сутки апстрим показывает часы и минуты, а не дни', () => {
    expect(source).toContain('subscription.hours_left');
    expect(source).toContain("t('subscription.hours')");
  });

  it('минуты остаются запасной единицей, когда часы тоже обнулились', () => {
    expect(source).toContain('subscription.minutes_left');
    expect(source).toContain("t('subscription.minutes')");
  });
});
