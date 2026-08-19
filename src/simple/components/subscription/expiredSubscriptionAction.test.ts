import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторож общего блока действия истёкшей подписки (задача #65).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются: компонентных тестов в проекте
 * не бывает (`environment: 'node'`, alias `@/` в тестах не разрешается,
 * docs/architecture/two-modes.md, раздел «Тесты»). Цена приёма — разбор видит
 * только записанное литералом, поэтому у каждой проверки ниже есть парная
 * «разбор удался».
 *
 * Что охраняется и почему:
 *
 * 1. **Блок один на два экрана.** Это прямой урок #61: кнопка подключения жила
 *    двумя копиями, копии разошлись молча при зелёной сборке, и владелец увидел
 *    это на стенде. Здесь у блока два места вызова — карточка главной и
 *    страница подписки, — поэтому проверяется не «обе копии одинаковые», а
 *    «копия ровно одна».
 * 2. **Механизм целиком внутри блока:** мутация продления, отказ по нехватке
 *    средств, переход на пополнение, порог баланса. Расчёт, вынесенный на экран,
 *    и есть начало второй копии.
 * 3. **Отказ API перебивает грубую проверку баланса.** `hasBalanceForRenew` не
 *    знает цены продления, поэтому без `renewFailedInsufficientBalance` на
 *    экране осталась бы кнопка «Продлить» и ни одного рабочего действия.
 * 4. **Решение «продлить или пополнить» — импортом, а не копией.** Правило
 *    живёт в `pages/dashboardState.ts`; вторая его запись разъехалась бы молча.
 */

const ACTION = 'src/simple/components/subscription/ExpiredSubscriptionAction.tsx';
/** Чистый модуль блока: порог баланса и выбор операции. */
const ACTION_STATE = 'src/simple/components/subscription/expiredAction.ts';
/** Место вызова на главной — там разметка блока и жила. */
const EXPIRED_CARD = 'src/simple/components/dashboard/SubscriptionCardExpired.tsx';
/** Второе место вызова — страница подписки. */
const PAGE = 'src/simple/pages/Subscription.tsx';
/** Апстримная карточка — пара «нужные сочетания в коде вообще встречаются». */
const UPSTREAM_CARD = 'src/components/dashboard/SubscriptionCardExpired.tsx';
/** Общий запрос баланса простого режима — там живёт связка «ключ + queryFn». */
const BALANCE_WIDGET = 'src/simple/components/BalanceWidget.tsx';
/** Адрес витрины живёт здесь — блок берёт его оттуда, а не пишет литералом. */
const PURCHASE_CTA = 'src/simple/components/subscription/purchaseCta.ts';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны — докстринги сами упоминают запрещённые слова. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const action = stripComments(read(ACTION));
const actionState = stripComments(read(ACTION_STATE));
const card = stripComments(read(EXPIRED_CARD));
const page = stripComments(read(PAGE));
const upstream = stripComments(read(UPSTREAM_CARD));
const balanceWidget = stripComments(read(BALANCE_WIDGET));
const purchaseCta = stripComments(read(PURCHASE_CTA));

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/**
 * Механизм блока, который апстрим держит в своей карточке целиком. Служит
 * заодно парой «иголки настоящие»: все четыре обязаны найтись в апстримном
 * файле, иначе запреты ниже проходили бы на опечатках.
 */
const UPSTREAM_MECHANISM_NEEDLES = [
  'renewSubscription(',
  'purchaseTariff(',
  '/balance/top-up?',
  "t('dashboard.expired.topUp')",
];

/**
 * Наши части механизма — в апстриме их нет вовсе (#49, #65), поэтому парой
 * «иголка настоящая» служит требование «ровно один раз в блоке» ниже.
 */
const OUR_MECHANISM_NEEDLES = ['renewFailedInsufficientBalance', 'resolveExpiredCardAction('];

/** Всё, из чего состоит механизм: на экранах не должно быть ни одной строки. */
const MECHANISM_NEEDLES = [...UPSTREAM_MECHANISM_NEEDLES, ...OUR_MECHANISM_NEEDLES];

/**
 * Строки, которых в блоке ровно одна: вторая означала бы вторую копию
 * механизма внутри самого блока. `renewFailedInsufficientBalance` сюда не
 * входит — это имя состояния, оно встречается объявлением, сбросом и чтением.
 */
const SINGLE_COPY_NEEDLES = [...UPSTREAM_MECHANISM_NEEDLES, 'resolveExpiredCardAction('];

describe('разбор удался', () => {
  it('общий запрос баланса прочитан — иначе связка сторожила бы пустоту', () => {
    // Без этой пары регэксп «ключ + queryFn рядом» проходил бы на пустой строке
    // после переименования файла виджета.
    expect(balanceWidget.length).toBeGreaterThan(500);
    expect(balanceWidget).toContain('export function useBalanceQuery()');
  });

  it('все пять файлов прочитаны и не пусты', () => {
    // Без этого файл, переименованный или удалённый, дал бы пустую строку — и
    // все проверки «этого здесь нет» проходили бы, ничего не охраняя.
    expect(action.length).toBeGreaterThan(1000);
    expect(actionState.length).toBeGreaterThan(500);
    expect(card.length).toBeGreaterThan(3000);
    expect(page.length).toBeGreaterThan(10_000);
    expect(upstream.length).toBeGreaterThan(3000);
  });

  it('прочитан именно блок действия', () => {
    expect(action).toContain('export function ExpiredSubscriptionAction(');
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(read(ACTION)).toContain('задача #65');
    expect(action).not.toContain('задача #65');
  });

  it('искомые сочетания в коде вообще встречаются — иначе запреты пустые', () => {
    // Пара для правил «на экранах механизма нет». Апстримная карточка держит
    // тот же механизм целиком — значит иголки настоящие, а не опечатки.
    for (const needle of UPSTREAM_MECHANISM_NEEDLES) {
      expect(`${needle}: ${upstream.includes(needle)}`).toBe(`${needle}: true`);
    }
  });
});

describe('блок действия — один на два экрана (#65, урок #61)', () => {
  it('механизм записан ровно в одном файле', () => {
    // ⚠️ Сердце сторожа. Мутация «второй экран рисует свой блок» краснеет
    // здесь: любая копия принесёт с собой мутацию продления и переход на
    // пополнение.
    for (const needle of MECHANISM_NEEDLES) {
      expect(`${needle} в блоке: ${action.includes(needle)}`).toBe(`${needle} в блоке: true`);
      expect(`${needle} на главной: ${card.includes(needle)}`).toBe(`${needle} на главной: false`);
      expect(`${needle} на странице: ${page.includes(needle)}`).toBe(
        `${needle} на странице: false`,
      );
    }
  });

  it('внутри блока механизм тоже не задваивается', () => {
    // Копия могла бы завестись и здесь — двумя кнопками в одной разметке.
    for (const needle of SINGLE_COPY_NEEDLES) {
      expect(`${needle}: ${countOf(action, needle)}`).toBe(`${needle}: 1`);
    }
  });

  it('оба экрана зовут общий блок ровно по разу', () => {
    expect(countOf(card, '<ExpiredSubscriptionAction')).toBe(1);
    expect(countOf(page, '<ExpiredSubscriptionAction')).toBe(1);
  });

  it('оба экрана берут блок из общего модуля', () => {
    expect(card).toContain("from '../subscription/ExpiredSubscriptionAction'");
    expect(page).toContain("from '../components/subscription/ExpiredSubscriptionAction'");
  });

  it('порог баланса считает чистый модуль, а не экраны', () => {
    // Два расчёта разъехались бы молча: подпись баланса зелёная, а кнопка ведёт
    // на пополнение (или наоборот).
    expect(actionState).toContain('MIN_RENEW_BALANCE_KOPEKS');
    expect(action).toContain('hasBalanceForRenew(');
    expect(card).toContain('hasBalanceForRenew(');
    for (const source of [action, card, page]) {
      expect(source).not.toContain('balanceKopeks >=');
    }
  });

  it('в апстримной карточке порог записан прямо в разметке — было именно так', () => {
    expect(upstream).toContain('balanceKopeks >=');
  });

  it('выбор операции продления берётся из чистого модуля', () => {
    // Три ветки (снять с паузы / купить день / продлить период) лечат разные
    // отказы бэкенда, и проверить их можно только вызовом функции.
    expect(action).toContain('resolveExpiredRenewOperation(');
    expect(action).toContain("case 'resumeDaily'");
    expect(action).toContain("case 'purchaseDailyTariff'");
  });
});

describe('отказ по нехватке средств перебивает грубую проверку баланса (#65)', () => {
  it('решение «продлить или пополнить» приходит из dashboardState, а не пишется заново', () => {
    expect(action).toContain('resolveExpiredCardAction({');
    expect(action).toContain('renewFailedInsufficientBalance');
    expect(action).toContain('hasBalance');
  });

  it('флаг отказа поднимается там, где распознан отказ по средствам', () => {
    // ⚠️ Без этого после отказа на экране остаётся кнопка «Продлить» и ни
    // одного рабочего действия: `hasBalanceForRenew` цены продления не знает.
    expect(action).toContain('getInsufficientBalanceError(');
    expect(action).toContain('setRenewFailedInsufficientBalance(true)');
  });

  it('флаг сбрасывается перед новой попыткой', () => {
    // Иначе кнопка «Пополнить баланс» залипала бы после пополнения.
    expect(action).toContain('setRenewFailedInsufficientBalance(false)');
  });

  it('после успеха обновляются и баланс, и опции покупки', () => {
    expect(action).toContain("queryKey: ['balance']");
    expect(action).toContain("queryKey: ['purchase-options']");
  });
});

describe('непродлеваемый статус: переход в витрину, а не мутация (#67)', () => {
  it('разбор удался — источник запрета назван в чистом модуле, с файлом и строками', () => {
    // ⚠️ Список статусов сверяется с реальностью НЕ НА ВЕРУ: в докстринге
    // константы стоит ссылка на код бэкенда, по которому её можно перепроверить
    // через полгода. Читается СЫРОЙ текст — в `actionState` комментарии вырезаны.
    const raw = read(ACTION_STATE);

    expect(raw.length).toBeGreaterThan(500);
    expect(raw).toContain('renewal.py:130-136');
    expect(raw).toContain('helpers.py:205');
    // Пара: сама константа — код, а не проза докстринга.
    expect(actionState).toContain('export const NON_RENEWABLE_STATUSES');
  });

  it('у кнопки витрины есть своя ветка, и она не зовёт мутацию', () => {
    // ⚠️ Мутация «отдать этому состоянию обычную кнопку продления» краснеет
    // здесь: бэкенд отвечает на такое продление 400 (задача #67).
    expect(action).toContain("button === 'purchase'");
    // Перенос строки внутри тега ставит prettier — сторож смотрит на связку
    // «ссылка + адрес», а не на раскладку.
    expect(action).toMatch(/<Link\s+to=\{operation\.to\}/);
  });

  it('ветка витрины стоит ПЕРВОЙ — раньше заглушки, продления и пополнения', () => {
    // ⚠️ Порядок веток разметки повторяет порядок правила: решение про витрину
    // баланса не спрашивает вовсе. Перестановка ниже заглушки вернула бы
    // человеку с непродлеваемой подпиской спиннер вместо действия.
    const purchase = action.indexOf("button === 'purchase'");
    const pending = action.indexOf("button === 'pending'");

    expect(purchase).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(-1);
    expect(purchase).toBeLessThan(pending);
    expect(purchase).toBeLessThan(action.indexOf('onClick={handleRenew}'));
    expect(purchase).toBeLessThan(action.indexOf('onClick={handleTopUp}'));
  });

  it('адрес перехода приходит ОПЕРАЦИЕЙ, а не литералом в блоке (#69)', () => {
    // ⚠️ Копия литерала разъехалась бы с правилом молча. С #69 адрес считает
    // `resolveExpiredRenewOperation` — тот же единый экран оплаты, что у кнопки
    // продления активной подписки. Мутация «вернуть в разметку витрину»
    // краснеет здесь: на стенде это состояние воспроизвести нечем.
    expect(action).not.toContain("'/subscription/purchase'");
    expect(action).not.toContain('PURCHASE_ROUTE');
    expect(action).not.toContain('/renew');

    // Пары «разбор удался»: оба адреса объявлены в общем модуле, и оба
    // достаются операции, а не разметке.
    expect(purchaseCta).toContain("export const PURCHASE_ROUTE = '/subscription/purchase'");
    expect(purchaseCta).toContain('export function paymentRoute(');
    expect(actionState).toContain("import { PURCHASE_ROUTE, paymentRoute } from './purchaseCta'");
    expect(actionState).toContain('paymentRoute(subscription.id)');
  });

  it('подпись кнопки витрины берётся правилом, а не пишется в разметке', () => {
    // Ключ один на два экрана и подменой места вызова не перебивается —
    // проверено вызовом функции в `expiredAction.test.ts`.
    expect(actionState).toContain('PURCHASE_LABEL_KEY');
    expect(action).not.toContain('subscription.getSubscription');
  });
});

describe('различия мест вызова — пропами, а не ветками внутри (#65, урок #61)', () => {
  it('внешний отступ приходит пропом и применяется к корню блока', () => {
    // ⚠️ Мутация «зашить отступ в блок» краснеет здесь: на главной блок стоит
    // последним в карточке и отступа не просит, а на странице подписки под ним
    // идёт ссылка подписки — там отступ нужен. Зашитый в блок, он был бы лишним
    // ровно на одном из двух экранов.
    expect(action).toContain('className={className}');
    expect(page).toMatch(/<ExpiredSubscriptionAction[\s\S]{0,400}?className="mb-/);
    expect(card).not.toMatch(/<ExpiredSubscriptionAction[\s\S]{0,200}?className="mb-/);
  });

  it('внутри блока нет ветвления по месту вызова', () => {
    for (const forbidden of ['isDashboard', 'onDashboard', 'variant', 'isSubscriptionPage']) {
      expect(`${forbidden}: ${action.includes(forbidden)}`).toBe(`${forbidden}: false`);
    }
  });

  it('возврат с пополнения берётся из маршрута, а не пишется литералом', () => {
    // ⚠️ Третье различие мест вызова, и единственное, которое блок обязан
    // вычислить сам: `returnTo` у него один на два экрана. Литерал здесь —
    // молчаливый дефект ровно одного из них: с главной человек возвращался бы
    // на страницу подписки либо наоборот, сборке и типам всё равно.
    // Мутация `params.set('returnTo', '/subscriptions')` красит эту проверку.
    expect(action).toContain("params.set('returnTo', location.pathname)");
    // И адрес не подменён рядом: пути простого режима в блоке не записаны
    // литералом вовсе, кроме самого адреса пополнения.
    expect(action).not.toContain("'/subscriptions'");
    expect(action).not.toContain("'/subscription'");
  });
});

describe('страница подписки: одно действие у истёкшей (#65)', () => {
  it('видимость решает чистый модуль, а не ветка в разметке', () => {
    // Условие в JSX проверить нечем; правило живёт в `subscriptionState.ts` и
    // проверяется вызовом в `subscriptionState.test.ts`.
    expect(page).toContain('resolveSubscriptionCardActions(');
    expect(page).toContain('cardActions.connectDevice &&');
    expect(page).toContain('cardActions.expiredAction &&');
  });

  it('своего условия «истекла» на странице не появилось', () => {
    // Второе правило разъехалось бы с `purchaseCta` молча: две кнопки или ни
    // одной.
    expect(page).not.toContain('!subscription.is_active &&');
    expect(page).not.toContain('isExpiredPaidSubscription(');
  });

  it('баланс приходит общим запросом простого режима, а не копией на странице', () => {
    // ⚠️ Прежняя проверка искала здесь подстроку `queryKey: ['balance']` — и
    // была ложно-зелёной: та же строка стоит в `pauseMutation.onSuccess`
    // страницы с прошлых задач, поэтому неправильный ключ нового запроса
    // проверку проходил (ревью доказало подменой на `['page-balance']`).
    //
    // Правильный ответ оказался проще сторожа: запрос с этим ключом уже
    // объявлен один раз рядом с виджетом баланса, и страница зовёт его.
    expect(page).toContain('useBalanceQuery()');
    expect(page).not.toContain('balanceApi.getBalance');

    // Связка «ключ + queryFn рядом» — в общем запросе. Разъедься ключ, и блок не
    // заметил бы пополнения: его мутация инвалидирует именно `['balance']`.
    expect(balanceWidget).toMatch(
      /queryKey: \['balance'\],\s*\n\s*queryFn: balanceApi\.getBalance/,
    );
  });

  it('связка проверяется именно связкой — одна строка инвалидации её не подделывает', () => {
    // Пара «разбор удался» к регэкспу выше: та самая строка, из-за которой
    // прежняя проверка ничего не значила.
    const invalidation = "queryClient.invalidateQueries({ queryKey: ['balance'] });";

    expect(page).toContain(invalidation);
    expect(action).toContain("queryKey: ['balance']");
    expect(invalidation).not.toMatch(
      /queryKey: \['balance'\],\s*\n\s*queryFn: balanceApi\.getBalance/,
    );
  });

  it('пока баланс грузится, кнопка не предлагает пополнение', () => {
    // ⚠️ Решение по нулевому балансу показывать нельзя: 200–400 мс единственной
    // кнопкой экрана было бы «Пополнить баланс», и человек с деньгами успевает
    // её нажать. Правило — в чистом модуле, разметка читает его результат.
    expect(action).toContain('resolveExpiredActionButton({ operation, action, isBalanceLoading })');
    expect(action).toContain("button === 'pending'");
    expect(page).toContain('isBalanceLoading={isBalancePending}');
    // На главной сумма баланса стоит рядом с кнопкой, флаг там не нужен, и
    // `Dashboard.tsx` эта задача не трогает (границы #65).
    expect(card).not.toContain('isBalanceLoading');
  });

  it('подпись продления приходит пропом, а страница просит длинную', () => {
    // Решение владельца от 19.08.2026: «Продлить подписку» — только на странице
    // подписки, на главной остаётся короткое «Продлить».
    expect(action).toContain('resolveExpiredActionLabelKey(operation, renewLabelKey)');
    expect(action).toContain('renewLabelKey = DEFAULT_RENEW_LABEL_KEY');
    expect(page).toContain('renewLabelKey={PAGE_RENEW_LABEL_KEY}');
    // Карточка главной подписи не передаёт — короткая приходит дефолтом.
    expect(card).not.toContain('renewLabelKey');
  });

  it('`subscription.id` уходит в покупку суточного тарифа четвёртым аргументом', () => {
    // ⚠️ Без него бэкенд ищет строку по `(user_id, tariff_id)` и проигрывает
    // гонку с вебхуками панели — это всплывало как «Тариф уже активен» плюс
    // возврат средств. Мутация «убрать id из вызова» краснеет здесь.
    expect(action).toMatch(
      /purchaseTariff\(\s*operation\.tariffId,\s*operation\.days,\s*undefined,\s*subscription\.id,\s*\)/,
    );
    expect(action).toMatch(/renewSubscription\(operation\.days, subscription\.id\)/);
  });

  it('ветка продления ведёт на продление, а не на пополнение', () => {
    // ⚠️ Переворот ветки выдал бы «Пополнить баланс» тем, у кого деньги есть, —
    // и наоборот. Ни сборка, ни типы этого не видят.
    expect(action).toMatch(/button === 'renew' \?[\s\S]{0,200}?onClick=\{handleRenew\}/);
    expect(action).toMatch(/button === 'pending' \?[\s\S]{0,300}?disabled\s*\n/);
    // Пополнение — в последней ветке, после продления.
    expect(action.indexOf('onClick={handleRenew}')).toBeLessThan(
      action.indexOf('onClick={handleTopUp}'),
    );
  });
});
