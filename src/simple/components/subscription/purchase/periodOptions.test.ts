import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ru from '../../../../locales/ru.json';
import { PERIOD_LABEL_KEY, formatPeriodLabel } from './periodLabel';

/**
 * Единственная разметка списка периодов и единственное правило его подписей
 * (задача #71).
 *
 * ⚠️ Правило подписи проверяется вызовом функции, а сама разметка — чтением
 * файлов ТЕКСТОМ: компонентных тестов в проекте не бывает
 * (`environment: 'node'`, alias `@/` в тестах не разрешается —
 * docs/architecture/two-modes.md, раздел «Тесты»). Цена приёма — разбор видит
 * только литералы, поэтому у каждого блока есть парная проверка «разбор удался».
 *
 * ⚠️ Зачем это. Владелец на стенде увидел, что после выбора тарифа человек
 * попадает «на другой по виду экран»: список периодов был написан ДВАЖДЫ — в
 * `SubscriptionPayment.tsx` и в `TariffPurchaseForm.tsx`, — и две реализации
 * разъехались молча, вплоть до разных подписей («30 дней» против «1 месяц»).
 */

const PERIOD_LIST = 'src/simple/components/subscription/purchase/PeriodOptionList.tsx';
const PERIOD_LABEL = 'src/simple/components/subscription/purchase/periodLabel.ts';
const FORM = 'src/simple/components/subscription/purchase/TariffPurchaseForm.tsx';
const PAYMENT = 'src/simple/pages/SubscriptionPayment.tsx';

/** Все исходники простого режима — для сторожей «во всём слое одна копия». */
function simpleSources(dir = 'src/simple'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) return simpleSources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

/** Файлы простого режима, в тексте которых встречается подстрока. */
function ownersOf(needle: string): string[] {
  return simpleSources()
    .filter((file) => readFileSync(file, 'utf8').includes(needle))
    .sort();
}

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const UPSTREAM_FORM = 'src/components/subscription/purchase/TariffPurchaseForm.tsx';

/**
 * Комментарии вырезаны — разбор смотрит только на код.
 *
 * ⚠️ Без этого запреты ниже краснели бы на собственных докстрингах: они как раз
 * и объясняют, почему `period.label` и старая сетка отсюда убраны.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const form = stripComments(readFileSync(FORM, 'utf8'));
const payment = stripComments(readFileSync(PAYMENT, 'utf8'));
const upstreamForm = stripComments(readFileSync(UPSTREAM_FORM, 'utf8'));

describe('конвенция подписи периода — одна (задача #71)', () => {
  it('подпись собирается плюральным апстримным ключом', () => {
    const calls: [string, { count: number }][] = [];
    const label = formatPeriodLabel(30, (key, options) => {
      calls.push([key, options]);
      return 'подпись';
    });

    expect(label).toBe('подпись');
    expect(calls).toEqual([['subscription.days', { count: 30 }]]);
  });

  it('ключ выбран существующий и переведённый — иначе на экране была бы сама строка ключа', () => {
    // ⚠️ Пара «разбор удался» для правила выше: без неё оно проходило бы на
    // любой выдуманной строке. Плюральные формы обязательны — на них держится
    // выбор конвенции: «1 день», а не «1 дней».
    expect(PERIOD_LABEL_KEY).toBe('subscription.days');

    const subscription = ru.subscription as unknown as Record<string, string>;

    expect(subscription.days_one).toBe('{{count}} день');
    expect(subscription.days_few).toBe('{{count}} дня');
    expect(subscription.days_many).toBe('{{count}} дней');
  });

  it('правило записано в ЕДИНСТВЕННОМ месте', () => {
    // ⚠️ Вторая запись ключа разъехалась бы с первой молча — ровно так и
    // получились «30 дней» против «1 месяц».
    expect(ownersOf('PERIOD_LABEL_KEY =')).toEqual([PERIOD_LABEL]);
  });

  it('апстримная подпись периода (`period.label`) больше нигде не рисуется', () => {
    // ⚠️ `label` тарифа — вторая конвенция («1 месяц»), и смешивать их задача
    // запрещает прямо. На пути продления она недостижима вовсе: `RenewalOption`
    // поля `label` не несёт. Мутация «вернуть period.label в сводку» краснеет.
    expect(countOf(form, 'period.label')).toBe(0);
    expect(countOf(form, 'Period.label')).toBe(0);
    expect(form).toContain('periodLabel(selectedTariffPeriod.days)');
  });

  it('апстримная форма подпись `label` ЕЩЁ рисует — запрет выше проверяет живое поле', () => {
    // ⚠️ Пара «разбор удался». Без неё запрет проходил бы и после того, как
    // апстрим переименует поле, — то есть молча перестал бы что-либо значить.
    // Заодно видно границу задачи: экспертный режим не тронут.
    expect(countOf(upstreamForm, 'period.label')).toBeGreaterThan(0);
    expect(countOf(upstreamForm, 'Period.label')).toBeGreaterThan(0);
  });

  it('все подписи в днях внутри формы идут через тот же плюральный ключ', () => {
    // Произвольное число дней подписывается той же строкой — иначе на одном
    // экране снова оказались бы две конвенции.
    expect(countOf(form, "t('subscription.days'")).toBe(
      countOf(form, "t('subscription.days', { count:"),
    );
  });
});

describe('список периодов существует в ОДНОЙ реализации (задача #71)', () => {
  it('файлы на месте и опознаны', () => {
    // Пара «разбор удался» для всех сторожей ниже: без неё они проходили бы на
    // пустой строке после любого переименования.
    const list = readFileSync(PERIOD_LIST, 'utf8');

    expect(list.length).toBeGreaterThan(1200);
    expect(list).toMatch(/export function PeriodOptionList\(/);
    expect(form).toMatch(/export function TariffPurchaseForm\(/);
    expect(payment).toMatch(/export function SimpleSubscriptionPayment\(/);
  });

  it('цену за месяц считает и рисует ровно один файл', () => {
    // ⚠️ Сторож по всему простому режиму, а не по двум файлам: третья копия
    // появится где-нибудь ещё, и её никто не заметит. Мутация «завести вторую
    // разметку периодов» краснеет здесь первой — своя цена за месяц нужна
    // любой такой копии.
    expect(ownersOf('getMonthlyPriceKopeks(')).toEqual([PERIOD_LIST]);
  });

  it('оба экрана зовут общий компонент, и больше его никто не зовёт', () => {
    expect(ownersOf('<PeriodOptionList')).toEqual([FORM, PAYMENT].sort());
  });

  it('ни один из двух экранов не держит своей кнопки периода', () => {
    // ⚠️ Признаки прежних двух разметок: у экрана оплаты — подпись днями
    // вручную, у формы — своя сетка по `tariff.periods`.
    expect(countOf(payment, "t('subscription.days'")).toBe(0);
    expect(countOf(payment, 'formatAmount(')).toBe(0);
    expect(countOf(form, 'sm:grid-cols-3')).toBe(0);
    expect(countOf(form, 'getMonthlyPriceKopeks')).toBe(0);
  });

  it('прежняя сетка формы разобрана в апстриме — иначе запрет выше пуст', () => {
    // Пара «разбор удался» к строке выше: сетка `sm:grid-cols-3` — это и есть
    // тот «другой по виду экран», который владелец увидел на стенде.
    expect(upstreamForm).toContain('sm:grid-cols-3');
    expect(upstreamForm).toContain('getMonthlyPriceKopeks');
  });
});

describe('функциональность формы покупки не потеряна (задача #71)', () => {
  it('оформление по СБП и привязкой Lava на месте', () => {
    // ⚠️ Дословная оговорка владельца: «главное чтобы работало». Периоды —
    // не вся форма, и рядом с ними живут вещи, которых на экране оплаты нет
    // вовсе. Мутация «вычистить форму под общий вид» краснеет здесь.
    expect(form).toContain('subscriptionApi.purchaseWithSbpRecurring(tariff.id)');
    expect(form).toContain('subscriptionApi.purchaseWithLavaRecurring(tariff.id)');
    expect(form).toContain('sbpPurchaseEnabled');
    expect(form).toContain('lavaPurchaseEnabled');
  });

  it('произвольное число дней и произвольный трафик на месте', () => {
    expect(form).toContain('tariff.custom_days_enabled');
    expect(form).toContain('setUseCustomDays(');
    expect(form).toContain('tariff.custom_traffic_enabled');
    expect(form).toContain('setCustomTrafficGb(');
  });

  it('промо-скидка по-прежнему считается формой, а не потеряна вместе с разметкой', () => {
    expect(form).toContain('usePromoDiscount');
    expect(form).toContain('applyPromoDiscount(');
    expect(form).toContain("t('promo.discountApplied')");
  });

  it('выбор периода по-прежнему выключает произвольное число дней', () => {
    // ⚠️ Связка, которую легче всего потерять при выносе разметки: без неё
    // человек тыкает период, а платит за произвольные дни.
    expect(form).toContain('setUseCustomDays(false);');
  });

  it('переход к оплате всё ещё знает выбранный период объектом', () => {
    // Сводка «К оплате» читает у периода цену и доп. устройства, поэтому общий
    // компонент отдаёт дни, а форма поднимает по ним свой `TariffPeriod`.
    expect(form).toContain('selectedTariffPeriod');
    expect(form).toContain('tariff.periods.find(');
  });
});
