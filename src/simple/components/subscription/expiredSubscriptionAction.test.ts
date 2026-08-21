import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторож общего блока действия истёкшей подписки (задачи #65, #70).
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
 * 2. **Действие истёкшей подписки — ПЕРЕХОД, а не оплата (#70).** Ни мутации
 *    продления, ни покупки срока, ни решения по остатку баланса ни в блоке, ни
 *    на экранах быть не должно: цену продления карточка не знает и знать не
 *    может, а на экране оплаты она известна и там уже работает механизм «не
 *    хватает столько-то, пополнить».
 * 3. **Возобновление суточной подписки НЕ переехало** — это граница #70: там
 *    `togglePause`, то есть возврат списаний, а не покупка срока.
 * 4. **Адрес перехода — одна функция маршрута**, литерала в разметке нет.
 *
 * ⚠️ Чего здесь БОЛЬШЕ НЕТ и почему. До #70 тут стояли сторожа порога баланса
 * («порог считает чистый модуль, а не экраны»), флага
 * `renewFailedInsufficientBalance` и заглушки на время загрузки баланса. Все три
 * охраняли требования, которые владелец снял, и оставить их зелёными на пустоте
 * значило бы соврать следующему читателю: он решил бы, что порог всё ещё
 * где-то живёт. Удалены вместе с кодом.
 */

const ACTION = 'src/simple/components/subscription/ExpiredSubscriptionAction.tsx';
/** Чистый модуль блока: выбор операции и подписи. */
const ACTION_STATE = 'src/simple/components/subscription/expiredAction.ts';
/** Место вызова на главной — там разметка блока и жила. */
const EXPIRED_CARD = 'src/simple/components/dashboard/SubscriptionCardExpired.tsx';
/** Второе место вызова — страница подписки. */
const PAGE = 'src/simple/pages/Subscription.tsx';
/** Апстримная карточка — пара «нужные сочетания в коде вообще встречаются». */
const UPSTREAM_CARD = 'src/components/dashboard/SubscriptionCardExpired.tsx';
/** Общий запрос баланса простого режима — там живёт связка «ключ + queryFn». */
const BALANCE_WIDGET = 'src/simple/components/BalanceWidget.tsx';
/** Адрес оплаты живёт здесь — модуль берёт его оттуда, а не пишет литералом. */
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
 * Оплата с карточки: мутации покупки срока и переход на пополнение.
 *
 * ⚠️ До #70 всё это стояло в блоке, и владелец забраковал результат: кнопка
 * обещала продление, которого не будет, либо требовала пополнения, не называя
 * суммы. Теперь этого нет ни в блоке, ни на экранах — платят на экране оплаты.
 *
 * Апстримная карточка держит тот же механизм целиком, поэтому она же служит
 * парой «иголки настоящие, а не опечатки».
 */
const PAYMENT_NEEDLES = [
  'subscriptionApi.renewSubscription',
  'subscriptionApi.purchaseTariff',
  '/balance/top-up?',
  "t('dashboard.expired.topUp')",
];

/**
 * Решение по остатку баланса. Тоже есть в апстримной карточке (там порог
 * записан прямо в разметке), то есть иголки живые.
 */
const BALANCE_DECISION_NEEDLES = ['balanceKopeks', 'hasBalance'];

/**
 * Снятые вместе с кодом имена простого режима.
 *
 * ⚠️ ЧЕСТНО ПРО ПАРУ: живой копии у этих трёх нет нигде — они удалены целиком,
 * поэтому опечатка в иголке прошла бы незамеченной. Настоящий сторож для них не
 * текстовый, а типовой: `resolveExpiredCardAction` и `hasBalanceForRenew`
 * больше не экспортируются, и любое обращение к ним валит `npx tsc --noEmit`
 * (`editChecks` харнеса) до всякого теста. Проверка ниже — второй рубеж на
 * случай, если имя воскреснет локальной копией.
 */
const REMOVED_NEEDLES = [
  'renewFailedInsufficientBalance',
  'resolveExpiredCardAction',
  'hasBalanceForRenew',
  'resolveExpiredActionButton',
  'isBalanceLoading',
];

/** Наши файлы, в которых оплаты и порога быть не должно вовсе. */
const OUR_SOURCES: { name: string; code: string }[] = [
  { name: 'блок', code: action },
  { name: 'чистый модуль', code: actionState },
  { name: 'карточка главной', code: card },
  { name: 'страница подписки', code: page },
];

describe('разбор удался', () => {
  it('общий запрос баланса прочитан — иначе связка сторожила бы пустоту', () => {
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
    expect(read(ACTION)).toContain('задача');
    expect(action).not.toContain('задача');
  });

  it('искомые сочетания в коде вообще встречаются — иначе запреты пустые', () => {
    // Пара для правил «оплаты и порога у нас нет». Апстримная карточка держит
    // ровно тот механизм, который простой режим унёс на экран оплаты, — значит
    // иголки настоящие.
    for (const needle of [...PAYMENT_NEEDLES, ...BALANCE_DECISION_NEEDLES]) {
      expect(`${needle}: ${upstream.includes(needle)}`).toBe(`${needle}: true`);
    }
  });
});

describe('действие истёкшей подписки — переход, а не оплата (#70)', () => {
  it('НИ ОДИН наш файл не платит с карточки', () => {
    // ⚠️ Сердце #70. Мутация «вернуть блоку продление» краснеет здесь, причём
    // сразу на всех четырёх файлах: расчёт, унесённый на экран, и есть начало
    // второй копии.
    for (const { name, code } of OUR_SOURCES) {
      for (const needle of PAYMENT_NEEDLES) {
        expect(`${needle} в «${name}»: ${code.includes(needle)}`).toBe(
          `${needle} в «${name}»: false`,
        );
      }
    }
  });

  it('решения по остатку баланса нет ни в блоке, ни на экранах', () => {
    // ⚠️ Мутация «вернуть проверку остатка» краснеет здесь. Порог отвечал лишь
    // на «есть ли хоть рубль», цену продления он не знал — из-за этого при
    // 100 ₽ кнопка обещала продление, которого не будет.
    for (const { name, code } of OUR_SOURCES) {
      for (const needle of BALANCE_DECISION_NEEDLES) {
        expect(`${needle} в «${name}»: ${code.includes(needle)}`).toBe(
          `${needle} в «${name}»: false`,
        );
      }
    }
  });

  it('имена снятых требований не воскресли', () => {
    for (const { name, code } of OUR_SOURCES) {
      for (const needle of REMOVED_NEEDLES) {
        expect(`${needle} в «${name}»: ${code.includes(needle)}`).toBe(
          `${needle} в «${name}»: false`,
        );
      }
    }
  });

  it('страница подписки больше не запрашивает баланс ради этой кнопки', () => {
    // ⚠️ Запрос жил там только ради порога и заглушки «баланс ещё грузится».
    // Порога нет — не нужен и запрос. Пара: сам запрос никуда не делся и
    // по-прежнему объявлен один раз рядом с виджетом баланса.
    expect(page).not.toContain('useBalanceQuery');
    expect(balanceWidget).toContain('export function useBalanceQuery()');
    expect(balanceWidget).toMatch(
      /queryKey: \['balance'\],\s*\n\s*queryFn: balanceApi\.getBalance/,
    );
  });

  it('кнопка блока — ссылка, и адрес ей приносит операция', () => {
    // Перенос строки внутри тега ставит prettier — сторож смотрит на связку
    // «ссылка + адрес», а не на раскладку.
    expect(action).toMatch(/<Link\s+to=\{operation\.to\}/);
    expect(countOf(action, 'operation.to')).toBe(1);
  });

  it('литерала адреса в блоке нет — переход строит единственная функция', () => {
    // ⚠️ Копия литерала разъехалась бы с правилом молча. Мутация «вписать адрес
    // в разметку» краснеет здесь, а не на стенде, где эти состояния
    // воспроизвести нечем.
    expect(action).not.toContain("'/subscription/purchase'");
    expect(action).not.toContain('PURCHASE_ROUTE');
    expect(action).not.toContain('/renew');

    // Пары «разбор удался»: оба адреса объявлены в общем модуле, и оба
    // достаются операции, а не разметке.
    expect(purchaseCta).toContain("export const PURCHASE_ROUTE = '/subscription/purchase'");
    expect(purchaseCta).toContain('export function paymentRoute(');
    expect(actionState).toContain("import { PURCHASE_ROUTE, paymentRoute } from './purchaseCta'");
    expect(countOf(actionState, 'paymentRoute(subscription.id)')).toBe(1);
  });

  it('выбор операции берётся из чистого модуля, а не пишется разметкой', () => {
    expect(action).toContain('resolveExpiredRenewOperation(');
    expect(action).toContain('resolveExpiredActionLabelKey(operation, renewLabelKey)');
  });
});

describe('возобновление суточной подписки не переехало — граница #70', () => {
  it('ветка паузы по-прежнему зовёт togglePause, и ровно один раз', () => {
    // ⚠️ Граница задачи: там ВОЗОБНОВЛЕНИЕ списаний, а не покупка срока.
    // Мутация «отправить и паузу на экран оплаты» краснеет здесь.
    expect(countOf(action, 'subscriptionApi.togglePause(subscription.id)')).toBe(1);
    expect(action).toContain("operation.kind === 'resumeDaily'");
    // Пара: этот же вызов есть и в апстримной карточке — иголка живая.
    expect(upstream).toContain('subscriptionApi.togglePause(');
  });

  it('отказ возобновления виден человеку, а не тонет молча', () => {
    // Единственная оставшаяся мутация может отказать (у суточной цены свой
    // отказ по нехватке средств), и её ошибку блок обязан показать.
    expect(action).toContain('getInsufficientBalanceError(');
    expect(action).toContain('role="alert"');
  });

  it('после успеха обновляются и подписка, и баланс', () => {
    // Возобновление списывает суточную цену — баланс на экране обязан
    // обновиться, иначе виджет покажет старую сумму.
    expect(action).toContain("queryKey: ['balance']");
    expect(action).toContain("queryKey: ['subscriptions-list']");
  });
});

describe('блок действия — один на два экрана (#65, урок #61)', () => {
  it('оба экрана зовут общий блок ровно по разу', () => {
    expect(countOf(card, '<ExpiredSubscriptionAction')).toBe(1);
    expect(countOf(page, '<ExpiredSubscriptionAction')).toBe(1);
  });

  it('оба экрана берут блок из общего модуля', () => {
    expect(card).toContain("from '../subscription/ExpiredSubscriptionAction'");
    expect(page).toContain("from '../components/subscription/ExpiredSubscriptionAction'");
  });

  it('внутри блока кнопка не задваивается', () => {
    // Копия могла бы завестись и здесь — двумя кнопками в одной разметке.
    expect(countOf(action, '<Link')).toBe(1);
    expect(countOf(action, 'onClick={handleResume}')).toBe(1);
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

  it('подпись продления приходит пропом, а страница просит длинную', () => {
    // Решение владельца от 19.08.2026: «Продлить подписку» — только на странице
    // подписки, на главной остаётся короткое «Продлить».
    expect(action).toContain('renewLabelKey = DEFAULT_RENEW_LABEL_KEY');
    expect(page).toContain('renewLabelKey={PAGE_RENEW_LABEL_KEY}');
    // Карточка главной подписи не передаёт — короткая приходит дефолтом.
    expect(card).not.toContain('renewLabelKey');
  });

  it('подпись перехода берётся правилом, а не пишется в разметке', () => {
    // Ключ один на два экрана и подменой места вызова не перебивается —
    // проверено вызовом функции в `expiredAction.test.ts`.
    expect(actionState).toContain('PURCHASE_LABEL_KEY');
    expect(action).not.toContain('subscription.getSubscription');
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
});
