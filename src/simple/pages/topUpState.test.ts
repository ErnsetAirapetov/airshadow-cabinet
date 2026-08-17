import { describe, expect, it } from 'vitest';
import type { PurchaseOptions } from '@/types';
import {
  DEFAULT_TOP_UP_RUBLES,
  FALLBACK_QUICK_AMOUNTS_RUBLES,
  QUICK_AMOUNTS_COUNT,
  resolveInitialAmountRubles,
  resolveQuickAmountsRubles,
  resolveSubscriptionAmounts,
  type SubscriptionPeriodPrice,
} from './topUpState';

/**
 * Чистая логика простого экрана суммы пополнения (задача #53).
 *
 * ⚠️ Модуль чистый именно поэтому: компонентных тестов в проекте не бывает
 * (`vitest.config.ts` — `environment: 'node'`, ни jsdom, ни testing-library, alias
 * `@/` в тестах не разрешается). Без него ветки «какой тариф», «какие четыре
 * суммы», «чем заполнено поле» остались бы непроверенными вообще.
 *
 * Фикстуры собираются минимальными и приводятся к типу: `Tariff` и `PeriodOption`
 * в контракте огромные, а разбираемые поля — единицы. Приведение здесь честнее
 * тридцати полей-пустышек, которые всё равно никто не читает.
 */

/** Период тарифного режима — заполняем только читаемые поля. */
function tariffPeriod(period: {
  days: number;
  months?: number;
  price_kopeks: number;
}): Record<string, unknown> {
  return {
    days: period.days,
    months: period.months,
    label: `${period.days} дн.`,
    price_kopeks: period.price_kopeks,
    price_label: `${period.price_kopeks / 100} ₽`,
    price_per_month_kopeks: period.price_kopeks,
  };
}

/** Период классического режима: длительность зовётся иначе и есть доступность. */
function classicPeriod(period: {
  period_days: number;
  months?: number;
  price_kopeks: number;
  is_available?: boolean;
}): Record<string, unknown> {
  return {
    id: `p${period.period_days}`,
    period_days: period.period_days,
    months: period.months,
    label: `${period.period_days} дн.`,
    price_kopeks: period.price_kopeks,
    is_available: period.is_available ?? true,
  };
}

/**
 * ⚠️ `tier_level` в фикстурах необязателен намеренно: правило выбора тарифа его не
 * читает вообще. Он остался только в тесте, который доказывает, что не читает.
 */
function tariffsOptions(
  tariffs: Array<{ id: number; tier_level?: number; periods: Array<Record<string, unknown>> }>,
): PurchaseOptions {
  return {
    sales_mode: 'tariffs',
    tariffs,
    current_tariff_id: null,
    balance_kopeks: 0,
    balance_label: '0 ₽',
  } as unknown as PurchaseOptions;
}

function classicOptions(periods: Array<Record<string, unknown>>): PurchaseOptions {
  return {
    sales_mode: 'classic',
    currency: 'RUB',
    balance_kopeks: 0,
    balance_label: '0 ₽',
    subscription_id: null,
    periods,
  } as unknown as PurchaseOptions;
}

/** Метод оплаты — читаются только диапазон и быстрые суммы. */
function method(input: {
  min_amount_kopeks?: number;
  max_amount_kopeks?: number;
  quick_amounts?: number[] | null;
}) {
  return {
    min_amount_kopeks: input.min_amount_kopeks ?? 100,
    max_amount_kopeks: input.max_amount_kopeks ?? 10_000_000,
    quick_amounts: input.quick_amounts,
  };
}

function periods(...items: Array<[days: number, months: number | null, kopeks: number]>) {
  return items.map(([days, months, priceKopeks]) => ({
    days,
    months,
    priceKopeks,
  })) as SubscriptionPeriodPrice[];
}

describe('resolveSubscriptionAmounts — откуда берутся цены', () => {
  it('тарифный режим: берёт первый тариф в порядке бэкенда', () => {
    // Тот же тариф, который стоит первым в витрине покупки: порядком владеет
    // `display_order`, которым админ управляет перетаскиванием в админке.
    const options = tariffsOptions([
      {
        id: 7,
        periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 99_900 })],
      },
      {
        id: 3,
        periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 29_900 })],
      },
    ]);

    const resolved = resolveSubscriptionAmounts(options);

    expect(resolved.tariffId).toBe(7);
    expect(resolved.periods).toEqual([{ days: 30, months: 1, priceKopeks: 99_900 }]);
  });

  it('порядок массива уважается: переставили тарифы — сменились цены', () => {
    // Пара к тесту выше на тех же данных в обратном порядке. Правило «первый»
    // должно давать другой ответ, иначе оно ничего не выбирает.
    const options = tariffsOptions([
      {
        id: 3,
        periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 29_900 })],
      },
      {
        id: 7,
        periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 99_900 })],
      },
    ]);

    const resolved = resolveSubscriptionAmounts(options);

    expect(resolved.tariffId).toBe(3);
    expect(resolved.periods).toEqual([{ days: 30, months: 1, priceKopeks: 29_900 }]);
  });

  it('tier_level на выбор не влияет — поле декоративное', () => {
    // Проверено по бэкенду: `tier_level` не участвует ни в расчёте «апгрейд или
    // понижение» (он считается по дневной ставке цены), ни в доступности
    // перехода между тарифами. Привязывать цены кнопок к нему нельзя.
    const options = tariffsOptions([
      {
        id: 7,
        tier_level: 9,
        periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 99_900 })],
      },
      {
        id: 3,
        tier_level: 1,
        periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 29_900 })],
      },
    ]);

    expect(resolveSubscriptionAmounts(options).tariffId).toBe(7);
  });

  it('тарифов нет вовсе — пусто, а не падение', () => {
    const resolved = resolveSubscriptionAmounts(tariffsOptions([]));

    expect(resolved.tariffId).toBeNull();
    expect(resolved.periods).toEqual([]);
  });

  it('классический режим: периоды с верхнего уровня ответа', () => {
    const options = classicOptions([
      classicPeriod({ period_days: 30, months: 1, price_kopeks: 24_900 }),
      classicPeriod({ period_days: 90, months: 3, price_kopeks: 64_900 }),
    ]);

    const resolved = resolveSubscriptionAmounts(options);

    expect(resolved.tariffId).toBeNull();
    expect(resolved.periods).toEqual([
      { days: 30, months: 1, priceKopeks: 24_900 },
      { days: 90, months: 3, priceKopeks: 64_900 },
    ]);
  });

  it('бесплатные периоды выкинуты: нулевая и отрицательная цена', () => {
    // Бесплатный тариф реален — контракт знает `subscription_on_free_tariff`.
    // Кнопка «0 ₽» в пополнении бессмысленна, а поле с нулём не отправляется.
    const options = tariffsOptions([
      {
        id: 1,
        periods: [
          tariffPeriod({ days: 30, months: 1, price_kopeks: 0 }),
          tariffPeriod({ days: 90, months: 3, price_kopeks: -100 }),
          tariffPeriod({ days: 180, months: 6, price_kopeks: 99_900 }),
        ],
      },
    ]);

    expect(resolveSubscriptionAmounts(options).periods).toEqual([
      { days: 180, months: 6, priceKopeks: 99_900 },
    ]);
  });

  it('классический режим: недоступный период выкинут', () => {
    const options = classicOptions([
      classicPeriod({ period_days: 30, months: 1, price_kopeks: 24_900, is_available: false }),
      classicPeriod({ period_days: 90, months: 3, price_kopeks: 64_900 }),
    ]);

    expect(resolveSubscriptionAmounts(options).periods).toEqual([
      { days: 90, months: 3, priceKopeks: 64_900 },
    ]);
  });

  it('ответа ещё нет — пусто, а не падение', () => {
    expect(resolveSubscriptionAmounts(undefined)).toEqual({ tariffId: null, periods: [] });
    expect(resolveSubscriptionAmounts(null)).toEqual({ tariffId: null, periods: [] });
  });

  it('месяцы не заполнены — остаются null, а не нулём', () => {
    // Нуль означал бы «период меньше месяца», а `null` — «бэкенд не сказал».
    // Правило поиска месячного периода по дням опирается именно на это различие.
    const options = tariffsOptions([
      { id: 1, periods: [tariffPeriod({ days: 30, price_kopeks: 29_900 })] },
    ]);

    expect(resolveSubscriptionAmounts(options).periods).toEqual([
      { days: 30, months: null, priceKopeks: 29_900 },
    ]);
  });
});

describe('resolveQuickAmountsRubles — четыре кнопки быстрых сумм', () => {
  it('цены периодов переводятся в рубли, порядок бэкенда сохраняется', () => {
    const quick = resolveQuickAmountsRubles({
      periods: periods([7, 0, 14_900], [30, 1, 29_900], [90, 3, 79_900]),
      method: method({}),
    });

    expect(quick).toEqual([149, 299, 799]);
  });

  it('скидка промо применяется к каждой цене', () => {
    const quick = resolveQuickAmountsRubles({
      periods: periods([30, 1, 30_000], [90, 3, 90_000]),
      method: method({}),
      applyDiscount: (kopeks) => Math.round(kopeks * 0.9),
    });

    expect(quick).toEqual([270, 810]);
  });

  it('период вне диапазона метода выкинут', () => {
    // Кнопка «неделя за 149 ₽» при минимуме 200 ₽ отвечала бы ошибкой диапазона.
    const quick = resolveQuickAmountsRubles({
      periods: periods([7, 0, 14_900], [30, 1, 29_900], [360, 12, 500_000]),
      method: method({ min_amount_kopeks: 20_000, max_amount_kopeks: 100_000 }),
    });

    expect(quick).toEqual([299]);
  });

  it('уцелело меньше четырёх — столько и рисуем', () => {
    const quick = resolveQuickAmountsRubles({
      periods: periods([30, 1, 29_900], [90, 3, 79_900]),
      method: method({}),
    });

    expect(quick).toHaveLength(2);
  });

  it('уцелело больше четырёх — первые четыре по порядку бэкенда', () => {
    const quick = resolveQuickAmountsRubles({
      periods: periods(
        [7, 0, 10_000],
        [30, 1, 20_000],
        [90, 3, 30_000],
        [180, 6, 40_000],
        [360, 12, 50_000],
      ),
      method: method({}),
    });

    expect(quick).toEqual([100, 200, 300, 400]);
    expect(quick).toHaveLength(QUICK_AMOUNTS_COUNT);
  });

  it('уцелело ноль — апстримные быстрые суммы метода', () => {
    // ⚠️ Экран пополнения обязан работать, даже если цены не пришли.
    const quick = resolveQuickAmountsRubles({
      periods: [],
      method: method({ quick_amounts: [50_000, 100_000] }),
    });

    expect(quick).toEqual([500, 1000]);
  });

  it('уцелело ноль и у метода быстрых сумм нет — константы апстрима', () => {
    expect(resolveQuickAmountsRubles({ periods: [], method: method({}) })).toEqual(
      FALLBACK_QUICK_AMOUNTS_RUBLES,
    );
    expect(
      resolveQuickAmountsRubles({ periods: [], method: method({ quick_amounts: null }) }),
    ).toEqual(FALLBACK_QUICK_AMOUNTS_RUBLES);
  });

  it('пустой массив быстрых сумм у метода фолбэка на константы не даёт', () => {
    // Поведение апстрима: `quick_amounts != null` — пустой массив это осознанное
    // «кнопок нет», а не «данных нет».
    expect(
      resolveQuickAmountsRubles({ periods: [], method: method({ quick_amounts: [] }) }),
    ).toEqual([]);
  });

  it('фолбэк тоже фильтруется диапазоном метода — как в апстриме', () => {
    const quick = resolveQuickAmountsRubles({
      periods: [],
      method: method({ min_amount_kopeks: 30_000, max_amount_kopeks: 60_000 }),
    });

    expect(quick).toEqual([300, 500]);
  });
});

describe('resolveInitialAmountRubles — чем заполнено поле суммы', () => {
  const range = { minRubles: 1, maxRubles: 100_000 };

  it('корректный ?amount= перебивает цену месяца', () => {
    // ⚠️ Человек пришёл добрать конкретную недостающую сумму — она важнее.
    const amount = resolveInitialAmountRubles({
      urlAmount: 137,
      periods: periods([30, 1, 29_900]),
      ...range,
    });

    expect(amount).toBe(137);
  });

  it('мусор в ?amount= игнорируется', () => {
    for (const urlAmount of [Number.NaN, 0, -50, Number.POSITIVE_INFINITY]) {
      expect(
        resolveInitialAmountRubles({ urlAmount, periods: periods([30, 1, 29_900]), ...range }),
      ).toBe(299);
    }
    expect(
      resolveInitialAmountRubles({
        urlAmount: undefined,
        periods: periods([30, 1, 29_900]),
        ...range,
      }),
    ).toBe(299);
  });

  it('месячный период находится по months === 1', () => {
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([7, 0, 14_900], [30, 1, 29_900], [90, 3, 79_900]),
      ...range,
    });

    expect(amount).toBe(299);
  });

  it('months не заполнены — месяц ищется по дням 28-31', () => {
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([7, null, 14_900], [31, null, 34_900], [90, null, 79_900]),
      ...range,
    });

    expect(amount).toBe(349);
  });

  it('месячного периода нет — самый дешёвый из уцелевших', () => {
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([90, 3, 79_900], [7, 0, 14_900], [360, 12, 500_000]),
      ...range,
    });

    expect(amount).toBe(149);
  });

  it('периодов нет вовсе — именованная константа', () => {
    const amount = resolveInitialAmountRubles({ urlAmount: undefined, periods: [], ...range });

    expect(amount).toBe(DEFAULT_TOP_UP_RUBLES);
  });

  it('скидка промо применяется к цене месяца', () => {
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([30, 1, 30_000]),
      applyDiscount: (kopeks) => Math.round(kopeks * 0.5),
      ...range,
    });

    expect(amount).toBe(150);
  });

  it('значение зажимается по минимуму метода', () => {
    // Иначе у метода с минимумом 500 ₽ экран открывался бы с суммой, которая на
    // первое нажатие отвечает ошибкой диапазона.
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([30, 1, 29_900]),
      minRubles: 500,
      maxRubles: 100_000,
    });

    expect(amount).toBe(500);
  });

  it('значение зажимается по максимуму метода', () => {
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([360, 12, 500_000]),
      minRubles: 100,
      maxRubles: 1000,
    });

    expect(amount).toBe(1000);
  });

  it('зажим достаёт и сумму из URL, и константу', () => {
    expect(
      resolveInitialAmountRubles({ urlAmount: 5, periods: [], minRubles: 300, maxRubles: 1000 }),
    ).toBe(300);
    expect(
      resolveInitialAmountRubles({
        urlAmount: undefined,
        periods: [],
        minRubles: 300,
        maxRubles: 1000,
      }),
    ).toBe(300);
  });
});
