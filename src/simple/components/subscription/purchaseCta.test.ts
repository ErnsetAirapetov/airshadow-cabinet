import { describe, expect, it } from 'vitest';
import { resolveSubscriptionCta } from './purchaseCta';
import type { Subscription } from '@/types';

/**
 * Раскладка кнопок на карточке подписки (задача cabinet#19). Логика вынесена в
 * чистую функцию именно ради этого теста: компонентных тестов в репе нет
 * (ни jsdom, ни testing-library), а промахнуться ссылкой «Продлить» → витрина
 * уже один раз получилось.
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

describe('resolveSubscriptionCta', () => {
  it('активная платная подписка — две кнопки: продление и смена тарифа', () => {
    const actions = resolveSubscriptionCta(sub());

    expect(actions.map((a) => a.kind)).toEqual(['renew', 'change']);

    const [renew, change] = actions;
    expect(renew).toMatchObject({
      to: '/subscriptions/7/renew',
      tone: 'accent',
      labelKey: 'subscription.extend',
      hintKey: 'subscription.cta.renewHint',
    });
    expect(change).toMatchObject({
      to: '/subscription/purchase',
      tone: 'subtle',
      labelKey: 'subscription.switchTariff.title',
      hintKey: 'subscription.cta.changeHint',
    });
  });

  it('limited-подписка ведёт себя как активная — обе кнопки на месте', () => {
    const actions = resolveSubscriptionCta(sub({ is_active: false, is_limited: true }));

    expect(actions.map((a) => a.kind)).toEqual(['renew', 'change']);
    expect(actions[0]?.to).toBe('/subscriptions/7/renew');
  });

  it('триал — одна кнопка в витрину: продлевать нечего', () => {
    const actions = resolveSubscriptionCta(sub({ is_trial: true }));

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: 'purchase',
      to: '/subscription/purchase',
      tone: 'accent',
      labelKey: 'subscription.trialUpgrade.title',
      hintKey: 'subscription.cta.trialHint',
    });
  });

  it('истёкшая подписка — одна кнопка покупки с критическим акцентом', () => {
    const actions = resolveSubscriptionCta(sub({ is_active: false, is_expired: true }));

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: 'purchase',
      to: '/subscription/purchase',
      tone: 'critical',
      labelKey: 'subscription.getSubscription',
      hintKey: 'subscription.cta.expiredHint',
    });
  });

  it('подписки нет вовсе — та же кнопка покупки', () => {
    const actions = resolveSubscriptionCta(null);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'purchase', tone: 'critical' });
  });

  it('суточный тариф — продления нет (списывается сам), остаётся смена тарифа', () => {
    const actions = resolveSubscriptionCta(sub({ is_daily: true }));

    expect(actions.map((a) => a.kind)).toEqual(['change']);
    expect(actions[0]).toMatchObject({
      to: '/subscription/purchase',
      labelKey: 'subscription.switchTariff.title',
      hintKey: 'subscription.cta.dailyHint',
    });
  });

  it('истёкший суточный тариф — обычная кнопка покупки, а не смена тарифа', () => {
    const actions = resolveSubscriptionCta(sub({ is_daily: true, is_active: false }));

    expect(actions.map((a) => a.kind)).toEqual(['purchase']);
    expect(actions[0]?.tone).toBe('critical');
  });

  it('без id подписки ссылку на продление не строим', () => {
    const actions = resolveSubscriptionCta(sub({ id: 0 }));

    expect(actions.map((a) => a.kind)).toEqual(['change']);
  });
});
