import { describe, expect, it } from 'vitest';
import { resolveSubscriptionCta, resolveTariffChangeOption } from './purchaseCta';
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
  it('активная платная подписка — одна кнопка продления', () => {
    // ⚠️ Смена тарифа отсюда УЕХАЛА в блок «Дополнительные опции» (#61):
    // владелец забраковал её вид второстепенной кнопкой. Пропасть она при этом
    // не должна — парная проверка ниже, через `resolveTariffChangeOption`.
    const actions = resolveSubscriptionCta(sub());

    expect(actions.map((a) => a.kind)).toEqual(['renew']);
    expect(actions[0]).toMatchObject({
      to: '/subscriptions/7/renew',
      tone: 'accent',
      labelKey: 'subscription.extend',
      hintKey: 'subscription.cta.renewHint',
    });
  });

  it('у активной платной смена тарифа приходит пунктом блока, а не пропадает', () => {
    expect(resolveTariffChangeOption(sub())).toMatchObject({
      kind: 'change',
      to: '/subscription/purchase',
      labelKey: 'subscription.switchTariff.title',
      hintKey: 'subscription.cta.changeHint',
    });
  });

  it('limited-подписка ведёт себя как активная', () => {
    const limited = sub({ is_active: false, is_limited: true });

    expect(resolveSubscriptionCta(limited).map((a) => a.kind)).toEqual(['renew']);
    expect(resolveSubscriptionCta(limited)[0]?.to).toBe('/subscriptions/7/renew');
    expect(resolveTariffChangeOption(limited)?.kind).toBe('change');
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

/**
 * Пункт «Сменить тариф» в блоке «Дополнительные опции» (задача #61).
 *
 * ⚠️ Правило ОДНО и живёт здесь же: `resolveTariffChangeOption` и
 * `resolveSubscriptionCta` считают один и тот же набор действий и делят его.
 * Второе правило «когда показывать пункт» разъехалось бы с первым молча — это
 * ровно та ошибка, из-за которой разошлись две копии кнопки подключения.
 */
describe('resolveTariffChangeOption', () => {
  it('переезжает только то, что было ВТОРОСТЕПЕННЫМ действием', () => {
    // У активной платной смена тарифа стояла второй кнопкой под продлением —
    // её и просили перенести.
    expect(resolveTariffChangeOption(sub())).not.toBeNull();
  });

  it('суточный тариф — смена остаётся кнопкой, пункта блока нет', () => {
    // ⚠️ Единственное действие экрана второстепенным не бывает: у суточной
    // подписки продления нет вовсе, и смена тарифа — единственный способ
    // что-то сделать. Переезд задвоил бы её (кнопка + пункт).
    const daily = sub({ is_daily: true });

    expect(resolveSubscriptionCta(daily).map((a) => a.kind)).toEqual(['change']);
    expect(resolveTariffChangeOption(daily)).toBeNull();
  });

  it('подписка без id — смена тоже остаётся кнопкой', () => {
    const noId = sub({ id: 0 });

    expect(resolveSubscriptionCta(noId).map((a) => a.kind)).toEqual(['change']);
    expect(resolveTariffChangeOption(noId)).toBeNull();
  });

  it('триал, истёкшая и отсутствующая подписка пункта не получают', () => {
    // Смены тарифа у них нет и в кнопках: там оформление с нуля.
    expect(resolveTariffChangeOption(sub({ is_trial: true }))).toBeNull();
    expect(resolveTariffChangeOption(sub({ is_active: false, is_expired: true }))).toBeNull();
    expect(resolveTariffChangeOption(null)).toBeNull();
  });

  it('адрес пункта — тот же, что у прежней кнопки', () => {
    // Спека: вести должна туда же, куда ведёт сейчас, и адрес брать из
    // существующего правила, а не писать второй раз.
    expect(resolveTariffChangeOption(sub())?.to).toBe('/subscription/purchase');
  });
});
