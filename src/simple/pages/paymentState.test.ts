import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NON_RENEWABLE_STATUSES } from '../components/subscription/expiredAction';
import {
  isPayableTariff,
  resolvePaymentPlan,
  resolvePaymentTitleKey,
  resolvePeriodPrice,
} from './paymentState';
import type { RenewalOption, Subscription, Tariff, TariffPeriod } from '@/types';

/**
 * Единый экран оплаты подписки (задача #69).
 *
 * ⚠️ Этот перебор — ЕДИНСТВЕННЫЙ способ проверить задачу. Состояние «тариф
 * отвалился» на стенде воспроизвести нечем: учётки под него нет, владелец
 * заводит её отдельно. Значит глазами ветку не увидит никто, и каждая проверка
 * ниже доказана мутацией в описании.
 *
 * ⚠️ Модуль импортируется НАПРЯМУЮ: из `@/types` он берёт только типы, а
 * `import type` стирается при трансформации — alias `@/` тесту не нужен
 * (docs/architecture/two-modes.md, раздел «Тесты»).
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
    tariff_id: 11,
    ...overrides,
  };
}

function period(overrides: Partial<TariffPeriod> = {}): TariffPeriod {
  return {
    days: 30,
    months: 1,
    label: '1 месяц',
    price_kopeks: 30_000,
    price_label: '300 ₽',
    price_per_month_kopeks: 30_000,
    price_per_month_label: '300 ₽',
    ...overrides,
  };
}

function tariff(overrides: Partial<Tariff> = {}): Tariff {
  return {
    id: 11,
    name: 'Базовый',
    description: null,
    tier_level: 1,
    traffic_limit_gb: 100,
    traffic_limit_label: '100 ГБ',
    is_unlimited_traffic: false,
    device_limit: 3,
    extra_devices_count: 0,
    servers_count: 2,
    servers: [],
    periods: [period(), period({ days: 90, months: 3, price_kopeks: 81_000 })],
    is_current: true,
    is_available: true,
    ...overrides,
  };
}

function renewalOption(overrides: Partial<RenewalOption> = {}): RenewalOption {
  return {
    period_days: 30,
    price_kopeks: 29_000,
    price_rubles: 290,
    discount_percent: 0,
    original_price_kopeks: null,
    ...overrides,
  };
}

const CATALOG = [tariff()];
const OPTIONS = [renewalOption(), renewalOption({ period_days: 90, price_kopeks: 78_000 })];

describe('isPayableTariff: чем вообще можно оплатить свой тариф (#69)', () => {
  it('тариф из каталога с периодами годится', () => {
    expect(isPayableTariff(tariff())).toBe(true);
  });

  it('тарифа в каталоге нет — платить нечем', () => {
    // Ровно случай «тариф больше не поддерживается»: подписка на него есть,
    // а в выдаче `purchase-options` его уже нет.
    expect(isPayableTariff(undefined)).toBe(false);
    expect(isPayableTariff(null)).toBe(false);
  });

  it('неактивный тариф не годится', () => {
    // ⚠️ `is_available` бэкенд заполняет из `tariff.is_active`
    // (`purchase.py:247`), то есть это ровно тот флаг, по которому тариф скрыт.
    expect(isPayableTariff(tariff({ is_available: false }))).toBe(false);
  });

  it('тариф без периодов не годится', () => {
    // ⚠️ `periods` собираются из `period_prices` тарифа (`purchase.py:120-121`).
    // Пустые — покупать нечего, и `renewal-options` в этом состоянии отдаёт
    // стандартные периоды настроек, а не тарифные (`renewal.py:60-70`).
    expect(isPayableTariff(tariff({ periods: [] }))).toBe(false);
  });
});

describe('resolvePaymentTitleKey: заголовок один на обе операции (#69)', () => {
  it('продление и покупка своего тарифа подписаны ОДИНАКОВО', () => {
    // ⚠️ Критерий приёмки: экран выглядит одинаково для активной и истёкшей.
    // Мутация «подписать покупку иначе» вернула бы два экрана на одном адресе
    // и краснеет здесь.
    const renew = resolvePaymentPlan({
      subscription: sub(),
      renewalOptions: OPTIONS,
      tariffs: CATALOG,
      isTariffsMode: true,
    });
    const purchase = resolvePaymentPlan({
      subscription: sub({ status: 'disabled' }),
      renewalOptions: [],
      tariffs: CATALOG,
      isTariffsMode: true,
    });

    expect(resolvePaymentTitleKey(renew)).toBe('subscription.extend');
    expect(resolvePaymentTitleKey(purchase)).toBe(resolvePaymentTitleKey(renew));
  });

  it('выбор тарифа подписан иначе — оплачивать там пока нечего', () => {
    expect(resolvePaymentTitleKey({ screen: 'pickTariff', unsupportedTariffBanner: true })).toBe(
      'subscription.getSubscription',
    );
  });

  it('оба ключа апстримные и заведены в апстримной локали', () => {
    // ⚠️ Пара «разбор удался» для ключей: опечатка напечатала бы на экране сам
    // ключ, молча и при зелёной сборке.
    const upstreamRu = JSON.parse(readFileSync('src/locales/ru.json', 'utf8')) as {
      subscription: Record<string, unknown>;
    };

    expect(upstreamRu.subscription.extend).toBeTruthy();
    expect(upstreamRu.subscription.getSubscription).toBeTruthy();
  });
});

describe('resolvePeriodPrice: промо-скидка подмешивается ровно один раз (#69)', () => {
  it('без промо цена периода остаётся как есть', () => {
    expect(
      resolvePeriodPrice(
        { periodDays: 30, priceKopeks: 30_000, discountPercent: 10, originalPriceKopeks: 33_000 },
        null,
      ),
    ).toEqual({ priceKopeks: 30_000, originalPriceKopeks: 33_000, discountPercent: 10 });
  });

  it('с промо цена берётся из промо, а не из периода', () => {
    expect(
      resolvePeriodPrice(
        { periodDays: 30, priceKopeks: 30_000, discountPercent: 0, originalPriceKopeks: null },
        { price: 27_000, original: 30_000, percent: 10 },
      ),
    ).toEqual({ priceKopeks: 27_000, originalPriceKopeks: 30_000, discountPercent: 10 });
  });

  it('промо без скидки не стирает скидку промо-группы', () => {
    // `applyPromoDiscount` отдаёт `original: null, percent: null`, когда
    // активного оффера нет. Затри мы этим скидку каталога — на экране пропала
    // бы зачёркнутая цена, которую человек видит в форме покупки.
    expect(
      resolvePeriodPrice(
        { periodDays: 30, priceKopeks: 24_000, discountPercent: 20, originalPriceKopeks: 30_000 },
        { price: 24_000, original: null, percent: null },
      ),
    ).toEqual({ priceKopeks: 24_000, originalPriceKopeks: 30_000, discountPercent: 20 });
  });
});

describe('resolvePaymentPlan: продлеваемый статус платит продлением (#69)', () => {
  it('активная подписка — цены из renewal-options, операция renew', () => {
    const plan = resolvePaymentPlan({
      subscription: sub(),
      renewalOptions: OPTIONS,
      tariffs: CATALOG,
      isTariffsMode: true,
    });

    expect(plan).toMatchObject({
      screen: 'periods',
      operation: 'renew',
      source: 'renewalOptions',
      promoDiscountable: false,
    });
    expect(plan.screen === 'periods' && plan.periods).toEqual([
      { periodDays: 30, priceKopeks: 29_000, discountPercent: 0, originalPriceKopeks: null },
      { periodDays: 90, priceKopeks: 78_000, discountPercent: 0, originalPriceKopeks: null },
    ]);
  });

  it('истёкшая подписка платит ТЕМ ЖЕ способом, что активная', () => {
    // ⚠️ Критерий приёмки владельца дословно: «для пользователя без разницы,
    // продлевает он истёкшую или докупает действующую». Статус `expired` в
    // `NON_RENEWABLE_STATUSES` не входит (`renewal.py:130-136`), и продление
    // ему разрешено — мутация «считать истёкшую непродлеваемой» краснеет здесь.
    const expired = resolvePaymentPlan({
      subscription: sub({ status: 'expired', is_active: false, is_expired: true }),
      renewalOptions: OPTIONS,
      tariffs: CATALOG,
      isTariffsMode: true,
    });
    const active = resolvePaymentPlan({
      subscription: sub(),
      renewalOptions: OPTIONS,
      tariffs: CATALOG,
      isTariffsMode: true,
    });

    expect(expired).toEqual(active);
  });

  it('скидка и старая цена периода доезжают до экрана', () => {
    const plan = resolvePaymentPlan({
      subscription: sub(),
      renewalOptions: [renewalOption({ discount_percent: 20, original_price_kopeks: 36_250 })],
      tariffs: CATALOG,
      isTariffsMode: true,
    });

    expect(plan.screen === 'periods' && plan.periods[0]).toEqual({
      periodDays: 30,
      priceKopeks: 29_000,
      discountPercent: 20,
      originalPriceKopeks: 36_250,
    });
  });
});

describe('resolvePaymentPlan: непродлеваемый статус платит покупкой тарифа (#69)', () => {
  for (const status of NON_RENEWABLE_STATUSES) {
    it(`статус ${status} — цены из каталога тарифа, операция purchaseTariff`, () => {
      // ⚠️ Здесь и есть соль задачи. Эндпоинт `renewal-options` для этих
      // статусов отдаёт ПУСТОЙ список (`renewal.py:53-57`), поэтому единый
      // экран нельзя построить на одном источнике цен. Мутация «брать цены
      // из renewal-options всегда» оставляет экран пустым — краснеет ниже.
      const plan = resolvePaymentPlan({
        subscription: sub({ status }),
        renewalOptions: [],
        tariffs: CATALOG,
        isTariffsMode: true,
      });

      expect(plan).toMatchObject({
        screen: 'periods',
        operation: 'purchaseTariff',
        source: 'tariffCatalog',
        promoDiscountable: true,
        tariffId: 11,
      });
      expect(plan.screen === 'periods' && plan.periods).toEqual([
        { periodDays: 30, priceKopeks: 30_000, discountPercent: 0, originalPriceKopeks: null },
        { periodDays: 90, priceKopeks: 81_000, discountPercent: 0, originalPriceKopeks: null },
      ]);
    });
  }

  it('непродлеваемый статус не берёт цены из renewal-options, даже если они пришли', () => {
    // ⚠️ Мутация «сначала смотреть renewal-options» краснеет здесь. Такой
    // экран показал бы цены продления и позвал бы эндпоинт, который ответит
    // 400 `Cannot renew subscription with status: disabled`.
    const plan = resolvePaymentPlan({
      subscription: sub({ status: 'disabled' }),
      renewalOptions: OPTIONS,
      tariffs: CATALOG,
      isTariffsMode: true,
    });

    expect(plan).toMatchObject({ operation: 'purchaseTariff', source: 'tariffCatalog' });
  });

  it('скидка промо-группы из каталога доезжает до экрана', () => {
    const discounted = tariff({
      periods: [
        period({ price_kopeks: 24_000, original_price_kopeks: 30_000, discount_percent: 20 }),
      ],
    });
    const plan = resolvePaymentPlan({
      subscription: sub({ status: 'pending' }),
      renewalOptions: [],
      tariffs: [discounted],
      isTariffsMode: true,
    });

    expect(plan.screen === 'periods' && plan.periods[0]).toEqual({
      periodDays: 30,
      priceKopeks: 24_000,
      discountPercent: 20,
      originalPriceKopeks: 30_000,
    });
  });
});

describe('resolvePaymentPlan: промо-скидка применяется ровно одному источнику (#69)', () => {
  it('каталогу — да, продлению — нет', () => {
    // ⚠️ Не косметика, а двойная скидка на экране. Цены `renewal-options`
    // бэкенд считает `calculate_renewal_price(..., user=user)`, то есть промо
    // ОФФЕР там уже применён. Периоды тарифа несут только скидку промо-ГРУППЫ
    // (`purchase.py:137-152`), а оффер к ним добавляет клиент —
    // `applyPromoDiscount`, ровно как в `TariffPurchaseForm`.
    const renew = resolvePaymentPlan({
      subscription: sub(),
      renewalOptions: OPTIONS,
      tariffs: CATALOG,
      isTariffsMode: true,
    });
    const purchase = resolvePaymentPlan({
      subscription: sub({ status: 'disabled' }),
      renewalOptions: [],
      tariffs: CATALOG,
      isTariffsMode: true,
    });

    expect(renew.screen === 'periods' && renew.promoDiscountable).toBe(false);
    expect(purchase.screen === 'periods' && purchase.promoDiscountable).toBe(true);
  });
});

describe('resolvePaymentPlan: отвалившийся тариф уводит в сетку с баннером (#69)', () => {
  const LOST: Array<[string, { tariffs: Tariff[]; subscription: Subscription }]> = [
    ['тарифа нет в каталоге', { tariffs: [], subscription: sub({ status: 'disabled' }) }],
    [
      'тариф скрыт',
      { tariffs: [tariff({ is_available: false })], subscription: sub({ status: 'disabled' }) },
    ],
    [
      'у тарифа нет периодов',
      { tariffs: [tariff({ periods: [] })], subscription: sub({ status: 'disabled' }) },
    ],
    [
      'у подписки нет tariff_id',
      { tariffs: CATALOG, subscription: sub({ status: 'disabled', tariff_id: undefined }) },
    ],
  ];

  for (const [name, input] of LOST) {
    it(`${name} — сетка выбора и баннер`, () => {
      expect(resolvePaymentPlan({ ...input, renewalOptions: [], isTariffsMode: true })).toEqual({
        screen: 'pickTariff',
        unsupportedTariffBanner: true,
      });
    });
  }

  it('ПРОДЛЕВАЕМЫЙ статус с отвалившимся тарифом — тоже сетка с баннером', () => {
    // ⚠️ Требование владельца дословно: «если истёкшая подписка больше не
    // доступна — показать окно с выбором подписки». Продлить такую бэкенд
    // формально даст, но подставит СТАНДАРТНЫЕ периоды настроек вместо
    // тарифных (`renewal.py:60-70`), то есть продаст срок тарифа, которого в
    // каталоге уже нет. Мутация «проверять тариф только у непродлеваемых»
    // краснеет здесь, и больше нигде: цены-то приходят.
    expect(
      resolvePaymentPlan({
        subscription: sub({ status: 'expired', is_active: false, is_expired: true }),
        renewalOptions: OPTIONS,
        tariffs: [],
        isTariffsMode: true,
      }),
    ).toEqual({ screen: 'pickTariff', unsupportedTariffBanner: true });

    expect(
      resolvePaymentPlan({
        subscription: sub(),
        renewalOptions: OPTIONS,
        tariffs: [tariff({ is_available: false })],
        isTariffsMode: true,
      }),
    ).toEqual({ screen: 'pickTariff', unsupportedTariffBanner: true });
  });

  it('продлеваемый статус без цен ни из одного источника — туда же', () => {
    // ⚠️ Прямой запрет задачи: «показывать пустой экран, если цены не пришли ни
    // из одного источника» нельзя. Мутация «рисовать пустой список периодов»
    // краснеет здесь.
    expect(
      resolvePaymentPlan({
        subscription: sub({ status: 'expired' }),
        renewalOptions: [],
        tariffs: [],
        isTariffsMode: true,
      }),
    ).toEqual({ screen: 'pickTariff', unsupportedTariffBanner: true });
  });

  it('запрос цен ещё не ответил — это не «тариф отвалился»', () => {
    // ⚠️ `undefined` (данных нет) и `[]` (сервер ответил пустым) — разные вещи.
    // Считать первое отвалившимся тарифом значило бы показывать баннер каждому
    // на время загрузки.
    expect(
      resolvePaymentPlan({
        subscription: sub(),
        renewalOptions: undefined,
        tariffs: CATALOG,
        isTariffsMode: true,
      }),
    ).toEqual({ screen: 'pending' });
  });
});

describe('resolvePaymentPlan: баннер — только тому, у кого тариф был (#69)', () => {
  it('подписки нет вовсе — сетка БЕЗ баннера', () => {
    // ⚠️ Дословное требование задачи: человеку без подписки сообщение «ваш
    // тариф больше не поддерживается» было бы ложью — терять ему нечего.
    // Мутация «показывать баннер всегда на сетке» краснеет здесь.
    expect(
      resolvePaymentPlan({
        subscription: null,
        renewalOptions: [],
        tariffs: CATALOG,
        isTariffsMode: true,
      }),
    ).toEqual({ screen: 'pickTariff', unsupportedTariffBanner: false });
  });

  it('триал — сетка БЕЗ баннера', () => {
    // Из триала не продлевают, а выходят на платный тариф: платного тарифа у
    // человека не было, значит и отвалиться было нечему.
    expect(
      resolvePaymentPlan({
        subscription: sub({ is_trial: true, tariff_id: undefined }),
        renewalOptions: [],
        tariffs: CATALOG,
        isTariffsMode: true,
      }),
    ).toEqual({ screen: 'pickTariff', unsupportedTariffBanner: false });
  });

  it('классический режим продаж — сетка БЕЗ баннера', () => {
    // ⚠️ В классическом режиме тарифов не существует вовсе: подписка без
    // `tariff_id` там норма, и `renewal-options` отдаёт ей стандартные периоды.
    // Баннер про тариф был бы бессмыслицей.
    expect(
      resolvePaymentPlan({
        subscription: sub({ tariff_id: undefined }),
        renewalOptions: [],
        tariffs: [],
        isTariffsMode: false,
      }),
    ).toEqual({ screen: 'pickTariff', unsupportedTariffBanner: false });
  });

  it('классическая подписка с непустыми периодами продлевается как обычно', () => {
    const plan = resolvePaymentPlan({
      subscription: sub({ tariff_id: undefined }),
      renewalOptions: OPTIONS,
      tariffs: [],
      isTariffsMode: false,
    });

    expect(plan).toMatchObject({ screen: 'periods', operation: 'renew' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Перебор состояний.
 *
 * ⚠️ Требование задачи дословно: «для каждого сочетания (статус × наличие
 * тарифа × наличие тарифа в каталоге × активность тарифа) проверяется, какая
 * операция выбрана и откуда взяты цены». Ниже — полное декартово произведение
 * этих осей плюс ось «пришли ли цены продления».
 * ══════════════════════════════════════════════════════════════════════════ */

const STATUSES = ['active', 'expired', 'limited', 'trial', 'disabled', 'pending'];
const CATALOGS: Array<[string, Tariff[]]> = [
  ['тариф в каталоге', CATALOG],
  ['тарифа в каталоге нет', []],
  ['тариф скрыт', [tariff({ is_available: false })]],
  ['тариф без периодов', [tariff({ periods: [] })]],
];
const TARIFF_IDS: Array<[string, number | undefined]> = [
  ['с тарифом', 11],
  ['без тарифа', undefined],
];
const OPTION_SETS: Array<[string, RenewalOption[]]> = [
  ['цены продления есть', OPTIONS],
  ['цен продления нет', []],
];

const STATES = STATUSES.flatMap((status) =>
  CATALOGS.flatMap(([catalogName, tariffs]) =>
    TARIFF_IDS.flatMap(([idName, tariffId]) =>
      OPTION_SETS.map(([optionsName, renewalOptions]) => ({
        name: `${status} / ${idName} / ${catalogName} / ${optionsName}`,
        status,
        input: {
          subscription: sub({ status, tariff_id: tariffId }),
          renewalOptions,
          tariffs,
          isTariffsMode: true,
        },
      })),
    ),
  ),
);

describe('перебор состояний единого экрана оплаты (#69)', () => {
  it('перебор собран — иначе проверки ниже проходили бы на пустом списке', () => {
    expect(STATES).toHaveLength(
      STATUSES.length * CATALOGS.length * TARIFF_IDS.length * OPTION_SETS.length,
    );
    expect(STATES).toHaveLength(96);

    const screens = new Set(STATES.map(({ input }) => resolvePaymentPlan(input).screen));
    // Обе ветки достижимы: перебор, в котором все состояния дают один экран,
    // ничего не доказывал бы.
    expect([...screens].sort()).toEqual(['periods', 'pickTariff']);
  });

  it('ни одно состояние не оставляет экран без содержимого', () => {
    // ⚠️ Инвариант задачи. Пустой список периодов — тот самый пустой экран,
    // который задача запрещает прямо.
    const empty = STATES.filter(({ input }) => {
      const plan = resolvePaymentPlan(input);
      return plan.screen === 'periods' && plan.periods.length === 0;
    });

    expect(empty.map(({ name }) => name)).toEqual([]);
  });

  it('ни одно состояние не даёт продление при непродлеваемом статусе', () => {
    // ⚠️ Второй инвариант: продление такому статусу бэкенд отвечает 400.
    const wrong = STATES.filter(({ status, input }) => {
      const plan = resolvePaymentPlan(input);
      return (
        NON_RENEWABLE_STATUSES.includes(status as (typeof NON_RENEWABLE_STATUSES)[number]) &&
        plan.screen === 'periods' &&
        plan.operation === 'renew'
      );
    });

    expect(wrong.map(({ name }) => name)).toEqual([]);
  });

  it('ни одно состояние не берёт непродлеваемому цены из renewal-options', () => {
    const wrong = STATES.filter(({ status, input }) => {
      const plan = resolvePaymentPlan(input);
      return (
        NON_RENEWABLE_STATUSES.includes(status as (typeof NON_RENEWABLE_STATUSES)[number]) &&
        plan.screen === 'periods' &&
        plan.source === 'renewalOptions'
      );
    });

    expect(wrong.map(({ name }) => name)).toEqual([]);
  });

  it('продлеваемые статусы продление сохраняют, когда цены и тариф на месте', () => {
    // Обратная сторона правила: задача чинит непродлеваемые статусы, а не
    // отбирает рабочее продление у остальных. Мутация «увести в сетку всех
    // подряд» краснеет здесь.
    const renewable = STATES.filter(
      ({ status, input }) =>
        !NON_RENEWABLE_STATUSES.includes(status as (typeof NON_RENEWABLE_STATUSES)[number]) &&
        input.renewalOptions.length > 0 &&
        isPayableTariff(input.tariffs.find(({ id }) => id === input.subscription.tariff_id)),
    );

    expect(renewable.length).toBeGreaterThan(0);
    for (const { name, input } of renewable) {
      const plan = resolvePaymentPlan(input);
      expect(`${name}: ${plan.screen === 'periods' ? plan.operation : plan.screen}`).toBe(
        `${name}: renew`,
      );
    }
  });

  it('операция и источник цен связаны намертво', () => {
    // Продление всегда из `renewal-options`, покупка тарифа всегда из каталога.
    // Перекрёстное сочетание означало бы цену от одного эндпоинта и вызов
    // другого — то есть списание не той суммы.
    for (const { name, input } of STATES) {
      const plan = resolvePaymentPlan(input);
      if (plan.screen !== 'periods') continue;

      expect(`${name}: ${plan.operation}/${plan.source}`).toBe(
        plan.operation === 'renew'
          ? `${name}: renew/renewalOptions`
          : `${name}: purchaseTariff/tariffCatalog`,
      );
    }
  });

  it('покупка тарифа всегда знает, ЧТО покупает', () => {
    for (const { name, input } of STATES) {
      const plan = resolvePaymentPlan(input);
      if (plan.screen !== 'periods' || plan.operation !== 'purchaseTariff') continue;

      expect(`${name}: ${typeof plan.tariffId}`).toBe(`${name}: number`);
      expect(plan.tariffId).toBe(input.subscription.tariff_id);
    }
  });

  it('непригодный тариф уводит в сетку при ЛЮБОМ статусе', () => {
    // ⚠️ Проверка перебором, а не примером: правило «тариф отвалился» одно на
    // все статусы, и написать его только для непродлеваемых — ровно та
    // мутация, которую поймать больше нечем, потому что цены-то приходят.
    const wrong = STATES.filter(({ input }) => {
      const payable = isPayableTariff(
        input.tariffs.find(({ id }) => id === input.subscription.tariff_id),
      );

      return !payable && resolvePaymentPlan(input).screen !== 'pickTariff';
    });

    expect(wrong.map(({ name }) => name)).toEqual([]);
  });

  it('баннер показывается ровно в состоянии «был тариф, тарифа больше нет»', () => {
    // ⚠️ Перебор целиком: у каждого состояния подписка есть и она не триал,
    // значит сетка без баннера здесь не появляется вовсе. Мутация «показывать
    // сетку молча» краснеет.
    for (const { name, input } of STATES) {
      const plan = resolvePaymentPlan(input);
      if (plan.screen !== 'pickTariff') continue;

      expect(`${name}: ${plan.unsupportedTariffBanner}`).toBe(`${name}: true`);
    }
  });
});
