import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа простого экрана продления (задача #29).
 *
 * ⚠️ Файл читается ТЕКСТОМ, а не импортируется: компонентных тестов в проекте не
 * бывает (`environment: 'node'`, alias `@/` в тестах не разрешается). Цена
 * приёма — разбор видит только литералы, поэтому у каждого блока ниже есть
 * парная проверка «разбор удался».
 *
 * Зачем поверх `renewState.test.ts`: тот доказывает, что чистые функции считают
 * правильно, но не то, что СТРАНИЦА ими пользуется. Без сторожей ниже можно было
 * вернуть баланс из `purchase-options` обратно — и `npm test` остался бы
 * зелёным, а на экране снова разъехались бы два числа: виджет показывает одну
 * сумму, кнопка периода пишет «не хватает» по другой.
 */

const PAGE = 'src/simple/pages/RenewSubscription.tsx';
const UPSTREAM = 'src/pages/RenewSubscription.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны — разбор смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const rawPage = read(PAGE);
const page = stripComments(rawPage);
const upstream = stripComments(read(UPSTREAM));

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/**
 * Выражение, которое уходит виджету баланса пропом.
 *
 * Извлекается, а не сверяется текстом: сторож проверяет, ОТКУДА взято число, а
 * не как оно записано.
 */
const shownExpression = page.match(/<BalanceWidget[^/>]*balanceRubles=\{([^}]+)\}/)?.[1]?.trim();

/** Первый аргумент расчёта доступности — то число, по которому считается «хватает ли». */
const affordExpression = page.match(/resolveRenewOptionState\(\s*([^,]+),/)?.[1]?.trim();

/** Корень выражения `renewBalance.rubles` → `renewBalance`. */
function rootOf(expression: string | undefined): string | undefined {
  return expression?.split('.')[0].trim();
}

describe('разбор экрана продления удался (задача #29)', () => {
  it('файл на месте и опознан', () => {
    // Без этой проверки любой сторож ниже проходил бы на пустой строке.
    expect(rawPage.length).toBeGreaterThan(1200);
    expect(page).toMatch(/export function SimpleRenewSubscription\(/);
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(rawPage).toContain('⚠️');
    expect(page).not.toContain('⚠️');
    expect(page).toContain("queryKey: ['renewal-options', subId]");
  });

  it('оба выражения баланса извлечены — иначе сверка ниже сравнивала бы пустоту', () => {
    // ⚠️ Пара «разбор удался» именно для двух регулярок ниже: сломайся любая —
    // и главный сторож задачи молча проходил бы всегда.
    expect(shownExpression).toBeTruthy();
    expect(affordExpression).toBeTruthy();
    expect(rootOf(shownExpression)).toBeTruthy();
  });

  it('апстримный экран разобран, и он ЖИВ — трогать его задача запрещает', () => {
    // Парная проверка к запретам ниже: без неё они проходили бы на пустой строке
    // и при переименовании апстримных полей.
    expect(upstream.length).toBeGreaterThan(1200);
    expect(upstream).toContain("queryKey: ['purchase-options', subId]");
    expect(upstream).toContain('purchaseOptions?.balance_kopeks');
    expect(upstream).toContain("t('common.balance'");
  });
});

describe('баланс показывается и считается ОДНИМ числом (задача #29)', () => {
  it('виджету и расчёту доступности достаётся одна и та же величина', () => {
    // ⚠️ Сердце задачи. Сторож не сверяет текст, а извлекает оба выражения и
    // требует общего корня: `renewBalance.rubles` показывается,
    // `renewBalance.kopeks` считает — одна переменная, один вызов, один момент
    // времени. Мутация: подставить виджету любое другое выражение — краснеет.
    expect(rootOf(shownExpression)).toBe(rootOf(affordExpression));
    expect(shownExpression).toMatch(/\.rubles$/);
    expect(affordExpression).toMatch(/\.kopeks$/);
  });

  it('этот корень — результат единственного вызова resolveRenewBalance', () => {
    // Два вызова = два объекта = снова два числа, пусть и из одного запроса.
    const root = rootOf(shownExpression);

    expect(page).toMatch(new RegExp(`const\\s+${root}\\s*=\\s*resolveRenewBalance\\(`));
    expect(countOf(page, 'resolveRenewBalance(')).toBe(1);
  });

  it('источник — тот же запрос, который читает виджет', () => {
    // `useBalanceQuery` объявлен рядом с `BalanceWidget` и держит ключ
    // `['balance']`: параметры запроса объявлены один раз на оба места.
    expect(page).toContain("from '../components/BalanceWidget'");
    expect(page).toContain('useBalanceQuery()');
  });

  it('второго источника баланса на странице нет', () => {
    // ⚠️ Ровно та ловушка, которую спека велела закрыть явно. Апстрим держал
    // здесь запрос `purchase-options` только ради баланса; вернись он — числа
    // снова разъедутся.
    expect(countOf(page, 'purchase-options')).toBe(0);
    expect(countOf(page, 'balance_kopeks')).toBe(0);
    expect(countOf(page, 'getPurchaseOptions')).toBe(0);
  });

  it('инлайнового блока баланса больше нет — его место занял виджет', () => {
    expect(page).not.toContain("t('common.balance'");
    expect(page).toContain('<BalanceWidget');
  });
});

describe('остальное продление перенесено как есть (задача #29)', () => {
  it('недостача считается чистой функцией, а не разбором строки на месте', () => {
    expect(page).toContain('resolveMissingAmountKopeks(error)');
    expect(page).toContain('resolveRenewOptionState(');
    expect(countOf(page, 'insufficient:(')).toBe(0);
  });

  it('плашка пополнения на месте — иначе покупка упирается в тупик', () => {
    expect(page).toContain('InsufficientBalancePrompt');
    expect(page).toContain('missingAmountKopeks={missingAmount}');
  });

  it('мутация продления и сброс кэшей сохранены', () => {
    expect(page).toContain('subscriptionApi.renewSubscription(periodDays, subId)');
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: ['balance'] })");
    expect(page).toContain('navigate(`/subscriptions/${subId}`, { replace: true })');
  });

  it('состояния экрана сохранены: спиннер, пустой список, ошибка', () => {
    expect(page).toContain('animate-spin');
    expect(page).toContain("t('subscription.noRenewalOptions'");
    expect(page).toContain('<Navigate to="/subscriptions" replace />');
  });

  it('цена за месяц и скидка периода остались', () => {
    expect(page).toContain('getMonthlyPriceKopeks(option.price_kopeks, option.period_days)');
    expect(page).toContain('option.discount_percent > 0');
    expect(page).toContain('option.original_price_kopeks');
  });
});
