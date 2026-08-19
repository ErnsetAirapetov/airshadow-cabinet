import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа ЕДИНОГО экрана оплаты подписки (задачи #29 и #69).
 *
 * ⚠️ Файл читается ТЕКСТОМ, а не импортируется: компонентных тестов страницы в
 * проекте не бывает (`environment: 'node'`, alias `@/` в тестах не
 * разрешается). Цена приёма — разбор видит только литералы, поэтому у каждого
 * блока ниже есть парная проверка «разбор удался».
 *
 * ⚠️ Зачем поверх `paymentState.test.ts`: тот доказывает, что план экрана
 * посчитан правильно, но не то, что СТРАНИЦА ему следует. А следование здесь
 * проверить больше нечем — состояние «тариф отвалился» на стенде не
 * воспроизвести, учётки под него нет.
 */

const PAGE = 'src/simple/pages/SubscriptionPayment.tsx';
/** Страница до #69 — её больше нет, оплата на этом адресе теперь одна. */
const OLD_PAGE = 'src/simple/pages/RenewSubscription.tsx';
const UPSTREAM = 'src/pages/RenewSubscription.tsx';
const REGISTRY = 'src/simple/routes.tsx';
const ACTION_STATE = 'src/simple/components/subscription/expiredAction.ts';

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
const registry = stripComments(read(REGISTRY));

/** Все исходники простого режима — для сторожей «во всём слое одна копия». */
function simpleSources(dir = 'src/simple'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) return simpleSources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

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

describe('разбор единого экрана оплаты удался (задачи #29, #69)', () => {
  it('файл на месте и опознан', () => {
    // Без этой проверки любой сторож ниже проходил бы на пустой строке.
    expect(rawPage.length).toBeGreaterThan(1200);
    expect(page).toMatch(/export function SimpleSubscriptionPayment\(/);
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(rawPage).toContain('⚠️');
    expect(page).not.toContain('⚠️');
    expect(page).toContain("queryKey: ['renewal-options', subId]");
  });

  it('оба выражения баланса извлечены — иначе сверка ниже сравнивала бы пустоту', () => {
    // ⚠️ Пара «разбор удался» именно для двух регулярок выше: сломайся любая —
    // и сторож баланса молча проходил бы всегда.
    expect(shownExpression).toBeTruthy();
    expect(affordExpression).toBeTruthy();
    expect(rootOf(shownExpression)).toBeTruthy();
  });

  it('апстримный экран разобран, и он ЖИВ — трогать его задача запрещает', () => {
    // Парная проверка к запретам ниже: без неё они проходили бы на пустой
    // строке и при переименовании апстримных полей.
    expect(upstream.length).toBeGreaterThan(1200);
    expect(upstream).toContain("queryKey: ['purchase-options', subId]");
    expect(upstream).toContain('purchaseOptions?.balance_kopeks');
    expect(upstream).toContain("t('common.balance'");
  });
});

describe('оплата подписки живёт на ОДНОМ экране (задача #69)', () => {
  it('прежней отдельной страницы продления больше нет', () => {
    // ⚠️ Владелец забраковал именно две страницы. Сторож ловит и возврат старого
    // файла, и появление второй простой страницы оплаты рядом.
    expect(existsSync(OLD_PAGE)).toBe(false);

    const owners = simpleSources().filter((file) =>
      readFileSync(file, 'utf8').includes('subscriptionApi.renewSubscription('),
    );

    expect(owners.sort()).toEqual([
      'src/simple/components/subscription/ExpiredSubscriptionAction.tsx',
      PAGE,
    ]);
  });

  it('реестр отдал апстримный адрес продления новому экрану, новых путей нет', () => {
    // ⚠️ «Новых маршрутов не заводим» — прямое требование задачи. Адрес тот же,
    // что был, меняется только компонент.
    expect(registry).toContain(
      "{ path: '/subscriptions/:subscriptionId/renew', component: SimpleSubscriptionPayment },",
    );
    expect(registry).toContain("from './pages/SubscriptionPayment'");
    expect(countOf(registry, 'SimpleRenewSubscription')).toBe(0);
    expect(countOf(registry, '/payment')).toBe(0);
    expect(countOf(registry, '/pay')).toBe(0);
  });

  it('обе кнопки оплаты ведут на этот адрес и строят его одной функцией', () => {
    // ⚠️ Второй вход — кнопка непродлеваемой подписки (#67). До #69 она вела в
    // витрину, и это и было «двумя экранами оплаты».
    const actionState = stripComments(read(ACTION_STATE));

    expect(actionState).toContain('paymentRoute(subscription.id)');
    expect(actionState).toContain("import { PURCHASE_ROUTE, paymentRoute } from './purchaseCta'");
  });
});

describe('операцию выбирает состояние, а не экран (задача #69)', () => {
  it('план экрана считает чистый модуль, страница его только зовёт', () => {
    expect(page).toContain("from './paymentState'");
    expect(page).toContain('resolvePaymentPlan({');
    expect(page).toContain('resolvePaymentTitleKey(plan)');
    expect(page).toContain('resolvePeriodPrice(');
  });

  it('страница не заводит своего правила «продлеваемая или нет»', () => {
    // ⚠️ Прямой запрет задачи: второго списка непродлеваемых статусов быть не
    // должно. Мутация «сравнить status здесь» краснеет.
    expect(countOf(page, 'NON_RENEWABLE')).toBe(0);
    expect(countOf(page, "status === 'disabled'")).toBe(0);
    expect(countOf(page, "status === 'pending'")).toBe(0);
    expect(countOf(page, 'isNonRenewableStatus')).toBe(0);
  });

  it('список непродлеваемых статусов во всём слое ОДИН', () => {
    // ⚠️ Сторож по всему простому режиму, а не по двум файлам: вторая копия
    // появится где-нибудь ещё, и её никто не заметит.
    const owners = simpleSources().filter((file) =>
      readFileSync(file, 'utf8').includes('NON_RENEWABLE_STATUSES ='),
    );

    expect(owners).toEqual([ACTION_STATE]);
  });

  it('мутация ОДНА, и эндпоинт в ней выбирает план', () => {
    // ⚠️ Сердце задачи в разметке. Две мутации с двумя кнопками — это и есть
    // два экрана, просто на одном адресе. Мутация «развести обработчики»
    // краснеет здесь.
    expect(countOf(page, 'mutationFn:')).toBe(1);
    expect(page).toContain("plan.screen === 'periods' && plan.operation === 'purchaseTariff'");
    expect(page).toContain(
      'subscriptionApi.purchaseTariff(plan.tariffId, periodDays, undefined, subId)',
    );
    expect(page).toContain('subscriptionApi.renewSubscription(periodDays, subId)');
    expect(countOf(page, 'payMutation.mutate(')).toBe(1);
  });

  it('кнопка оплаты одна на обе операции', () => {
    expect(countOf(page, 'onClick={() => handlePay(selectedPeriod)}')).toBe(1);
    expect(countOf(page, 'payMutation.isPending')).toBe(2);
  });

  it('сроки берутся из плана, а не из ответа одного эндпоинта', () => {
    // ⚠️ `options.map` по `renewal-options` — ровно то, что делало экран
    // пустым для непродлеваемых статусов: этот эндпоинт отдаёт им пустой
    // список (`renewal.py:53-57`).
    expect(page).toContain('plan.periods.map((period)');
    expect(countOf(page, 'options.map(')).toBe(0);
    expect(countOf(page, 'renewalOptions.map(')).toBe(0);
  });

  it('промо-скидка применяется только там, где план разрешил', () => {
    // ⚠️ Двойная скидка на экране = списание не той суммы, которую человек
    // видел. Мутация «применять всегда» краснеет здесь.
    expect(page).toContain('plan.promoDiscountable');
    expect(countOf(page, 'applyPromoDiscount(')).toBe(1);
  });
});

describe('отвалившийся тариф уводит в сетку выбора с баннером (задача #69)', () => {
  it('сетка — общая секция каталога, а не своя копия', () => {
    expect(page).toContain("plan.screen === 'pickTariff' ? (");
    expect(page).toContain('<TariffCatalogSection');
    expect(page).toContain("from '../components/subscription/purchase/TariffCatalogSection'");
    // Второй реализации перехода «сразу к форме» задача заводить запрещает.
    expect(countOf(page, 'setShowTariffPurchase')).toBe(0);
    expect(countOf(page, '<TariffPickerGrid')).toBe(0);
    expect(countOf(page, '<TariffPurchaseForm')).toBe(0);
  });

  it('решение про баннер принимает план, а не разметка', () => {
    // ⚠️ Своё условие в разметке разъехалось бы с правилом молча — и человеку
    // без подписки экран соврал бы, что его тариф отвалился.
    expect(page).toContain('unsupportedTariffBanner={plan.unsupportedTariffBanner}');
    expect(countOf(page, 'is_trial')).toBe(0);
    expect(countOf(page, 'tariff_id')).toBe(0);
  });

  it('пустого экрана без содержимого не остаётся', () => {
    // ⚠️ Прямой запрет задачи. Прежний экран рисовал плашку «Нет доступных
    // вариантов продления» и оставлял человека без действия; теперь это
    // состояние ведёт в сетку выбора.
    expect(countOf(page, "t('subscription.noRenewalOptions'")).toBe(0);
    // Пара «разбор удался»: строка жива в апстримном экране, то есть запрет
    // выше проверяет реальный ключ, а не опечатку.
    expect(upstream).toContain("t('subscription.noRenewalOptions'");
  });
});

describe('баланс показывается и считается ОДНИМ числом (задача #29)', () => {
  it('виджету и расчёту доступности достаётся одна и та же величина', () => {
    // ⚠️ Сторож не сверяет текст, а извлекает оба выражения и требует общего
    // корня: `renewBalance.rubles` показывается, `renewBalance.kopeks` считает
    // — одна переменная, один вызов, один момент времени.
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
    expect(page).toContain("from '../components/BalanceWidget'");
    expect(page).toContain('useBalanceQuery()');
  });

  it('второго источника баланса на странице нет', () => {
    // ⚠️ Ловушка #29 осталась закрытой и после #69. Запрос `purchase-options`
    // на экране теперь ЕСТЬ — он нужен ради каталога тарифов, — но его
    // `balance_kopeks` страница не читает: разойдись показанное число с
    // расчётным, виджет писал бы одну сумму, а кнопка периода «не хватает» по
    // другой. Копейки формы покупки берёт секция каталога, у неё свой экран.
    expect(countOf(page, 'balance_kopeks')).toBe(0);
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

  it('сброс кэшей после оплаты сохранён', () => {
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: ['balance'] })");
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: ['purchase-options'] })");
    expect(page).toContain('navigate(`/subscriptions/${subId}`, { replace: true })');
  });

  it('состояния экрана сохранены: спиннер, ошибка загрузки, уход без id', () => {
    expect(page).toContain('animate-spin');
    expect(page).toContain('<Navigate to="/subscriptions" replace />');
    expect(page).toContain("t('subscription.loadError'");
  });

  it('цена за месяц и скидка периода остались', () => {
    expect(page).toContain('getMonthlyPriceKopeks(price.priceKopeks, period.periodDays)');
    expect(page).toContain('price.discountPercent > 0');
    expect(page).toContain('price.originalPriceKopeks');
  });
});
