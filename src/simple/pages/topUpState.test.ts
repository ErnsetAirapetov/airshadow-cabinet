import { describe, expect, it } from 'vitest';
import type { PurchaseOptions } from '@/types';
import {
  DEFAULT_TOP_UP_RUBLES,
  FALLBACK_QUICK_AMOUNTS_RUBLES,
  resolveInitialAmountRubles,
  resolveQuickAmountsLayout,
  resolveQuickAmountsRubles,
  resolveSubscriptionAmounts,
  type SubscriptionPeriodPrice,
} from './topUpState';

/**
 * Чистая логика простого экрана суммы пополнения (задача #53).
 *
 * ⚠️ Модуль чистый именно поэтому: граф импортов страницы дотягивается до alias
 * `@/`, а он в тестах не разрешается — отрисовать её целиком нельзя ни рендером,
 * ни импортом. Без чистого модуля ветки «какой тариф», «какие четыре суммы», «чем
 * заполнено поле» остались бы непроверенными вообще.
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
 *
 * Имя по умолчанию нейтральное: правило витрины отсекает триальные тарифы ПО ИМЕНИ
 * (`includes('trial')`), поэтому фикстура без имени не должна случайно попадать под
 * фильтр. Доступность по умолчанию — `true`: в контракте `is_available` у тарифа
 * обязательное поле, и тариф, которого нет в продаже, — исключение, а не норма.
 */
function tariffsOptions(
  tariffs: Array<{
    id: number;
    name?: string;
    tier_level?: number;
    is_available?: boolean;
    is_purchased?: boolean;
    periods: Array<Record<string, unknown>>;
  }>,
): PurchaseOptions {
  return {
    sales_mode: 'tariffs',
    tariffs: tariffs.map((tariff) => ({
      ...tariff,
      name: tariff.name ?? `Тариф ${tariff.id}`,
      is_available: tariff.is_available ?? true,
    })),
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

  it('триальный тариф первым — берётся следующий (задача #56)', () => {
    // ⚠️ Первопричина бага: на стенде первым в массиве стоит триальный тариф с
    // ценой в единицы рублей. Она ниже минимума способа оплаты, зажим поднимал
    // поле до 100 ₽, и владелец видел минимум Платеги вместо цены месяца.
    // Апстримная витрина покупки такой тариф скрывает — значит и мы обязаны.
    const options = tariffsOptions([
      {
        id: 9,
        name: 'Trial 3 дня',
        periods: [tariffPeriod({ days: 3, months: 0, price_kopeks: 300 })],
      },
      {
        id: 3,
        name: 'Стандарт',
        periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 29_900 })],
      },
    ]);

    const resolved = resolveSubscriptionAmounts(options);

    expect(resolved.tariffId).toBe(3);
    expect(resolved.periods).toEqual([{ days: 30, months: 1, priceKopeks: 29_900 }]);
  });

  it('регистр в имени триального тарифа не важен (задача #56)', () => {
    // Апстрим сравнивает `tariff.name.toLowerCase()`, а админ пишет имя как хочет:
    // «TRIAL», «Триал-Trial», «trial period».
    const options = tariffsOptions([
      { id: 9, name: 'TRIAL пробный', periods: [tariffPeriod({ days: 3, price_kopeks: 300 })] },
      { id: 3, name: 'Стандарт', periods: [tariffPeriod({ days: 30, price_kopeks: 29_900 })] },
    ]);

    expect(resolveSubscriptionAmounts(options).tariffId).toBe(3);
  });

  it('недоступный тариф первым — берётся следующий (задача #56)', () => {
    const options = tariffsOptions([
      {
        id: 9,
        is_available: false,
        periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 900 })],
      },
      { id: 3, periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 29_900 })] },
    ]);

    expect(resolveSubscriptionAmounts(options).tariffId).toBe(3);
  });

  it('уже купленный тариф первым — берётся следующий (задача #56)', () => {
    const options = tariffsOptions([
      {
        id: 9,
        is_purchased: true,
        periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 900 })],
      },
      { id: 3, periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 29_900 })] },
    ]);

    expect(resolveSubscriptionAmounts(options).tariffId).toBe(3);
  });

  it('после фильтра не осталось ни одного — фолбэк на первый из сырого списка (задача #56)', () => {
    // ⚠️ Экран пополнения обязан работать. Пустота здесь означала бы кнопки из
    // апстримного фолбэка и поле с константой — то есть цены подписки на экране
    // пропали бы совсем, хотя они пришли.
    const options = tariffsOptions([
      { id: 9, name: 'Trial', periods: [tariffPeriod({ days: 30, price_kopeks: 900 })] },
      {
        id: 3,
        name: 'Trial расширенный',
        is_available: false,
        periods: [tariffPeriod({ days: 30, price_kopeks: 29_900 })],
      },
    ]);

    const resolved = resolveSubscriptionAmounts(options);

    expect(resolved.tariffId).toBe(9);
    expect(resolved.periods).toEqual([{ days: 30, months: null, priceKopeks: 900 }]);
  });

  it('все тарифы проходят фильтр — берётся буквально первый (задача #56)', () => {
    // Пара к тестам выше: фильтр не должен переставлять порядок сам по себе.
    const options = tariffsOptions([
      { id: 7, periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 99_900 })] },
      { id: 3, periods: [tariffPeriod({ days: 30, months: 1, price_kopeks: 29_900 })] },
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

describe('resolveQuickAmountsRubles — кнопка на каждый период', () => {
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

  it('кнопок ровно столько, сколько уцелевших периодов (задача #56)', () => {
    // ⚠️ Решение владельца: кнопок столько, сколько периодов в тарифе (обычно
    // 4-6), а не фиксированные четыре. Раньше здесь стоял `.slice(0, 4)`, и пятый
    // с шестым периодом на экран не попадали вообще.
    for (const count of [1, 2, 5, 6, 7]) {
      const items: SubscriptionPeriodPrice[] = Array.from({ length: count }, (_unused, index) => ({
        days: 30 * (index + 1),
        months: null,
        priceKopeks: 10_000 * (index + 1),
      }));

      const quick = resolveQuickAmountsRubles({ periods: items, method: method({}) });

      expect(quick, `${count} периодов обязаны дать ${count} кнопок`).toHaveLength(count);
    }
  });

  it('порядок бэкенда сохраняется при любом числе периодов (задача #56)', () => {
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

    expect(quick).toEqual([100, 200, 300, 400, 500]);
  });

  it('цена после скидки округляется ВВЕРХ до целого рубля (задача #56)', () => {
    // ⚠️ 29 900 копеек минус 15 процентов — это 25 415, то есть 254,15 ₽. На
    // кнопке было видно `254`, а списывался канонический `254,15`: подпись
    // расходилась со списанием. Округляем вверх — лишние копейки при пополнении
    // безвредны, расхождение подписи и факта нет.
    const quick = resolveQuickAmountsRubles({
      periods: periods([30, 1, 29_900]),
      method: method({}),
      applyDiscount: () => 25_415,
    });

    expect(quick).toEqual([255]);
  });

  it('округление идёт ДО фильтра диапазона (задача #56)', () => {
    // Иначе кнопка «255 ₽» при минимуме 255 ₽ отфильтровывалась бы по своей
    // неокруглённой цене 254,15 — и пропадала бы ровно на границе.
    const quick = resolveQuickAmountsRubles({
      periods: periods([30, 1, 29_900]),
      method: method({ min_amount_kopeks: 25_500 }),
      applyDiscount: () => 25_415,
    });

    expect(quick).toEqual([255]);
  });

  it('сломанный максимум метода не убивает кнопки (задача #56)', () => {
    // ⚠️ При `max_amount_kopeks: undefined` делением получался NaN, и фильтр
    // диапазона выкидывал ВСЁ, включая фолбэк, — кнопок не было вообще.
    // Отсутствующая или нечисловая граница означает «границы нет».
    for (const broken of [undefined, Number.NaN]) {
      expect(
        resolveQuickAmountsRubles({
          periods: periods([30, 1, 29_900], [90, 3, 79_900]),
          method: { min_amount_kopeks: 10_000, max_amount_kopeks: broken },
        }),
        `максимум ${String(broken)} не должен выкидывать периодные кнопки`,
      ).toEqual([299, 799]);

      expect(
        resolveQuickAmountsRubles({
          periods: [],
          method: { min_amount_kopeks: 10_000, max_amount_kopeks: broken },
        }),
        `максимум ${String(broken)} не должен выкидывать фолбэк`,
      ).toEqual(FALLBACK_QUICK_AMOUNTS_RUBLES);
    }
  });

  it('сломанный минимум метода не убивает кнопки (задача #56)', () => {
    expect(
      resolveQuickAmountsRubles({
        periods: periods([30, 1, 29_900]),
        method: { min_amount_kopeks: undefined, max_amount_kopeks: 1_000_000 },
      }),
    ).toEqual([299]);
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

/**
 * Утилиты `grid-cols-*` из литерала сетки — парами «префикс брейкпоинта, число
 * колонок». Базовый брейкпоинт даёт пустой префикс. Тот же разбор, что в
 * `balancePage.test.ts`.
 */
function gridColumns(source: string): Array<{ breakpoint: string; count: number }> {
  // ⚠️ Префикс `[a-z0-9]+`, а не `[a-z]+` (#58): на `[a-z]+` брейкпоинт `2xl`
  // разбирался как `xl`, то есть обещание «новый брейкпоинт подхватится сам»
  // на нём давало ложно-зелёное.
  return [...source.matchAll(/(?:([a-z0-9]+):)?grid-cols-(\d+)/g)].map((match) => ({
    breakpoint: match[1] ?? '',
    count: Number(match[2]),
  }));
}

/**
 * Пролёты `col-span-*` — картой «префикс брейкпоинта → число колонок».
 *
 * ⚠️ Класс требуется ОТДЕЛЬНЫМ, с границами слова: без `(?:^|\s)` разбор находил бы
 * беспрефиксный `col-span-2` внутри `sm:col-span-2`, и подмена базового пролёта
 * оставалась бы незамеченной. В #52 на этом ловились дважды.
 */
function colSpans(source: string): Record<string, number> {
  const spans: Record<string, number> = {};

  // Префикс с цифрой (`2xl:`) — как в `gridColumns` выше: иначе `2xl:col-span-3`
  // не матчился бы вообще и молча выпадал из каскада (#58).
  for (const match of source.matchAll(/(?:^|\s)(?:([a-z0-9]+):)?col-span-(\d+)(?=\s|$)/g)) {
    spans[match[1] ?? ''] = Number(match[2]);
  }

  return spans;
}

/**
 * Все брейкпоинты Tailwind снизу вверх — лестница каскада, а не состав сетки.
 *
 * ⚠️ Раньше здесь стоял состав (`['', 'sm', 'lg']`) и сверялся на равенство, то
 * есть сторож требовал ровно три брейкпоинта: дописанный `md:grid-cols-*`
 * краснел бы без причины (#58). Состав спеки — два числа и «одной строкой на
 * `lg`» — проверяется ПОИМЁННО отдельным тестом; здесь нужен только ПОРЯДОК,
 * по которому считается каскад.
 */
const BREAKPOINT_LADDER = ['', 'sm', 'md', 'lg', 'xl', '2xl'];

/**
 * ⚠️ Граница приёма: в лестнице только БРЕЙКПОИНТЫ. Вариант не про ширину
 * (`dark:grid-cols-2`, `print:`) в неё не попадёт, и сверка ниже покраснеет — это
 * правильное поведение, а не ложный красный: каскад такого варианта разбор
 * упорядочить не может. Появится нужда — вариант учитывают осознанно, а не
 * подгоняют регулярку.
 */

/** Брейкпоинты, реально объявленные в литерале сетки, снизу вверх. */
function usedBreakpoints(gridClassName: string): string[] {
  const declared = new Set(gridColumns(gridClassName).map(({ breakpoint }) => breakpoint));
  return BREAKPOINT_LADDER.filter((breakpoint) => declared.has(breakpoint));
}

/**
 * ЭФФЕКТИВНЫЙ пролёт последней кнопки на каждом брейкпоинте.
 *
 * ⚠️ Разница между «объявленным» и «эффективным» — та самая, из-за которой прежний
 * сторож был ложно-зелёным. `col-span-*` в Tailwind — утилиты с min-width-медиа, то
 * есть КАСКАД: объявленный на базе пролёт продолжает действовать на `sm` и `lg`,
 * пока его не перебьёт класс с префиксом. Сторож, который сверял объявленные классы
 * и пропускал брейкпоинт с полной строкой (`if (remainder === 0) continue`), считал
 * «класса нет» и «пролёт равен 1» одним и тем же — а в браузере это разные вещи:
 * при одной кнопке `col-span-2 sm:col-span-3` на `lg` с сеткой в одну колонку давало
 * пролёт 3, и кнопка вылезала за контейнер. Проверять надо то, что видит браузер.
 *
 * Отсутствие класса на брейкпоинте — не «пролёт 1», а «то же, что ниже»; ниже всех
 * умолчание грида — одна колонка.
 */
function effectiveSpans(lastItemClassName: string): Record<string, number> {
  const declared = colSpans(lastItemClassName);
  const effective: Record<string, number> = {};
  let carried = 1;

  // Каскад считается по всей лестнице, а не по составу сетки: пролёт может быть
  // объявлен на брейкпоинте, где число колонок не меняется.
  for (const breakpoint of BREAKPOINT_LADDER) {
    carried = declared[breakpoint] ?? carried;
    effective[breakpoint] = carried;
  }

  return effective;
}

describe('resolveQuickAmountsLayout — раскладка кнопок (задача #56)', () => {
  /** 1-6 — обычное число периодов у тарифа, 7-10 — перенос на вторую строку. */
  const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('разбор классов удался — иначе сторожа ниже сверяли бы пустоту', () => {
    for (const count of COUNTS) {
      const { gridClassName, lastItemClassName } = resolveQuickAmountsLayout(count);

      expect(gridClassName, `${count} кнопок`).toMatch(/(^|\s)grid(\s|$)/);
      // ⚠️ «Больше нуля», а не «ровно три» (#58). Ровно три означало «сколько
      // брейкпоинтов сейчас в спеке», то есть добавление `md:grid-cols-*`
      // краснело бы без причины — а это украшение, не дефект. Состав спеки
      // сверяется ПОИМЁННО в тесте ниже (база, `sm`, `lg`), сторож дыр ходит по
      // найденным брейкпоинтам и новый подхватит сам.
      expect(gridColumns(gridClassName), `${count} кнопок`).not.toHaveLength(0);
      expect(typeof lastItemClassName).toBe('string');
    }

    // Хотя бы у одного числа кнопок пролёт непустой: иначе сверка карт ниже
    // проходила бы на двух пустых объектах при любой реализации.
    expect(
      COUNTS.filter(
        (count) =>
          Object.keys(colSpans(resolveQuickAmountsLayout(count).lastItemClassName)).length > 0,
      ),
    ).not.toHaveLength(0);
  });

  it('спека владельца: 2 колонки на базе, 3 на sm, все кнопки одной строкой на lg', () => {
    // ⚠️ «Все периоды одной строкой на lg (до шести; больше шести — переносом по
    // шесть)» — решение владельца. Числа 2 и 3 тоже из спеки, поэтому сверяются
    // литералами, а не выводятся из чего-либо.
    for (const count of COUNTS) {
      const columns = gridColumns(resolveQuickAmountsLayout(count).gridClassName);
      const byBreakpoint = new Map(columns.map(({ breakpoint, count: n }) => [breakpoint, n]));

      expect(byBreakpoint.get(''), `${count} кнопок, база`).toBe(2);
      expect(byBreakpoint.get('sm'), `${count} кнопок, sm`).toBe(3);
      expect(byBreakpoint.get('lg'), `${count} кнопок, lg`).toBe(Math.min(count, 6));
    }
  });

  it('в сетке нет дыр: эффективный пролёт последней кнопки добирает строку', () => {
    // ⚠️ Сторож переписан на ЭФФЕКТИВНЫЕ пролёты (задача #56, второй заход).
    // Прежний сверял объявленные классы и пропускал брейкпоинт с полной строкой —
    // и был ложно-зелёным ровно там, где дыра и жила: `lg` донашивал пролёт с `sm`
    // или с базы. Три требования, и каждое обязательно:
    //
    //   1. пролёт сверяется С ЧИСЛОМ КОЛОНОК сетки того же брейкпоинта, а не с
    //      константой: сменить `lg:grid-cols-6` в карте и не сменить пролёт значит
    //      молча оставить дыру;
    //   2. пролёт ЭФФЕКТИВНЫЙ, с учётом каскада «база → sm → lg»: пропавший сброс
    //      `sm:col-span-1` / `lg:col-span-1` обязан краснеть;
    //   3. отдельно проверяется отсутствие дыры — упаковкой грида, а не формулой:
    //      последняя кнопка обязана кончаться ровно на границе строки, а суммарная
    //      ширина всех кнопок — быть кратной числу колонок. Это ловит и такую
    //      ошибку в формуле, которую ожидание, выведенное той же формулой, повторило
    //      бы за реализацией.
    //
    // Диапазон 0-10: 0 — блок кнопок не рисуется, но функция обязана быть тотальной;
    // 4-6 — обычное число периодов у тарифа; 7-10 — перенос на вторую строку.
    for (let count = 0; count <= 10; count += 1) {
      const { gridClassName, lastItemClassName } = resolveQuickAmountsLayout(count);
      const columnsBy = new Map(
        gridColumns(gridClassName).map(({ breakpoint, count: columns }) => [breakpoint, columns]),
      );

      // ⚠️ Брейкпоинты берутся ИЗ ЛИТЕРАЛА, а не сверяются с ожидаемым составом
      // (#58): требование «ровно база, sm и lg» краснело на дописанном `md:`,
      // хотя новый брейкпоинт — украшение, а не дефект. Состав спеки проверяет
      // тест выше поимённо; здесь важно другое — дыр не должно быть НИ НА ОДНОМ
      // объявленном брейкпоинте, включая только что добавленный.
      const breakpoints = usedBreakpoints(gridClassName);

      expect(breakpoints, `${count} кнопок: ${gridClassName}`).toContain('');
      expect(breakpoints.length, `${count} кнопок: ${gridClassName}`).toBe(columnsBy.size);

      if (count < 1) {
        expect(lastItemClassName, `${count} кнопок: растягивать нечего`).toBe('');
        continue;
      }

      const spans = effectiveSpans(lastItemClassName);

      for (const breakpoint of breakpoints) {
        const columns = columnsBy.get(breakpoint) as number;
        const remainder = count % columns;
        const where = `${count} кнопок, брейкпоинт '${breakpoint || 'база'}' (${columns} колонок): «${lastItemClassName}»`;

        // В последней строке `remainder` кнопок из `columns`: последняя забирает
        // себя и все пустые клетки справа. Полная строка — пролёт ровно 1.
        expect(spans[breakpoint], where).toBe(remainder === 0 ? 1 : columns - remainder + 1);

        // Упаковка грида: первые `count - 1` кнопок по одной клетке, последняя —
        // `spans[breakpoint]`. Она обязана уместиться в свою строку ровно до края...
        expect(((count - 1) % columns) + spans[breakpoint], where).toBe(columns);
        // ...и не оставить за собой ни одной пустой клетки.
        expect((count - 1 + spans[breakpoint]) % columns, where).toBe(0);
      }
    }
  });

  it('пролёт достаётся только последней кнопке — остальным класса нет', () => {
    // Раскладка отдаёт ОДИН класс для последней кнопки. Если бы она отдавала класс
    // для всех, растянулись бы все — и сетка развалилась бы вся, а не в хвосте.
    const layout = resolveQuickAmountsLayout(5);

    expect(layout.lastItemClassName).not.toContain('grid');
    expect(Object.keys(layout)).toEqual(['gridClassName', 'lastItemClassName']);
  });

  it('кнопок нет — раскладка всё равно отдаёт рабочие классы, а не падает', () => {
    // Блок кнопок при нуле не рисуется, но чистая функция обязана быть тотальной:
    // иначе первый же `quickAmounts.length === 0` уронил бы страницу.
    for (const count of [0, -1]) {
      const { gridClassName, lastItemClassName } = resolveQuickAmountsLayout(count);

      // Классы рабочие, а не пустая строка. Число брейкпоинтов не сверяем: оно
      // не про тотальность функции, а про украшение сетки (#58).
      expect(gridColumns(gridClassName)).not.toHaveLength(0);
      expect(gridClassName).toMatch(/(^|\s)grid(\s|$)/);
      expect(lastItemClassName).toBe('');
    }
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

  it('months: 0 у 30-дневного периода распознаётся как месяц (задача #56)', () => {
    // ⚠️ Вторая мина той же задачи. Раньше дневная ветка включалась только при
    // `months === null`, а `months === 1` промахивался при нуле — значит бэкенд,
    // приславший 30-дневному периоду `months: 0`, загонял в поле цену самой
    // дешёвой недели. Поле `months` во фронте больше нигде не читается, то есть
    // реальными данными оно не проверено ни разу.
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([7, 0, 14_900], [30, 0, 29_900], [90, 0, 79_900]),
      ...range,
    });

    expect(amount).toBe(299);
  });

  it('границы месяца — 28 и 31 день, независимо от months (задача #56)', () => {
    // Бэкенд отдаёт и 28 (февраль), и 30, и 31 — все три месяц.
    for (const days of [28, 29, 30, 31]) {
      expect(
        resolveInitialAmountRubles({
          urlAmount: undefined,
          periods: periods([7, 0, 14_900], [days, 0, 29_900]),
          ...range,
        }),
        `${days} дн. обязаны считаться месяцем`,
      ).toBe(299);
    }
  });

  it('27 и 32 дня месяцем не считаются (задача #56)', () => {
    // Пара к тесту границ: без неё правило «28-31» проходило бы и как «любой
    // период длиннее недели».
    for (const days of [27, 32]) {
      expect(
        resolveInitialAmountRubles({
          urlAmount: undefined,
          periods: periods([7, 0, 14_900], [days, 0, 29_900]),
          ...range,
        }),
        `${days} дн. месяцем быть не должны — ожидается самый дешёвый период`,
      ).toBe(149);
    }
  });

  it('months === 1 у НЕмесячного периода не перебивает длительность (задача #56)', () => {
    // ⚠️ Исходный симптом задачи, воспроизведённый на конфликте признаков: бэкенд
    // назвал месяцем недельный период (`days: 7, months: 1`), а настоящему месяцу
    // прислал `months: 0`. Пока `months` искался ПЕРВЫМ, побеждала неделя — то есть
    // в поле снова попадала не та цена. Длительность 28-31 день — главный признак,
    // `months === 1` только запасной, и порядок этих двух поисков закрепляет этот
    // тест: без него перестановка `find`-ов не краснела нигде.
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([7, 1, 14_900], [30, 0, 29_900]),
      ...range,
    });

    expect(amount).toBe(299);
  });

  it('months === 1 остаётся дополнительным сигналом (задача #56)', () => {
    // Длительность решает, но если бэкенд назвал месяцем период неожиданной
    // длины — верим ему, а не арифметике по дням.
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([7, 0, 14_900], [45, 1, 29_900]),
      ...range,
    });

    expect(amount).toBe(299);
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

  it('цена месяца в поле округлена вверх — как на кнопке (задача #56)', () => {
    // ⚠️ Подпись кнопки и значение в поле обязаны совпадать до копейки: подсветка
    // выбранной кнопки сравнивает строку в поле с её текстом, а списывается
    // канонический рубль из поля. 25 415 копеек → 255 ₽ в обоих местах.
    const amount = resolveInitialAmountRubles({
      urlAmount: undefined,
      periods: periods([30, 1, 29_900]),
      applyDiscount: () => 25_415,
      ...range,
    });

    expect(amount).toBe(255);
    expect(
      resolveQuickAmountsRubles({
        periods: periods([30, 1, 29_900]),
        method: method({}),
        applyDiscount: () => 25_415,
      }),
    ).toEqual([amount]);
  });

  it('сломанные границы метода не ломают зажим (задача #56)', () => {
    // При `NaN` сравнения ложны, и зажим молча не срабатывал. Теперь нечисловая
    // граница означает «границы нет» — значение проходит как есть, а не в NaN.
    expect(
      resolveInitialAmountRubles({
        urlAmount: undefined,
        periods: periods([30, 1, 29_900]),
        minRubles: Number.NaN,
        maxRubles: Number.NaN,
      }),
    ).toBe(299);
    expect(
      resolveInitialAmountRubles({
        urlAmount: 137,
        periods: [],
        minRubles: Number.NaN,
        maxRubles: Number.NaN,
      }),
    ).toBe(137);
    expect(
      resolveInitialAmountRubles({
        urlAmount: undefined,
        periods: periods([30, 1, 29_900]),
        minRubles: 500,
        maxRubles: Number.NaN,
      }),
    ).toBe(500);
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
