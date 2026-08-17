import type { PaymentMethod, PeriodOption, PurchaseOptions, TariffPeriod } from '@/types';

/**
 * Чистая логика простого экрана суммы пополнения (задача #53).
 *
 * ⚠️ Вынесено в отдельный модуль намеренно: компонентных тестов в репе не бывает
 * (`vitest.config.ts` — `environment: 'node'`, ни jsdom, ни testing-library), и без
 * чистого модуля ветки «какой тариф взять», «какие четыре суммы показать», «чем
 * заполнить поле» проверить было бы нечем. Из `@/types` берутся ТОЛЬКО типы:
 * `import type` стирается при трансформации, поэтому alias `@/`, которого в
 * vitest нет, модулю не нужен.
 *
 * Единицы: контракт подписки — копейки, экран пополнения — рубли отображаемой
 * валюты. Границу переводов держим здесь: наружу отдаются рубли, внутрь приходят
 * копейки.
 */

/**
 * Период подписки, приведённый к общему виду для обоих режимов продаж.
 *
 * Длительность в контракте зовётся по-разному (`days` у тарифного периода,
 * `period_days` у классического) — приводим к одному имени, чтобы правила ниже не
 * ветвились по режиму продаж второй раз.
 */
export interface SubscriptionPeriodPrice {
  /** Длительность периода в днях — так период выражен в контракте. */
  days: number;
  /**
   * Месяцев в периоде или `null`, если бэкенд поле не заполнил.
   *
   * ⚠️ Именно `null`, а не `0`: нуль означает «период короче месяца», и правило
   * поиска месячного периода опирается на это различие.
   */
  months: number | null;
  priceKopeks: number;
}

export interface SubscriptionAmounts {
  /** id выбранного тарифа или `null` в классическом режиме. */
  tariffId: number | null;
  periods: SubscriptionPeriodPrice[];
}

/** Быстрых сумм на экране ровно четыре — под них рассчитана апстримная сетка. */
export const QUICK_AMOUNTS_COUNT = 4;

/**
 * Апстримные быстрые суммы в рублях — фолбэк, когда у метода их нет.
 *
 * Копия константы из `src/pages/TopUpAmount.tsx`: список апстримный, свой писать
 * нельзя, иначе экраны разъедутся молча.
 */
export const FALLBACK_QUICK_AMOUNTS_RUBLES = [100, 300, 500, 1000];

/**
 * Базовая цена подписки в рублях на 17.08.2026.
 *
 * Нужна ровно в одном случае: цены подписки не пришли (запрос не ответил, тарифов
 * нет), и поле суммы всё равно надо чем-то заполнить. Значение меняется ЗДЕСЬ —
 * магического числа в разметке страницы быть не должно.
 */
export const DEFAULT_TOP_UP_RUBLES = 200;

/** Границы «месяца» в днях: бэкенд отдаёт и 30, и 31, и 28 для февраля. */
const MONTH_MIN_DAYS = 28;
const MONTH_MAX_DAYS = 31;

function isTariffPeriodPriced(period: TariffPeriod): boolean {
  return Number.isFinite(period.price_kopeks) && period.price_kopeks > 0;
}

/**
 * Месяцы периода: `null`, когда бэкенд поле не заполнил.
 *
 * `undefined` и не-число превращаем в `null`, чтобы правило поиска месяца имело
 * ровно два состояния — «сказано» и «не сказано».
 */
function normalizeMonths(months: number | undefined | null): number | null {
  return typeof months === 'number' && Number.isFinite(months) ? months : null;
}

/**
 * Тариф, чьи цены показывает экран, и его периоды с ненулевой ценой.
 *
 * Правила (спека владельца #53):
 *
 *   1. режим `tariffs` — ПЕРВЫЙ тариф в том порядке, в котором их отдал бэкенд.
 *      Это тот же тариф, что стоит первым в витрине покупки: порядком владеет
 *      `display_order`, которым админ управляет перетаскиванием в админке, и
 *      апстримная витрина тоже ему доверяет (`TariffPickerGrid` сортирует только
 *      «текущий вперёд»). ⚠️ Раньше здесь искался `tier_level === 1` — правило
 *      снято решением владельца: поле проверено по бэкенду и оказалось
 *      декоративным. Оно не участвует ни в расчёте «апгрейд или понижение» (тот
 *      считается по дневной ставке цены), ни в доступности перехода между
 *      тарифами; за ним никто не следит, поэтому цены кнопок к нему привязывать
 *      нельзя. Привязка к порядку витрины даёт суммы, совпадающие с тем, что
 *      человек видит на странице покупки;
 *   2. режим `classic` — периоды с верхнего уровня ответа;
 *   3. выкидываем бесплатные периоды (`price_kopeks <= 0`) — бесплатные тарифы
 *      реальны, контракт знает `subscription_on_free_tariff`, — а в классическом
 *      режиме ещё и недоступные (`is_available === false`).
 *
 * Ответа ещё нет — пусто. Это не ошибка: экран пополнения обязан работать и без
 * цен подписки, фолбэки ниже на этом и построены.
 */
export function resolveSubscriptionAmounts(
  options: PurchaseOptions | undefined | null,
): SubscriptionAmounts {
  if (!options) {
    return { tariffId: null, periods: [] };
  }

  if (options.sales_mode === 'tariffs') {
    const tariffs = options.tariffs ?? [];
    const [tariff] = tariffs;

    if (!tariff) {
      return { tariffId: null, periods: [] };
    }

    return {
      tariffId: tariff.id,
      periods: (tariff.periods ?? []).filter(isTariffPeriodPriced).map((period) => ({
        days: period.days,
        months: normalizeMonths(period.months),
        priceKopeks: period.price_kopeks,
      })),
    };
  }

  const classicPeriods: PeriodOption[] = options.periods ?? [];

  return {
    tariffId: null,
    periods: classicPeriods
      .filter(
        (period) =>
          Number.isFinite(period.price_kopeks) &&
          period.price_kopeks > 0 &&
          period.is_available !== false,
      )
      .map((period) => ({
        days: period.period_days,
        months: normalizeMonths(period.months),
        priceKopeks: period.price_kopeks,
      })),
  };
}

/**
 * Пересчёт цены с учётом активной скидки промо.
 *
 * Страница подставляет сюда `applyPromoDiscount` из `usePromoDiscount` — тот же
 * хук, которым считает цены витрина тарифов и форма покупки. Без него кнопка
 * показала бы сумму больше той, которую человек реально заплатит за подписку, и
 * пополнение «ровно на месяц» оказалось бы с лишком.
 *
 * Второй аргумент `applyPromoDiscount` (цена до скидки промо-группы) на результат
 * `.price` не влияет — он нужен только для подписи «было/стало», которой на этом
 * экране нет. Поэтому в чистые функции он не проходит.
 */
export type ApplyDiscount = (priceKopeks: number) => number;

const noDiscount: ApplyDiscount = (priceKopeks) => priceKopeks;

/** Диапазон метода оплаты и его собственные быстрые суммы. */
type QuickAmountsMethod = Pick<PaymentMethod, 'min_amount_kopeks' | 'max_amount_kopeks'> & {
  quick_amounts?: number[] | null;
};

function inRange(rubles: number, method: QuickAmountsMethod): boolean {
  return (
    rubles >= method.min_amount_kopeks / 100 &&
    rubles <= method.max_amount_kopeks / 100 &&
    Number.isFinite(rubles)
  );
}

/**
 * Четыре суммы для кнопок быстрого выбора — в рублях.
 *
 * Правила (спека владельца #53):
 *
 *   1. цену каждого периода прогоняем через скидку промо;
 *   2. переводим в рубли и фильтруем диапазоном метода — иначе кнопка «неделя за
 *      149 ₽» при минимуме 200 ₽ отвечает ошибкой диапазона;
 *   3. берём первые четыре уцелевших в порядке бэкенда;
 *   4. уцелело ноль — отдаём апстримные быстрые суммы метода, то есть поведение
 *      апстрима. Пропадание кнопок недопустимо: `purchase-options` может не
 *      ответить, а экран пополнения обязан работать.
 *
 * ⚠️ Фолбэк повторяет апстрим буквально, включая `quick_amounts != null`: ПУСТОЙ
 * массив у метода — это осознанное «кнопок нет», а не «данных нет», и на
 * константы он не переключает. Диапазоном фолбэк фильтруется так же, как в
 * апстриме, поэтому пустым он тоже может оказаться — тогда блок кнопок не
 * рисуется, ровно как на апстримном экране.
 */
export function resolveQuickAmountsRubles(input: {
  periods: SubscriptionPeriodPrice[];
  method: QuickAmountsMethod;
  applyDiscount?: ApplyDiscount;
}): number[] {
  const { periods, method, applyDiscount = noDiscount } = input;

  const fromPeriods = periods
    .map((period) => applyDiscount(period.priceKopeks) / 100)
    .filter((rubles) => inRange(rubles, method))
    .slice(0, QUICK_AMOUNTS_COUNT);

  if (fromPeriods.length > 0) {
    return fromPeriods;
  }

  const upstream =
    method.quick_amounts != null
      ? method.quick_amounts.map((kopeks) => kopeks / 100)
      : FALLBACK_QUICK_AMOUNTS_RUBLES;

  return upstream.filter((rubles) => inRange(rubles, method));
}

function clamp(rubles: number, minRubles: number, maxRubles: number): number {
  if (rubles < minRubles) return minRubles;
  if (rubles > maxRubles) return maxRubles;
  return rubles;
}

/**
 * Начальное значение поля суммы — в рублях.
 *
 * Правила (спека владельца #53):
 *
 *   1. есть корректный `?amount=` — берём его. ⚠️ Он важнее цены месяца: по этому
 *      параметру приходит точная недостающая сумма из сценария «не хватает денег»
 *      (`src/components/InsufficientBalancePrompt.tsx` кладёт туда
 *      `Math.ceil(missingAmountKopeks / 100)`), то есть человек пришёл добрать
 *      конкретную сумму;
 *   2. иначе — цена периода в один месяц: `months === 1`, а если месяцы бэкенд не
 *      заполнил — период длительностью 28-31 день;
 *   3. месячного периода нет — самый дешёвый из уцелевших;
 *   4. периодов нет вовсе — `DEFAULT_TOP_UP_RUBLES`;
 *   5. результат зажимаем в диапазон метода. Иначе у метода с минимумом 500 ₽
 *      экран открывался бы с суммой, которая на первое нажатие отвечает ошибкой
 *      диапазона. Зажим достаёт и сумму из URL: поднять её до минимума значит
 *      оставить человеку рабочую кнопку, а опустить до максимума — единственное,
 *      что метод физически может принять.
 */
export function resolveInitialAmountRubles(input: {
  urlAmount: number | undefined | null;
  periods: SubscriptionPeriodPrice[];
  minRubles: number;
  maxRubles: number;
  applyDiscount?: ApplyDiscount;
  defaultRubles?: number;
}): number {
  const {
    urlAmount,
    periods,
    minRubles,
    maxRubles,
    applyDiscount = noDiscount,
    defaultRubles = DEFAULT_TOP_UP_RUBLES,
  } = input;

  if (typeof urlAmount === 'number' && Number.isFinite(urlAmount) && urlAmount > 0) {
    return clamp(urlAmount, minRubles, maxRubles);
  }

  const priced = periods.map((period) => ({
    period,
    rubles: applyDiscount(period.priceKopeks) / 100,
  }));

  if (priced.length === 0) {
    return clamp(defaultRubles, minRubles, maxRubles);
  }

  const monthly =
    priced.find(({ period }) => period.months === 1) ??
    priced.find(
      ({ period }) =>
        period.months === null && period.days >= MONTH_MIN_DAYS && period.days <= MONTH_MAX_DAYS,
    );

  if (monthly) {
    return clamp(monthly.rubles, minRubles, maxRubles);
  }

  const cheapest = priced.reduce((best, item) => (item.rubles < best.rubles ? item : best));

  return clamp(cheapest.rubles, minRubles, maxRubles);
}
