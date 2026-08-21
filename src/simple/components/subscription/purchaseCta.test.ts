import { describe, expect, it } from 'vitest';
import {
  PURCHASE_ROUTE,
  isExpiredPaidSubscription,
  paymentRoute,
  resolveSubscriptionCta,
  resolveTariffChangeOption,
  type SubscriptionCtaKind,
} from './purchaseCta';
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

  it('истёкшая платная подписка — кнопок здесь нет вовсе (#65)', () => {
    // ⚠️ Спека владельца: у истёкшей платной подписки на экране ОДНА кнопка —
    // «Продлить подписку» либо «Пополнить баланс», как на главной. Считает её
    // общий блок `ExpiredSubscriptionAction`, поэтому здесь действий нет: иначе
    // рядом с ней встала бы вторая, «Оформить подписку» в витрину.
    expect(resolveSubscriptionCta(sub({ is_active: false, is_expired: true }))).toEqual([]);
    expect(resolveSubscriptionCta(sub({ is_active: false, status: 'expired' }))).toEqual([]);
  });

  it('подписки нет вовсе — «Оформить подписку» с критическим акцентом', () => {
    // ⚠️ Второй случай прежней склейки, и он остался прежним: продлевать нечего
    // (подписки нет, `id` нет), и единственный маршрут вперёд — витрина.
    const actions = resolveSubscriptionCta(null);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: 'purchase',
      to: '/subscription/purchase',
      tone: 'critical',
      labelKey: 'subscription.getSubscription',
      hintKey: 'subscription.cta.expiredHint',
    });
  });

  it('истёкшая подписка и отсутствие подписки — РАЗНЫЕ случаи (#65)', () => {
    // Мутация «склеить их обратно одним условием» красит этот тест с любой
    // стороны: у истёкшей появится кнопка витрины, у отсутствующей пропадёт
    // единственное действие экрана.
    expect(resolveSubscriptionCta(null)).not.toEqual(
      resolveSubscriptionCta(sub({ is_active: false, is_expired: true })),
    );
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

  it('истёкший суточный тариф — кнопок нет: он тоже истёкшая платная (#65)', () => {
    // Смены тарифа здесь не было и до #65 (истёкшая уходила в оформление с
    // нуля), а оформление уехало в общий блок вместе с остальными истёкшими:
    // суточный продлевается покупкой одного дня, а не витриной.
    expect(resolveSubscriptionCta(sub({ is_daily: true, is_active: false }))).toEqual([]);
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

/* ══════════════════════════════════════════════════════════════════════════
 * Свойство разделения набора действий (#61, сохраняется при разводе ветки
 * «истекла» в #65).
 *
 * ⚠️ Зачем перебор, а не примеры. `resolveAllSubscriptionActions` —
 * единственный источник истины для двух потребителей, и они делят его набор:
 * `resolveSubscriptionCta` отдаёт кнопки, `resolveTariffChangeOption` — пункт
 * блока «Дополнительные опции». Разъедься дележ — действие либо задвоится
 * (кнопка И пункт), либо пропадёт у того, у кого было. Ни то, ни другое не
 * видно ни сборке, ни типам, а состояний подписки — сотни.
 *
 * ⚠️ Эталон набора записан НЕЗАВИСИМОЙ функцией: сравнение выдачи с самой
 * собой доказывало бы только то, что она себе равна. Формула — прямая запись
 * докстринга `resolveAllSubscriptionActions`.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Полный набор действий — независимый эталон, см. блок выше. */
function expectedActionKinds(subscription: Subscription | null): SubscriptionCtaKind[] {
  // Подписки нет вовсе — продлевать нечего, только оформление с нуля.
  if (!subscription) return ['purchase'];
  // Подписка есть и истекла — действие считает общий блок (#65).
  if (!subscription.is_active && !subscription.is_trial && !subscription.is_limited) return [];
  // Триал продлить нельзя — из него выходят на платный тариф.
  if (subscription.is_trial) return ['purchase'];
  // Суточный списывается сам, подписку без id нечем продлевать.
  if (subscription.is_daily || !subscription.id) return ['change'];
  return ['renew', 'change'];
}

const ALL_STATES: { name: string; subscription: Subscription | null }[] = [];

for (const isActive of [true, false]) {
  for (const isLimited of [true, false]) {
    for (const isTrial of [true, false]) {
      for (const isDaily of [true, false]) {
        for (const id of [7, 0]) {
          for (const status of ['active', 'expired', 'disabled']) {
            ALL_STATES.push({
              name: `active=${isActive} limited=${isLimited} trial=${isTrial} daily=${isDaily} id=${id} status=${status}`,
              subscription: sub({
                is_active: isActive,
                is_limited: isLimited,
                is_trial: isTrial,
                is_daily: isDaily,
                id,
                status,
              }),
            });
          }
        }
      }
    }
  }
}

ALL_STATES.push({ name: 'подписки нет вовсе', subscription: null });

/** Что видит пользователь: кнопки плюс пункт блока, если он есть. */
function reachableKinds(subscription: Subscription | null): SubscriptionCtaKind[] {
  const buttons = resolveSubscriptionCta(subscription).map((action) => action.kind);
  const option = resolveTariffChangeOption(subscription);

  return option === null ? buttons : [...buttons, option.kind];
}

describe('разбор удался', () => {
  it('перебор состояний собран и покрывает все ветки эталона', () => {
    // Без этого пустой перебор дал бы вечно зелёные проверки ниже.
    expect(ALL_STATES.length).toBeGreaterThan(50);

    const shapes = new Set(
      ALL_STATES.map(({ subscription }) => expectedActionKinds(subscription).join('+')),
    );

    expect([...shapes].sort()).toEqual(['', 'change', 'purchase', 'renew+change']);
  });
});

describe('выдачи двух потребителей делят набор: пересечение пусто, сумма = набор', () => {
  it('сумма выдач равна полному набору в каждом состоянии', () => {
    // Мутация «вернуть истёкшей кнопку витрины» красит здесь: сумма станет
    // `purchase` там, где эталон пуст.
    for (const { name, subscription } of ALL_STATES) {
      const expected = [...expectedActionKinds(subscription)].sort();
      const reachable = [...reachableKinds(subscription)].sort();

      expect(`${name}: ${reachable.join('+')}`).toBe(`${name}: ${expected.join('+')}`);
    }
  });

  it('пересечение выдач пусто — ни одно действие не выдаётся дважды', () => {
    // Мутация «перестать вычитать переехавший пункт из кнопок» красит здесь на
    // активной платной подписке: `change` придёт и кнопкой, и пунктом.
    for (const { name, subscription } of ALL_STATES) {
      const buttons = resolveSubscriptionCta(subscription).map((action) => action.kind);
      const option = resolveTariffChangeOption(subscription);
      const overlap = option === null ? [] : buttons.filter((kind) => kind === option.kind);

      expect(`${name}: ${overlap.join('+')}`).toBe(`${name}: `);
    }
  });

  it('истёкшая платная нигде не получает ни кнопки, ни пункта (#65)', () => {
    const expired = ALL_STATES.filter(
      ({ subscription }) =>
        subscription !== null &&
        !subscription.is_active &&
        !subscription.is_trial &&
        !subscription.is_limited,
    );

    // Пара: состояния такого вида в переборе есть, иначе проверка пустая.
    expect(expired.length).toBeGreaterThan(0);

    for (const { name, subscription } of expired) {
      expect(`${name}: ${reachableKinds(subscription).length}`).toBe(`${name}: 0`);
    }
  });
});

describe('isExpiredPaidSubscription: правило «истекла» — одно на весь простой режим (#65)', () => {
  it('истёкшая платная подписка', () => {
    expect(isExpiredPaidSubscription(sub({ is_active: false, is_expired: true }))).toBe(true);
    expect(isExpiredPaidSubscription(sub({ is_active: false, is_daily: true }))).toBe(true);
  });

  it('подписки нет — это НЕ истёкшая подписка', () => {
    // ⚠️ Ровно та склейка, которую разводит #65: продлевать в этом случае
    // нечего, и общему блоку действия нечего показывать.
    expect(isExpiredPaidSubscription(null)).toBe(false);
  });

  it('активная, limited и триал — не истёкшие', () => {
    expect(isExpiredPaidSubscription(sub())).toBe(false);
    expect(isExpiredPaidSubscription(sub({ is_active: false, is_limited: true }))).toBe(false);
    expect(isExpiredPaidSubscription(sub({ is_active: false, is_trial: true }))).toBe(false);
  });
});

describe('paymentRoute: адрес единого экрана оплаты (#69)', () => {
  it('строится по идентификатору подписки', () => {
    expect(paymentRoute(7)).toBe('/subscriptions/7/renew');
    expect(paymentRoute(1042)).toBe('/subscriptions/1042/renew');
  });

  it('это апстримный адрес, а не новый маршрут', () => {
    // ⚠️ Задача явно запрещает заводить третий адрес: реестр простого режима
    // держит ровно `/subscriptions/:subscriptionId/renew`, и сторож покрытия
    // сверяет его с `App.tsx`. Мутация «завести /subscription/pay» краснеет
    // здесь ещё до `routes.test.tsx`.
    expect(paymentRoute(7).startsWith('/subscriptions/')).toBe(true);
    expect(paymentRoute(7).endsWith('/renew')).toBe(true);
    expect(paymentRoute(7)).not.toBe(PURCHASE_ROUTE);
  });

  it('кнопка продления активной подписки строится ЭТОЙ ЖЕ функцией', () => {
    // ⚠️ Второй вход на тот же экран — `expiredAction.ts`, ветка `openPurchase`.
    // Совпадение адресов и есть предмет #69: два экрана оплаты владелец
    // забраковал. Литерал вместо вызова здесь краснеет.
    const renew = resolveSubscriptionCta(sub()).find((action) => action.kind === 'renew');

    expect(renew?.to).toBe(paymentRoute(sub().id));
  });
});
