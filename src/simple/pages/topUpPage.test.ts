import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа простого экрана суммы пополнения (задача #53).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются. Компонентных тестов в проекте не
 * бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * страницы потянул бы весь граф приложения и упал бы на разрешении модулей. Тот
 * же приём, что в `balancePage.test.ts`; цена та же — разбор видит только то, что
 * записано литералом, поэтому у каждого блока ниже есть парная проверка «разбор
 * удался».
 *
 * Зачем эти сторожа поверх `topUpState.test.ts`: тот проверяет чистые функции, но
 * не то, что страница их ЗОВЁТ. Без сторожей ниже можно было выкинуть со страницы
 * виджет баланса, скидку промо или выключатель предзаполнения — и `npm test`
 * остался бы зелёным.
 */

const PAGE = 'src/simple/pages/TopUpAmount.tsx';
const BALANCE_PAGE = 'src/simple/pages/Balance.tsx';
const WIDGET = 'src/simple/components/BalanceWidget.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const rawPage = read(PAGE);
const rawBalancePage = read(BALANCE_PAGE);
const rawWidget = read(WIDGET);

/**
 * Комментарии вырезаны — разбор смотрит только на код. Иначе упоминание
 * `BalanceWidget` или `usePromoDiscount` в докстринге проходило бы за вызов.
 *
 * ⚠️ Строчные комментарии режутся только там, где `//` НЕ стоит после двоеточия:
 * иначе `startsWith('https://t.me/')` из ветки Telegram-deep-link обрезался бы
 * посередине, унося с собой закрывающую скобку — и разбор скобок ниже разъехался
 * бы. Тот же приём, что в `scripts/check-mode-boundaries.mjs`.
 */
function stripComments(source: string): string {
  return source.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const page = stripComments(rawPage);
const balancePage = stripComments(rawBalancePage);
const widget = stripComments(rawWidget);

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/**
 * Фрагмент от открывающей скобки `open` до парной закрывающей.
 *
 * Балансировка, а не регулярка: внутри тел вызовов и обработчиков есть свои
 * скобки, и `.*?\)` оборвал бы фрагмент на первой же из них.
 */
function balancedFrom(source: string, openIndex: number, open: string, close: string): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return '';
}

/** Аргументы каждого вызова `name(...)` — со скобками, в порядке появления. */
function callArgs(source: string, name: string): string[] {
  const marker = `${name}(`;
  const found: string[] = [];
  let from = 0;

  for (;;) {
    const at = source.indexOf(marker, from);
    if (at === -1) break;
    found.push(balancedFrom(source, at + marker.length - 1, '(', ')'));
    from = at + marker.length;
  }

  return found;
}

/** Тела вызовов `useEffect(...)`. */
function useEffectCalls(source: string): string[] {
  return callArgs(source, 'useEffect');
}

/** Тело обработчика вида `onChange={` / `onClick={` — от `{` до парной `}`. */
function handlerBody(source: string, attribute: string, from = 0): string {
  const at = source.indexOf(`${attribute}={`, from);
  if (at === -1) return '';
  return balancedFrom(source, at + attribute.length + 1, '{', '}');
}

/** Имена, импортированные из чистого модуля страницы. */
function importedFromState(source: string): string[] {
  const match = /import\s*\{([^}]*)\}\s*from\s*'\.\/topUpState'/.exec(source);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

const PURE_FUNCTIONS = [
  'resolveSubscriptionAmounts',
  'resolveQuickAmountsRubles',
  'resolveInitialAmountRubles',
];

describe('разбор файлов удался (задача #53)', () => {
  it('все три файла на месте и опознаны', () => {
    // Без этой проверки любой сторож ниже проходил бы на пустой строке: `''`
    // не содержит ничего, но и не содержит запрещённого.
    //
    // ⚠️ Имя компонента сверяется С открывающей скобкой: `toContain` без неё
    // вырождался в поиск подстроки, и переименование в `SimpleTopUpAmountRenamed`
    // оставляло сторож зелёным (поймано мутацией 17.08.2026).
    expect(rawPage.length).toBeGreaterThan(8000);
    expect(page).toMatch(/export function SimpleTopUpAmount\(/);
    expect(rawWidget.length).toBeGreaterThan(500);
    expect(widget).toMatch(/export function BalanceWidget\(/);
    expect(rawBalancePage.length).toBeGreaterThan(3000);
    expect(balancePage).toMatch(/export function SimpleBalance\(/);
  });

  it('комментарии вырезаны, а код — нет', () => {
    // Проверка самого приёма: докстринги ушли, ветка Telegram-deep-link со
    // слэшами внутри строкового литерала осталась целой.
    expect(rawPage).toContain('⚠️ Это НЕ новый интерфейс');
    expect(page).not.toContain('⚠️ Это НЕ новый интерфейс');
    expect(page).toContain("lowerUrl.startsWith('https://t.me/')");
  });

  it('разбор эффектов и обработчиков удался', () => {
    const effects = useEffectCalls(page);

    expect(effects.length).toBeGreaterThanOrEqual(4);
    for (const effect of effects) {
      expect(effect.startsWith('(')).toBe(true);
      expect(effect.endsWith(')')).toBe(true);
    }

    expect(handlerBody(page, 'onChange')).toContain('setAmount(');
    expect(handlerBody(page, 'onClick', page.indexOf('quickAmounts.map('))).toContain(
      'setQuickRub(',
    );
  });
});

describe('страница зовёт свои же чистые функции (задача #53)', () => {
  const imported = importedFromState(page);

  it('разбор импорта чистого модуля удался', () => {
    // Слабое место: сломанная регулярка вернула бы пустой список, и проверка
    // ниже сверяла бы пустоту с пустотой.
    expect(imported.length).toBeGreaterThan(0);
    expect(page).toContain("from './topUpState'");
  });

  it('все три правила берутся из чистого модуля, а не переписаны на странице', () => {
    expect(imported.sort()).toEqual([...PURE_FUNCTIONS].sort());
  });

  it('каждая чистая функция реально вызвана', () => {
    for (const name of PURE_FUNCTIONS) {
      // ⚠️ Вызов, а не упоминание: `callArgs` требует `name(` и разбирает
      // аргументы. Импорт без вызова здесь не проходит — в строке импорта
      // скобки за именем нет.
      expect(callArgs(page, name).length, `${name} не вызвана на странице`).toBeGreaterThanOrEqual(
        1,
      );
    }
  });

  it('источник цен — ответ запроса purchase-options', () => {
    // Иначе периоды пришли бы откуда-то ещё, и вся спека про тариф уровня 1
    // осталась бы в тесте чистой функции, но не на экране.
    expect(page).toContain("queryKey: ['purchase-options', undefined]");
    expect(page).toContain('subscriptionApi.getPurchaseOptions()');
    expect(callArgs(page, 'resolveSubscriptionAmounts')).toContain('(purchaseOptions)');
  });
});

describe('скидка промо доезжает до обеих сумм (задача #53)', () => {
  const quickCalls = callArgs(page, 'resolveQuickAmountsRubles');
  const initialCalls = callArgs(page, 'resolveInitialAmountRubles');

  it('разбор аргументов обоих вызовов удался', () => {
    expect(quickCalls).toHaveLength(1);
    expect(initialCalls).toHaveLength(1);
    expect(quickCalls[0]).toContain('periods:');
    expect(initialCalls[0]).toContain('periods:');
  });

  it('страница зовёт usePromoDiscount и переводит его в applyDiscount', () => {
    // ⚠️ Без этого хука кнопка показала бы сумму больше той, которую человек
    // реально заплатит за подписку: скидку промо бэкенд в `price_kopeks` не
    // включает, её накладывает фронт — так делают и витрина, и форма покупки.
    expect(page).toContain('usePromoDiscount()');
    expect(page).toContain('applyPromoDiscount(priceKopeks).price');
  });

  it('скидка передана и в кнопки, и в предзаполнение', () => {
    expect(quickCalls[0]).toContain('applyDiscount');
    expect(initialCalls[0]).toContain('applyDiscount');
  });
});

describe('виджет баланса — один компонент на два экрана (задача #53)', () => {
  it('оба экрана рендерят виджет', () => {
    expect(page).toContain('<BalanceWidget />');
    expect(page).toContain("from '../components/BalanceWidget'");
    expect(balancePage).toContain('<BalanceWidget />');
    expect(balancePage).toContain("from '../components/BalanceWidget'");
  });

  it('копии блока баланса на страницах не осталось', () => {
    // ⚠️ Сторож против расползания: подпись `balance.currentBalance` живёт ровно
    // в одном файле — в виджете. Инлайн-копия на любой из страниц (а именно так
    // блок и жил до #53) снова разъехалась бы с оригиналом при первой правке.
    expect(countOf(widget, 'balance.currentBalance')).toBe(1);
    expect(countOf(page, 'balance.currentBalance')).toBe(0);
    expect(countOf(balancePage, 'balance.currentBalance')).toBe(0);
  });

  it('данные и параметры запроса виджета не изменились', () => {
    expect(widget).toContain("queryKey: ['balance']");
    expect(widget).toContain('staleTime: API.BALANCE_STALE_TIME_MS');
    expect(widget).toContain("refetchOnMount: 'always'");
    expect(widget).toContain('balanceData?.balance_rubles');
  });

  it('виджет не задаёт себе ширину', () => {
    // Требование владельца — «растянут на ширину остальных элементов»: ширину
    // даёт колонка, в которую виджет поставлен. Свой `max-w-*` сузил бы его на
    // одном из двух экранов.
    expect(widget).not.toMatch(/\bmax-w-/);
  });
});

describe('предзаполнение не перетирает введённое пользователем (задача #53)', () => {
  const prefillEffects = useEffectCalls(page).filter((effect) =>
    effect.includes('resolveInitialAmountRubles('),
  );
  const guard = prefillEffects[0]
    ? /if\s*\(([^)]*)\)\s*return;/.exec(prefillEffects[0])?.[1]
    : undefined;

  it('разбор эффекта предзаполнения и его сторожевого условия удался', () => {
    expect(prefillEffects).toHaveLength(1);
    expect(guard).toBeDefined();
    expect(guard?.length).toBeGreaterThan(10);
  });

  it('предзаполнение выключается тремя условиями', () => {
    // ⚠️ Каждое обязательно:
    //   `amountTouchedRef.current` — ответ, пришедший с опозданием, не должен
    //     стирать сумму, которую человек уже набрал руками или выбрал кнопкой;
    //   `isPricesLoading` — пока цены не пришли, поле не дёргаем;
    //   `!method` — без диапазона метода нечем зажимать значение.
    expect(guard).toContain('amountTouchedRef.current');
    expect(guard).toContain('isPricesLoading');
    expect(guard).toContain('!method');
  });

  it('эффект ставит и значение поля, и канонический рубль', () => {
    // `quickRub` — точная рублёвая сумма при округлённом значении в поле. Без неё
    // на не-рублёвой локали FX-округление отбивает сумму на границе минимума.
    expect(prefillEffects[0]).toContain('setAmount(getQuickValue(rubles))');
    expect(prefillEffects[0]).toContain('setQuickRub(rubles)');
  });

  it('оба способа ввода выключают предзаполнение', () => {
    // Ручной ввод и кнопка быстрой суммы — иначе ответ запроса цен вернул бы
    // цену месяца поверх выбора пользователя.
    const manual = handlerBody(page, 'onChange');
    const chip = handlerBody(page, 'onClick', page.indexOf('quickAmounts.map('));

    expect(manual).toContain('amountTouchedRef.current = true');
    expect(chip).toContain('amountTouchedRef.current = true');
    // Больше нигде флаг не выставляется: иначе проверки выше остались бы
    // зелёными, пока предзаполнение выключается где-то ещё и всегда.
    expect(countOf(page, 'amountTouchedRef.current = true')).toBe(2);
  });
});

describe('механики апстримного экрана перенесены целиком (задача #53)', () => {
  /**
   * Каждая запись — механика, которую легко потерять при копировании экрана, и
   * литерал, по которому её видно в коде. Литералы апстримные: расхождение в них
   * само по себе означает, что механика переписана своими словами.
   */
  const MECHANICS: Array<[what: string, literal: string]> = [
    ['rate limit перед созданием платежа', 'checkRateLimit(RATE_LIMIT_KEYS.PAYMENT, 3, 30000)'],
    ['ветка Telegram Stars', 'balanceApi.createStarsInvoice(amountKopeks)'],
    ['нативный инвойс Stars', 'await openInvoice(data.invoice_url)'],
    ['open_url_direct', 'method?.open_url_direct && !isTelegramDeepLink'],
    ['определение Telegram-deep-link', "lowerUrl.startsWith('tg://')"],
    ['внешнее открытие в Telegram WebView', 'openPaymentUrl(redirectUrl, platform, openLink)'],
    ['информация о платеже для экрана результата', 'saveTopUpPendingInfo({'],
    ['возврат по returnTo', 'getSafeRedirectPath(returnTo)'],
    [
      'уход на /balance, если returnTo нет',
      "navigate(returnTo && safe !== '/' ? safe : '/balance'",
    ],
    ['закрытие по уведомлению об успехе', 'useCloseOnSuccessNotification(handleSuccess)'],
    ['автофокус только вне Telegram', "if (platform === 'telegram') return;"],
    ['панель готового платежа', "t('balance.paymentReady')"],
    ['копирование ссылки платежа', 'copyToClipboard(paymentUrl)'],
    ['выбор под-опции с СБП вперёд', 'sortOptionsWithSbpFirst(method.options)'],
    ['канонический рубль кнопки быстрой суммы', 'canonicalRubles = quickRub'],
    ['snap-to-min для не-рублёвых локалей', 'canonicalRubles = minRubles'],
    ['редирект на выбор способа при неизвестном методе', 'navigate(`/balance/top-up$'],
  ];

  it('разбор таблицы механик удался', () => {
    expect(MECHANICS.length).toBeGreaterThanOrEqual(15);
    expect(page.length).toBeGreaterThan(8000);
  });

  it.each(MECHANICS)('%s', (_what, literal) => {
    expect(page).toContain(literal);
  });

  it('порядок валидации апстримный', () => {
    // ⚠️ Порядок значим: сначала rate limit, потом под-опция, потом сумма, и лишь
    // затем диапазон. Проверка по индексам, а не по наличию: перестановка блоков
    // наличие не меняет.
    const submit = page.indexOf('const handleSubmit = () => {');
    const body = balancedFrom(page, page.indexOf('{', submit), '{', '}');

    expect(submit).toBeGreaterThan(-1);
    expect(body.length).toBeGreaterThan(500);

    const steps = [
      'checkRateLimit(',
      "t('balance.errors.selectMethod')",
      "t('balance.errors.enterAmount')",
      "t('balance.errors.amountRange'",
    ].map((step) => body.indexOf(step));

    for (const at of steps) {
      expect(at).toBeGreaterThan(-1);
    }
    expect(steps).toEqual([...steps].sort((left, right) => left - right));
  });
});
