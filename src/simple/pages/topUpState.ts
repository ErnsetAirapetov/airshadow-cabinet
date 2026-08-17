import type { PaymentMethod, PeriodOption, PurchaseOptions, Tariff, TariffPeriod } from '@/types';

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
   * ⚠️ Дополнительный сигнал, а не источник истины: правило поиска месячного
   * периода решает по `days` (28-31), потому что бэкенд присылает 30-дневному
   * периоду и `months: 0` (задача #56). Различие `null` и `0` сохраняем — оно
   * честно отражает «не сказано» против «сказано, что меньше месяца», — но
   * ветвиться на нём правило больше не имеет права.
   */
  months: number | null;
  priceKopeks: number;
}

export interface SubscriptionAmounts {
  /** id выбранного тарифа или `null` в классическом режиме. */
  tariffId: number | null;
  periods: SubscriptionPeriodPrice[];
}

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

/**
 * Период длиной в месяц — по ДНЯМ, независимо от значения `months` (задача #56).
 *
 * ⚠️ Длительность здесь главный признак, а `months` — только дополнительный сигнал.
 * Раньше было наоборот: месяц искался по `months === 1`, а дневная ветка включалась
 * лишь при `months === null`. Обе проверки промахивались при `months: 0` у
 * 30-дневного периода, и в поле попадала цена самого дешёвого периода — то есть
 * недели. Поле `months` во фронте больше нигде не читается (grep даёт только этот
 * модуль), так что реальными данными оно не проверено ни разу, и опираться на него
 * как на главный признак нельзя.
 */
function isMonthDuration(days: number): boolean {
  return days >= MONTH_MIN_DAYS && days <= MONTH_MAX_DAYS;
}

function isTariffPeriodPriced(period: TariffPeriod): boolean {
  return Number.isFinite(period.price_kopeks) && period.price_kopeks > 0;
}

/**
 * Поля тарифа, по которым витрина покупки решает, показывать его или нет.
 *
 * Тип узкий намеренно: правило ниже — копия апстримного, и всё, что оно читает,
 * должно быть видно в подписи. `is_available` в контракте обязательное, а
 * `is_purchased` приходит только в мультитарифном режиме, отсюда `Partial`.
 */
type ShowcaseTariff = Pick<Tariff, 'name'> & Partial<Pick<Tariff, 'is_available' | 'is_purchased'>>;

/**
 * ⚠️ Признак триала — подстрока в ИМЕНИ. Костыль, но иного признака в контракте нет:
 * `Tariff` не знает ни `is_trial`, ни чего-либо равносильного (проверено по
 * `src/types/index.ts`), а апстримная витрина отсекает триальные ровно так же —
 * `tariff.name.toLowerCase().includes('trial')`.
 */
const TRIAL_NAME_MARKER = 'trial';

/**
 * Тариф скрыт витриной покупки?
 *
 * Копия правила из апстримного
 * `src/components/subscription/purchase/TariffPickerGrid.tsx` (импортировать его
 * простому режиму нельзя — граница режимов).
 *
 * ⚠️ Копия ПОСТОЯННАЯ, сторож навсегда. Обычная копия по канону временная — до
 * переезда оригинала в `src/simple/`, — но апстримная витрина покупки к нам не
 * переедет никогда: это экран экспертного режима, а мы им не владеем. Значит
 * оригинал может измениться молча в любой день, и текстовый сторож в
 * `topUpPage.test.ts` (читает апстримный файл и валит `npm test`, если состав фильтра
 * разъехался) снимать нельзя ни при каком закрытии задач.
 *
 * ⚠️ Два отличия от апстрима, оба осознанные:
 *
 *   1. апстрим гейтит проверки состоянием пользователя — купленные скрывает только
 *      в мультитарифном режиме, триальные только у человека на триале. Экран
 *      пополнения ни подписку, ни список подписок не запрашивает, поэтому проверки
 *      применяются безусловно. Направление безопасное: фильтр строже, а если он
 *      выкинул всё, `pickShowcaseTariff` откатывается на сырой первый тариф;
 *   2. недоступный тариф (`is_available === false`) добавлен нами по спеке #56:
 *      цену того, что нельзя купить, показывать на кнопках пополнения незачем. В
 *      классическом режиме недоступные периоды выкидываются здесь же и давно.
 */
function isHiddenInShowcase(tariff: ShowcaseTariff): boolean {
  if (tariff.is_purchased === true) return true;
  if (tariff.is_available === false) return true;
  return (tariff.name ?? '').toLowerCase().includes(TRIAL_NAME_MARKER);
}

/**
 * Первый тариф в порядке витрины покупки.
 *
 * ⚠️ Фолбэк на сырой первый тариф обязателен: экран пополнения обязан работать. Если
 * фильтр выкинул всё (а на дев-стенде это ровно тот случай, где все тарифы
 * называются «trial»), лучше показать цены единственного имеющегося тарифа, чем
 * молча уехать на апстримные суммы, будто цены не пришли.
 */
export function pickShowcaseTariff<T extends ShowcaseTariff>(tariffs: T[]): T | undefined {
  return tariffs.find((tariff) => !isHiddenInShowcase(tariff)) ?? tariffs[0];
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
 *   1. режим `tariffs` — первый ДОСТУПНЫЙ тариф в порядке `display_order`, которым
 *      админ управляет перетаскиванием в админке. Доступность понимается так же,
 *      как в витрине покупки: скрытые ею тарифы (триальные, купленные,
 *      недоступные) пропускаем — правило в `pickShowcaseTariff` выше.
 *      ⚠️ Формулировка «тот же тариф, что первым в витрине» была бы неверной:
 *      витрина вдобавок поднимает вперёд ТЕКУЩИЙ тариф человека, так что совпадение
 *      верно только для того, у кого текущего тарифа нет. Совпадает не позиция в
 *      витрине, а порядок `display_order` после её фильтров.
 *      ⚠️ Раньше здесь брался сырой `tariffs[0]` без фильтров, и на дев-стенде это
 *      давало триальный тариф с ценой в единицы рублей: она ниже минимума способа
 *      оплаты, зажим поднимал поле до минимума (100 ₽ у Платеги), а кнопки уезжали
 *      в апстримный фолбэк, потому что фильтр диапазона выкидывал все дешёвые цены
 *      (задача #56).
 *      ⚠️ Ещё раньше искался `tier_level === 1` — правило снято решением владельца:
 *      поле проверено по бэкенду и оказалось декоративным. Оно не участвует ни в
 *      расчёте «апгрейд или понижение» (тот считается по дневной ставке цены), ни в
 *      доступности перехода между тарифами; за ним никто не следит, поэтому цены
 *      кнопок к нему привязывать нельзя;
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
    const tariff = pickShowcaseTariff(tariffs);

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

/**
 * Диапазон метода оплаты и его собственные быстрые суммы.
 *
 * ⚠️ Границы объявлены необязательными намеренно, хотя в контракте `PaymentMethod`
 * они обязательные: бэкенд может прислать `null`, и тогда деление на 100 давало
 * `NaN`. Тип, врущий про это, прятал бы третью мину задачи #56 от компилятора.
 */
type QuickAmountsMethod = Partial<
  Pick<PaymentMethod, 'min_amount_kopeks' | 'max_amount_kopeks'>
> & {
  quick_amounts?: number[] | null;
};

/**
 * Цена в целых рублях: округляем ВВЕРХ (решение владельца 17.08.2026, задача #56).
 *
 * ⚠️ Именно вверх, а не `Math.round`: 29 900 копеек минус 15 процентов скидки — это
 * 25 415, то есть 254,15 ₽. Подпись на кнопке показывала `254`, а списывался
 * канонический `254,15` — подпись расходилась с фактом. Лишние копейки при
 * пополнении безвредны, расхождение подписи и списания нет.
 */
function toWholeRubles(kopeks: number): number {
  return Math.ceil(kopeks / 100);
}

/**
 * Граница диапазона в рублях или `null`, если границы нет.
 *
 * ⚠️ Отсутствующая и нечисловая граница означают «границы нет», а не «не проходит
 * ничего». Раньше `max_amount_kopeks: undefined` давал `NaN`, любое сравнение с ним
 * было ложным, и фильтр диапазона выкидывал ВСЁ — включая апстримный фолбэк, — то
 * есть кнопок на экране не оставалось вообще (задача #56).
 */
function boundRubles(kopeks: number | undefined | null): number | null {
  return typeof kopeks === 'number' && Number.isFinite(kopeks) ? kopeks / 100 : null;
}

function inRange(rubles: number, method: QuickAmountsMethod): boolean {
  if (!Number.isFinite(rubles)) return false;

  const min = boundRubles(method.min_amount_kopeks);
  const max = boundRubles(method.max_amount_kopeks);

  if (min !== null && rubles < min) return false;
  if (max !== null && rubles > max) return false;

  return true;
}

/**
 * Суммы для кнопок быстрого выбора — в рублях, по одной на период.
 *
 * Правила (спека владельца #53, уточнена в #56):
 *
 *   1. цену каждого периода прогоняем через скидку промо;
 *   2. переводим в рубли, ОКРУГЛЯЯ ВВЕРХ до целого рубля, и фильтруем диапазоном
 *      метода — иначе кнопка «неделя за 149 ₽» при минимуме 200 ₽ отвечает ошибкой
 *      диапазона. ⚠️ Порядок значим: сначала округление, потом фильтр. Фильтровать
 *      по неокруглённой цене значит выкидывать кнопку, которая после округления в
 *      диапазон как раз попадает;
 *   3. берём ВСЕ уцелевшие в порядке бэкенда — кнопок столько, сколько периодов
 *      (решение владельца #56). Прежний `.slice(0, 4)` прятал пятый и шестой период;
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
    .map((period) => toWholeRubles(applyDiscount(period.priceKopeks)))
    .filter((rubles) => inRange(rubles, method));

  if (fromPeriods.length > 0) {
    return fromPeriods;
  }

  const upstream =
    method.quick_amounts != null
      ? method.quick_amounts.map((kopeks) => kopeks / 100)
      : FALLBACK_QUICK_AMOUNTS_RUBLES;

  return upstream.filter((rubles) => inRange(rubles, method));
}

/**
 * Максимум кнопок в одной строке на `lg` — дальше строка переносится (спека #56:
 * «все периоды одной строкой на `lg` — до шести; больше шести — переносом по шесть»).
 */
const MAX_ROW_COLUMNS = 6;

/**
 * Классы сетки кнопок — статическая карта «колонок в строке → класс».
 *
 * ⚠️ КАЖДЫЙ вариант выписан литералом целиком, и это не многословие ради
 * многословия: Tailwind собирает утилиты, сканируя исходники ТЕКСТОМ, поэтому класс,
 * собранный из переменной (`lg:grid-cols-${n}`), в CSS не попадает вообще. Сборка
 * при этом зелёная, а на стенде сетки просто нет.
 *
 * База и `sm` от числа кнопок не зависят — 2 и 3 колонки по спеке владельца.
 */
const GRID_BY_ROW_COLUMNS: Record<number, string> = {
  1: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1',
  2: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2',
  3: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-3',
  4: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4',
  5: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6',
};

/**
 * Пролёты последней кнопки — тоже литералами, по той же причине.
 *
 * ⚠️ Записи с пролётом 1 (`sm:col-span-1`, `lg:col-span-1`) — не многословие и не
 * no-op, а ОБЯЗАТЕЛЬНЫЙ СБРОС. `col-span-*` в Tailwind собираются в min-width-медиа,
 * то есть каскадом: пролёт, объявленный на базе, продолжает действовать на `sm` и
 * `lg`, пока его не перебьёт класс с префиксом. Пока сброса не было, «класса нет»
 * означало не «пролёт 1», а «донашиваем нижний», и сетка рвалась на самых ходовых
 * числах кнопок: при одной кнопке `col-span-2 sm:col-span-3` на `lg` с сеткой в одну
 * колонку давало пролёт 3 — кнопка вылезала за контейнер; при двух и четырёх на `lg`
 * получалось две строки вместо одной; при девяти дыру давал уже базовый пролёт на
 * `sm`. Целыми оставались только 6, 7, 8 и 10 кнопок.
 *
 * Базовый брейкпоинт сброса не требует: ниже него ничего нет, пролёт 1 там и так
 * умолчание грида. Он выписан ради единообразия — раскладка отдаёт по классу на
 * каждый брейкпоинт, и читать её проще, чем набор с дырками.
 */
const BASE_SPAN_CLASS: Record<number, string> = { 1: 'col-span-1', 2: 'col-span-2' };
const SM_SPAN_CLASS: Record<number, string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-3',
};
const LG_SPAN_CLASS: Record<number, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  6: 'lg:col-span-6',
};

/** Колонок в сетке на базовом брейкпоинте и на `sm` — спека владельца #56. */
const BASE_COLUMNS = 2;
const SM_COLUMNS = 3;

export interface QuickAmountsLayout {
  /** Классы контейнера сетки кнопок. */
  gridClassName: string;
  /** Классы ПОСЛЕДНЕЙ кнопки: пролёт на остаток неполной строки. Может быть пустым. */
  lastItemClassName: string;
}

/**
 * Сколько колонок забирает последняя кнопка в сетке из `columns` колонок.
 *
 * В последней строке остаётся `count % columns` кнопок; последняя из них забирает
 * себя и все пустые клетки справа. Полная строка растягивать ничего не требует —
 * пролёт ровно 1.
 *
 * ⚠️ Именно 1, а не «класса нет»: из-за каскада `col-span-*` отсутствие класса
 * означает «донашиваем пролёт нижнего брейкпоинта», и на полной строке это давало
 * дыру вместо ровной сетки (см. докстринг карт пролётов выше).
 */
function lastItemSpan(count: number, columns: number): number {
  const remainder = count % columns;
  return remainder === 0 ? 1 : columns - remainder + 1;
}

/**
 * Раскладка кнопок быстрых сумм под их число (спека владельца #56).
 *
 * Чистая функция, а разметка её только читает: классы сетки — единственное, что в
 * этом экране зависит от числа кнопок, а проверить их в разметке нечем
 * (компонентных тестов в проекте нет). Здесь же они проверяемы инвариантом
 * «ЭФФЕКТИВНЫЙ пролёт последней кнопки на каждом брейкпоинте равен остатку строки
 * сетки того же брейкпоинта» — эффективный, то есть с учётом каскада «база → sm →
 * lg», поэтому класс выдаётся на каждый брейкпоинт безусловно, включая сброс в 1.
 */
export function resolveQuickAmountsLayout(count: number): QuickAmountsLayout {
  const rowColumns = Math.min(Math.max(count, 1), MAX_ROW_COLUMNS);
  const gridClassName = GRID_BY_ROW_COLUMNS[rowColumns];

  if (count < 1) {
    // Кнопок нет — растягивать нечего, блок и не рисуется. Но функция обязана быть
    // тотальной: `quickAmounts.length === 0` бывает штатно.
    return { gridClassName, lastItemClassName: '' };
  }

  const lastItemClassName = [
    BASE_SPAN_CLASS[lastItemSpan(count, BASE_COLUMNS)],
    SM_SPAN_CLASS[lastItemSpan(count, SM_COLUMNS)],
    LG_SPAN_CLASS[lastItemSpan(count, rowColumns)],
  ]
    .filter((className): className is string => Boolean(className))
    .join(' ');

  return { gridClassName, lastItemClassName };
}

/**
 * Зажим в диапазон метода.
 *
 * ⚠️ Нечисловая граница игнорируется, а не зажимает: при `NaN` сравнения ложны, и
 * прежний зажим просто не срабатывал — то есть третья мина задачи #56 проявлялась
 * здесь молчаливым отказом зажимать вместо явного «границы нет».
 */
function clamp(rubles: number, minRubles: number, maxRubles: number): number {
  if (Number.isFinite(minRubles) && rubles < minRubles) return minRubles;
  if (Number.isFinite(maxRubles) && rubles > maxRubles) return maxRubles;
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
 *   2. иначе — цена периода в один месяц. Месяц определяется по ДЛИТЕЛЬНОСТИ (28-31
 *      день) независимо от значения `months`; `months === 1` остаётся ЗАПАСНЫМ
 *      сигналом и срабатывает только там, где периода подходящей длины нет вовсе —
 *      то есть если бэкенд назвал месяцем период неожиданной длины.
 *      ⚠️ Опираться на `months` как на главный признак нельзя: 30-дневному периоду
 *      он приходит и нулём, а при конфликте признаков побеждать обязана
 *      длительность (задача #56);
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
    // Тем же округлением вверх, что и кнопки: и в поле, и на кнопке человек
    // обязан видеть ровно ту сумму, которая с него спишется. Разойдись формулы —
    // предзаполненное поле показывало бы 254, а списывался бы канонический
    // 254,15 (задача #56).
    rubles: toWholeRubles(applyDiscount(period.priceKopeks)),
  }));

  if (priced.length === 0) {
    return clamp(defaultRubles, minRubles, maxRubles);
  }

  // ⚠️ Порядок этих двух поисков — суть второй мины задачи #56, и менять его
  // нельзя. Длительность ищется ПЕРВОЙ, `months === 1` — только запасной сигнал.
  // Пока `months` стоял первым, он побеждал при конфликте признаков: на данных
  // `[{days: 7, months: 1}, {days: 30, months: 0}]` в поле попадала цена недели —
  // буквально исходный симптом задачи. А `months` во фронте больше нигде не
  // читается, то есть реальными данными не проверен ни разу.
  const monthly =
    priced.find(({ period }) => isMonthDuration(period.days)) ??
    priced.find(({ period }) => period.months === 1);

  if (monthly) {
    return clamp(monthly.rubles, minRubles, maxRubles);
  }

  const cheapest = priced.reduce((best, item) => (item.rubles < best.rubles ? item : best));

  return clamp(cheapest.rubles, minRubles, maxRubles);
}
