import { describe, expect, it } from 'vitest';
import { resolveSubscriptionCta } from '../components/subscription/purchaseCta';
import { resolveAdditionalOptions } from './subscriptionState';
import type { Subscription } from '@/types';

/**
 * Критерий приёмки #61: смена тарифа не пропала и не задвоилась НИ У ОДНОГО
 * состояния подписки.
 *
 * ⚠️ Зачем отдельный файл. Переезд «Сменить тариф» из кнопок в блок
 * «Дополнительные опции» разводит одно действие по двум независимым условиям:
 * кнопки решает `resolveSubscriptionCta`, блок — `resolveAdditionalOptions`.
 * Ровно на таком разведении задача и застряла: блок не показывался при
 * `device_limit === 0`, и безлимитный по устройствам пользователь терял смену
 * тарифа целиком. Проверять это глазами по состояниям нельзя — состояний
 * сотни, поэтому здесь перебор, а не примеры.
 *
 * ⚠️ Эталон «как было ДО #61» записан НЕЗАВИСИМОЙ функцией, а не взят из
 * рабочего кода: сравнение кода с самим собой доказывало бы только то, что он
 * себе равен. Формула эталона выведена из прежнего `resolveSubscriptionCta`:
 * действие `change` он отдавал ровно при «не истекла и не триал» — истёкшая и
 * триал уходили в ветки оформления с нуля, а суточная и подписка без id
 * получали `change` единственным действием.
 */

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 7,
    status: 'active',
    is_trial: false,
    start_date: '2026-08-01T00:00:00',
    end_date: '2026-09-01T00:00:00',
    days_left: 19,
    hours_left: 0,
    minutes_left: 0,
    time_left_display: '19 дней',
    traffic_limit_gb: 100,
    traffic_used_gb: 1,
    traffic_used_percent: 1,
    device_limit: 3,
    connected_squads: [],
    servers: [],
    autopay_enabled: false,
    autopay_days_before: 3,
    subscription_url: null,
    hide_subscription_link: false,
    is_active: true,
    is_expired: false,
    is_limited: false,
    ...overrides,
  };
}

/** Смена тарифа была доступна ДО #61 — независимый эталон, см. докстринг. */
function wasReachableBefore(subscription: Subscription | null): boolean {
  if (!subscription) return false;
  const isExpired = !subscription.is_active && !subscription.is_trial && !subscription.is_limited;
  return !isExpired && !subscription.is_trial;
}

/** Сколько мест ведут на смену тарифа СЕЙЧАС: кнопка плюс пункт блока. */
function reachableNow(subscription: Subscription | null, isTariffsMode: boolean): number {
  const asButton = resolveSubscriptionCta(subscription).filter(
    (action) => action.kind === 'change',
  ).length;
  const options = resolveAdditionalOptions(subscription, isTariffsMode);
  const asOption = options.visible && options.tariffChange !== null ? 1 : 0;
  return asButton + asOption;
}

/** Все состояния подписки, которые влияют хоть на одно из двух условий. */
const STATES: { name: string; subscription: Subscription | null; isTariffsMode: boolean }[] = [];

for (const isActive of [true, false]) {
  for (const isLimited of [true, false]) {
    for (const isTrial of [true, false]) {
      for (const isDaily of [true, false]) {
        for (const id of [7, 0]) {
          for (const deviceLimit of [0, 1, 5, 20]) {
            for (const trafficLimitGb of [0, 50]) {
              for (const isTariffsMode of [true, false]) {
                STATES.push({
                  name: `active=${isActive} limited=${isLimited} trial=${isTrial} daily=${isDaily} id=${id} devices=${deviceLimit} traffic=${trafficLimitGb} tariffsMode=${isTariffsMode}`,
                  subscription: sub({
                    is_active: isActive,
                    is_limited: isLimited,
                    is_trial: isTrial,
                    is_daily: isDaily,
                    id,
                    device_limit: deviceLimit,
                    traffic_limit_gb: trafficLimitGb,
                  }),
                  isTariffsMode,
                });
              }
            }
          }
        }
      }
    }
  }
}

STATES.push({ name: 'подписки нет вовсе', subscription: null, isTariffsMode: false });

describe('разбор удался', () => {
  it('перебор состояний собран и покрывает обе стороны эталона', () => {
    // Без этого пустой перебор дал бы вечно зелёные проверки ниже.
    expect(STATES.length).toBeGreaterThan(100);
    expect(STATES.some(({ subscription }) => wasReachableBefore(subscription))).toBe(true);
    expect(STATES.some(({ subscription }) => !wasReachableBefore(subscription))).toBe(true);
  });

  it('в переборе есть оба спорных состояния', () => {
    // Именно на них задача и застряла: безлимит по устройствам (блока не было)
    // и суточный тариф (смена тарифа — единственное действие).
    const unlimitedDevices = STATES.filter(
      ({ subscription }) =>
        subscription?.device_limit === 0 &&
        wasReachableBefore(subscription) &&
        !subscription.is_daily,
    );
    const daily = STATES.filter(
      ({ subscription }) => subscription?.is_daily && wasReachableBefore(subscription),
    );

    expect(unlimitedDevices.length).toBeGreaterThan(0);
    expect(daily.length).toBeGreaterThan(0);
  });
});

describe('смена тарифа: ни потери, ни дубля — ни в одном состоянии (#61)', () => {
  it('доступна ровно там же, где была до переезда', () => {
    // Мутация «вернуть `device_limit !== 0` во внешнее условие блока» красит
    // этот тест на безлимитных по устройствам.
    for (const { name, subscription, isTariffsMode } of STATES) {
      const before = wasReachableBefore(subscription);
      const now = reachableNow(subscription, isTariffsMode) > 0;

      expect(`${name}: ${now}`).toBe(`${name}: ${before}`);
    }
  });

  it('нигде не задваивается — не бывает и кнопки, и пункта сразу', () => {
    // Мутация «отдавать пункт блока всегда, когда есть действие change»
    // красит этот тест на суточном тарифе и на подписке без id.
    for (const { name, subscription, isTariffsMode } of STATES) {
      const places = reachableNow(subscription, isTariffsMode);

      expect(`${name}: ${places}`).toBe(`${name}: ${places > 1 ? 'ДУБЛЬ' : places}`);
      expect(places).toBeLessThanOrEqual(1);
    }
  });

  it('у безлимита по устройствам смена тарифа приходит пунктом блока', () => {
    // Именно этот пользователь терял её при буквальном прочтении спеки: блок
    // «Дополнительные опции» при `device_limit === 0` не показывался вовсе.
    const options = resolveAdditionalOptions(sub({ device_limit: 0 }), false);

    expect(options.visible).toBe(true);
    expect(options.tariffChange?.to).toBe('/subscription/purchase');
    expect(options.deviceTopup).toBe(false);
    expect(options.deviceReduction).toBe(false);
  });

  it('у суточного тарифа смена тарифа остаётся кнопкой и в блок не попадает', () => {
    const daily = sub({ is_daily: true });

    expect(resolveSubscriptionCta(daily).map((action) => action.kind)).toEqual(['change']);
    expect(resolveAdditionalOptions(daily, false).tariffChange).toBeNull();
  });
});
