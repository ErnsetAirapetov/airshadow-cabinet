import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_QUICK_AMOUNTS_RUBLES, resolveQuickAmountsLayout } from './topUpState';

/**
 * Сторожа простого экрана суммы пополнения (задача #53).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются, потому что alias `@/` в тестах
 * не разрешается: страница тянет `@/api`, `@/hooks` и `@/platform`, и импорт упал
 * бы на разрешении модулей. Граница именно в alias, а не в отсутствии jsdom —
 * см. канон, «Тесты». Тот же приём, что в `balancePage.test.ts`; цена та же —
 * разбор видит только то, что записано литералом, поэтому у каждого блока ниже есть парная проверка «разбор
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
/** Наш чистый модуль — читается текстом там, где сверяется с апстримным литералом. */
const STATE = 'src/simple/pages/topUpState.ts';
/** Апстримный экран суммы — источник фолбэка быстрых сумм. Только читаем. */
const UPSTREAM_PAGE = 'src/pages/TopUpAmount.tsx';
/** Апстримная витрина покупки — источник правила «какой тариф показывать». Только читаем. */
const UPSTREAM_SHOWCASE = 'src/components/subscription/purchase/TariffPickerGrid.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const rawPage = read(PAGE);
const rawBalancePage = read(BALANCE_PAGE);
const rawWidget = read(WIDGET);
const rawState = read(STATE);
const rawUpstreamPage = read(UPSTREAM_PAGE);
const rawUpstreamShowcase = read(UPSTREAM_SHOWCASE);

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
/**
 * Чистый модуль без комментариев.
 *
 * ⚠️ Классы сверяются именно по нему: докстринг самого модуля предупреждает про
 * ловушку Tailwind и приводит `lg:grid-cols-${n}` как пример того, чего делать
 * нельзя. По сырому тексту запрет на эту конструкцию краснел бы на собственном
 * предупреждении, а класс, упомянутый только в комментарии, засчитывался бы за
 * литерал в коде.
 */
const state = stripComments(rawState);

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
  'resolveQuickAmountsLayout',
  'resolveInitialAmountRubles',
];

/**
 * Литерал `className` контейнера кнопок быстрых сумм — последний `className` перед
 * `quickAmounts.map(`.
 *
 * Привязка к самому контейнеру, а не «первый `className` в файле»: на странице выше
 * есть своя сетка под-опций способа оплаты, и поиск «первого» увёл бы сторож на неё.
 */
function quickAmountsContainer(source: string): string {
  const anchor = source.indexOf('quickAmounts.map(');
  if (anchor === -1) return '';

  const matches = [...source.slice(0, anchor).matchAll(/className=(\{[^}]*\}|"[^"]*")/g)];

  return matches.length === 0 ? '' : matches[matches.length - 1][1];
}

/** Тело обхода `quickAmounts.map(...)` — со скобками. */
function quickAmountsMapBody(source: string): string {
  const marker = 'quickAmounts.map';
  const at = source.indexOf(`${marker}(`);
  if (at === -1) return '';

  return balancedFrom(source, at + marker.length, '(', ')');
}

/**
 * Тело фильтра тарифов в апстримной витрине покупки — от `{` за `=>` до парной `}`.
 *
 * Якорь — `[...tariffs]`, а не «первый `.filter(` в файле»: фильтров в апстримном
 * компоненте может появиться сколько угодно, и сторож обязан смотреть именно на тот,
 * которым витрина решает, какие тарифы показывать.
 */
function showcaseFilterBody(source: string): string {
  const anchor = source.indexOf('[...tariffs]');
  if (anchor === -1) return '';

  const at = source.indexOf('.filter(', anchor);
  if (at === -1) return '';

  const brace = source.indexOf('{', at);
  if (brace === -1) return '';

  return stripComments(balancedFrom(source, brace, '{', '}'));
}

/**
 * Тело НАШЕЙ копии правила витрины — `isHiddenInShowcase` из `topUpState.ts`.
 *
 * Нужно, чтобы состав полей у копии тоже читался из кода, а не был выписан в
 * ожидании теста: зашитый набор устаревает молча, а сторож при этом остаётся
 * зелёным ровно до того дня, когда он был бы нужен.
 *
 * ⚠️ На вход подаётся текст БЕЗ КОММЕНТАРИЕВ: маркер — имя функции, а упоминание
 * имени в докстринге увело бы разбор на прозу. `stripComments` внутри оставлен
 * идемпотентной страховкой.
 */
function ourFilterBody(source: string): string {
  const marker = 'function isHiddenInShowcase';
  const at = source.indexOf(marker);
  if (at === -1) return '';

  const brace = source.indexOf('{', at);
  if (brace === -1) return '';

  return stripComments(balancedFrom(source, brace, '{', '}'));
}

/** Имена, которые вправе встретиться в условии подсветки выбранной кнопки. */
const SELECTION_IDENTIFIERS = ['selectedQuickIndex', 'index', 'amount', 'val'] as const;

interface SelectionContext {
  selectedQuickIndex: number | null;
  index: number;
  amount: string;
  val: string;
}

/**
 * Условие подсветки выбранной кнопки — как ИСПОЛНЯЕМАЯ функция, а не как текст.
 *
 * ⚠️ Приём выбран осознанно, взамен дословного сравнения выражения со строкой.
 * Прежний сторож требовал `isSelected` буква в букву и отдельно запрещал упоминание
 * `amount === val` — то есть краснел на корректной починке (протухший индекс после
 * смены состава списка кнопок лечится ровно добавлением этой сверки). Сторож,
 * который запрещает чинить охраняемый им код, в этом проекте уже ловили; здесь
 * охраняется СВОЙСТВО: какая кнопка обязана загореться при каком состоянии.
 *
 * Возвращает `null`, если разбор не удался или условие читает имя, которого сторож
 * не знает: подставить в неизвестную переменную нечего, и молча считать такое
 * условие исправным нельзя.
 */
function selectionCondition(mapSource: string): ((ctx: SelectionContext) => boolean) | null {
  const expression = /const isSelected = ([^;]*);/.exec(mapSource)?.[1]?.trim();
  if (!expression) return null;

  const names = [...expression.matchAll(/[A-Za-z_$][\w$]*/g)].map((found) => found[0]);
  if (names.length === 0) return null;
  if (
    names.some(
      (name) => !SELECTION_IDENTIFIERS.includes(name as (typeof SELECTION_IDENTIFIERS)[number]),
    )
  ) {
    return null;
  }

  const compiled = new Function(...SELECTION_IDENTIFIERS, `return Boolean(${expression});`) as (
    selectedQuickIndex: number | null,
    index: number,
    amount: string,
    val: string,
  ) => boolean;

  return (ctx) => compiled(ctx.selectedQuickIndex, ctx.index, ctx.amount, ctx.val);
}

/**
 * Апстримные быстрые суммы в рублях — литерал из ветви «у метода их нет» выражения
 * `const quickAmounts = (...)` в апстримном `src/pages/TopUpAmount.tsx`.
 */
function upstreamFallbackAmounts(source: string): number[] {
  const marker = 'const quickAmounts = (';
  const at = source.indexOf(marker);
  if (at === -1) return [];

  const expression = balancedFrom(source, at + marker.length - 1, '(', ')');
  const array = /:\s*(\[[^\]]*\])/.exec(expression)?.[1];
  if (!array) return [];

  return [...array.matchAll(/\d+/g)].map((digits) => Number(digits[0]));
}

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

  it('хвост редиректа собирает resolveTopUpSearch, а не страница руками (#58)', () => {
    // ⚠️ Одно правило — один источник. Правило «переносим `amount` и `returnTo`,
    // остальное нет» живёт в `resolveTopUpSearch` (задача #55) и покрыто тестами
    // со всеми краями — пустой хвост, экранирование, посторонние параметры.
    // Страница собирала тот же хвост своими `URLSearchParams`, и два источника
    // истины разошлись бы молча: поправили бы правило в одном месте.
    expect(page).toContain("import { resolveTopUpSearch } from './topUpMethodSelectState'");
    expect(page).toContain(
      'navigate(`/balance/top-up${resolveTopUpSearch(searchParams)}`, { replace: true })',
    );

    // И руками хвост больше не собирается — проверяем ВНУТРИ эффекта редиректа,
    // а не по всей странице: запрет `new URLSearchParams()` на весь файл краснел
    // бы на любом будущем законном использовании, то есть по ложной причине.
    const effect = page.slice(page.indexOf('if (methods && !method)'));
    const redirect = effect.slice(0, effect.indexOf('}, [methods, method'));

    // Разбор удался: эффект найден и непустой.
    expect(redirect.length).toBeGreaterThan(30);
    expect(redirect).not.toContain('URLSearchParams');
    expect(redirect).not.toContain("searchParams.get('amount')");
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

  it('тон по умолчанию — плоский, и плоская ветка кегля прежняя (#72)', () => {
    // ⚠️ Критерий приёмки #72: `/balance` и экран суммы пополнения не меняются
    // «ни на пиксель». Держится это ИСКЛЮЧИТЕЛЬНО на значении по умолчанию:
    // оба экрана зовут `<BalanceWidget />` без пропов, и замена дефолта на
    // `'accent'` перекрасила бы их (а заодно экран оплаты подписки) при зелёных
    // тестах — вызовы-то запинены выше, а дефолт не сторожил никто.
    expect(widget).toContain("tone = 'flat'");
    // Плоская ветка кегля — та же пара, что была до #72. Крупный `text-5xl` с
    // мобилки принадлежит только акцентному тону главной.
    expect(widget).toContain("'text-4xl font-bold text-dark-50 sm:text-5xl'");
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

describe('сетка кнопок берётся из чистой раскладки (задача #56)', () => {
  const container = quickAmountsContainer(page);
  const mapBody = quickAmountsMapBody(page);

  it('разбор контейнера и обхода кнопок удался', () => {
    // Без этого любой сторож ниже проходил бы на пустой строке.
    expect(container.length).toBeGreaterThan(10);
    expect(mapBody.startsWith('(')).toBe(true);
    expect(mapBody.endsWith(')')).toBe(true);
    expect(mapBody).toContain('<BentoCard');

    // Захваченный контейнер — именно тот, что оборачивает обход: между его
    // литералом и `map` другого `className` нет.
    const anchor = page.indexOf('quickAmounts.map(');
    const containerAt = page.lastIndexOf(container, anchor);
    expect(containerAt).toBeGreaterThan(-1);
    expect(page.slice(containerAt + container.length, anchor)).not.toContain('className');
  });

  it('классы сетки приходят из раскладки, а не выписаны в разметке', () => {
    // ⚠️ Иначе число колонок разъедется с числом кнопок молча: сборка зелёная,
    // а на стенде хвост сетки пустой. В разметке сетку считать нельзя ещё и
    // потому, что Tailwind собирает утилиты сканируя исходник текстом.
    expect(container).toBe('{quickAmountsLayout.gridClassName}');
    expect(callArgs(page, 'resolveQuickAmountsLayout')).toContain('(quickAmounts.length)');
  });

  it('пролёт достаётся ТОЛЬКО последней кнопке', () => {
    // Безусловный пролёт растянул бы каждую кнопку на всю строку.
    expect(mapBody).toContain('index === quickAmounts.length - 1');
    expect(mapBody).toMatch(/isLastAmount \? quickAmountsLayout\.lastItemClassName/);
    expect(countOf(page, 'quickAmountsLayout.lastItemClassName')).toBe(1);
  });

  it('ключ кнопки — индекс, а не сумма', () => {
    // ⚠️ `key={a}` давал дубль, если две цены после скидки совпали: React получал
    // одинаковый ключ и терял соответствие кнопки элементу списка.
    const key = /key=\{([^}]*)\}/.exec(mapBody);

    expect(key, 'ключ кнопки в разборе не найден').toBeTruthy();
    expect(key?.[1]).toBe('index');
    expect(countOf(mapBody, 'key={')).toBe(1);
  });

  it('выбор кнопки сбрасывается ручным вводом и предзаполнением', () => {
    // Иначе подсветка пережила бы и правку поля руками, и пришедшую цену месяца:
    // горела бы кнопка, сумма которой в поле уже не лежит.
    const manual = handlerBody(page, 'onChange');
    const chip = handlerBody(page, 'onClick', page.indexOf('quickAmounts.map('));
    const prefill = useEffectCalls(page).filter((effect) =>
      effect.includes('resolveInitialAmountRubles('),
    );

    expect(chip).toContain('setSelectedQuickIndex(index)');
    expect(manual).toContain('setSelectedQuickIndex(null)');
    expect(prefill).toHaveLength(1);
    expect(prefill[0]).toContain('setSelectedQuickIndex(null)');
  });
});

/**
 * Сторож подсветки выбранной кнопки — по ПОВЕДЕНИЮ условия, а не по его тексту.
 *
 * Охраняемое свойство одно: подсвеченная кнопка обязана нести ровно ту сумму, что
 * лежит в поле, и при этом две кнопки с совпавшей после округления суммой обязаны
 * подсвечиваться раздельно. Каким выражением это достигнуто, сторожу всё равно —
 * он подставляет состояния и смотрит на ответ.
 */
describe('подсветка кнопки — позиция И значение (задача #56)', () => {
  const mapBody = quickAmountsMapBody(page);
  const isSelected = selectionCondition(mapBody);
  const expression = /const isSelected = ([^;]*);/.exec(mapBody)?.[1];

  it('разбор условия подсветки удался — иначе сторож проверял бы пустоту', () => {
    expect(mapBody).toContain('const isSelected =');
    expect(isSelected, 'условие не разобрано или читает имя, неизвестное сторожу').toBeTruthy();
    // Условие вообще что-то сравнивает: константа прошла бы половину проверок ниже.
    expect(expression).toMatch(/===/);
    // Правило записано в одном месте: вторая копия жила бы своей жизнью.
    expect(countOf(page, 'const isSelected =')).toBe(1);
  });

  it('нажатая кнопка подсвечена', () => {
    expect(isSelected?.({ selectedQuickIndex: 2, index: 2, amount: '500', val: '500' })).toBe(true);
  });

  it('позиция участвует в условии: соседняя кнопка с той же суммой не загорается', () => {
    // ⚠️ 25 415 и 25 490 копеек после округления вверх обе дают 255 ₽ — штатный
    // случай, периоды разные. Сверка ОДНОГО значения зажигала бы обе кнопки.
    expect(isSelected?.({ selectedQuickIndex: 1, index: 0, amount: '255', val: '255' })).toBe(
      false,
    );
  });

  it('значение участвует в условии: протухший индекс не подсвечивает чужую кнопку', () => {
    // ⚠️ Состав `quickAmounts` меняется по ходу жизни экрана: кнопки рисуются на
    // фолбэке, пока цены летят, а инвалидация после промокода меняет суммы при той
    // же длине списка. Индекс это переживает — сбрасывают его только ручной ввод и
    // предзаполнение, а предзаполнение после нажатия выключено навсегда. Одной
    // позиции хватало ровно до первой смены списка: в поле 500, горит 799.
    expect(isSelected?.({ selectedQuickIndex: 2, index: 2, amount: '500', val: '799' })).toBe(
      false,
    );
  });

  it('без выбора не подсвечено ничего', () => {
    expect(isSelected?.({ selectedQuickIndex: null, index: 0, amount: '255', val: '255' })).toBe(
      false,
    );
  });
});

/**
 * Сторож против ловушки Tailwind: класс, собранный из переменной, в CSS не попадает.
 *
 * ⚠️ Мутация «статическая карта → шаблонная строка `lg:grid-cols-${n}`» оставляет
 * ЗЕЛЁНЫМИ и все тесты раскладки, и сборку: чистая функция отдаёт ту же строку, а
 * Tailwind сканирует исходники ТЕКСТОМ и такого класса просто не сгенерирует — на
 * стенде сетки не будет вообще. Поймать это можно только чтением файла текстом, как
 * читаются апстримные литералы выше.
 */
describe('классы раскладки выписаны в модуле литералами (задача #56)', () => {
  /** Каждая утилита, которую раскладка может отдать при 0-10 кнопках. */
  const emitted = [
    ...new Set(
      Array.from({ length: 11 }, (_unused, count) => resolveQuickAmountsLayout(count))
        .flatMap((layout) => [layout.gridClassName, layout.lastItemClassName])
        .join(' ')
        .split(/\s+/)
        .filter((className) => className.length > 0),
    ),
  ].sort();

  it('разбор набора удался — иначе сторож проверял бы пустоту', () => {
    expect(rawState.length).toBeGreaterThan(3000);
    // Комментарии вырезаны, а карты классов остались: иначе обе проверки ниже
    // сверяли бы пустоту.
    expect(state.length).toBeGreaterThan(2000);
    expect(state).toContain('GRID_BY_ROW_COLUMNS');
    expect(emitted.length).toBeGreaterThan(10);
    // В наборе есть и сетка, и пролёты: иначе половина утилит осталась бы вне охраны.
    expect(emitted.filter((className) => className.includes('grid-cols-')).length).toBeGreaterThan(
      2,
    );
    expect(emitted.filter((className) => className.includes('col-span-')).length).toBeGreaterThan(
      2,
    );
  });

  it('ни один класс не собирается из переменной', () => {
    // ⚠️ Без этой проверки сторож ниже ловит мутацию не всегда: заменить карту на
    // шаблонную строку можно, НЕ УДАЛИВ саму карту, — литералы остаются в файле,
    // проверка «класс записан литералом» проходит, а в CSS класса всё равно нет
    // (проверено мутацией 17.08.2026: 121 тест зелёный, сборка зелёная,
    // `lg:grid-cols-5` и `lg:grid-cols-6` из `dist/assets/*.css` исчезли).
    // Поэтому запрещена сама конструкция, а не только её последствие.
    const UTILITY = String.raw`(?:grid-cols|col-span|grid-rows|row-span)`;

    // 1. Шаблонная строка: `lg:grid-cols-${n}`.
    expect(state).not.toMatch(new RegExp(`${UTILITY}-\\$\\{`));
    // 2. Конкатенация: 'lg:grid-cols-' + n. Дыра ровно того же вида — карта на
    //    месте, литералы в файле, а Tailwind склеенного класса не видит. Признак
    //    надёжнее самого плюса: имя утилиты, оборванное дефисом на границе строки.
    //    Валидного класса, кончающегося дефисом, не бывает.
    expect(state).not.toMatch(new RegExp(`${UTILITY}-['"\`]`));
    // 3. Обрыв на префиксе брейкпоинта: 'lg:' + 'grid-cols-3'. Класса `lg:grid-cols-3`
    //    в тексте снова нет, а обе проверки выше прошли бы.
    expect(state).not.toMatch(/(?:sm|md|lg|xl|2xl):['"`]\s*\+/);
  });

  it.each(emitted)('%s записан в topUpState.ts литералом', (className) => {
    // ⚠️ Границы обязательны: `toContain('col-span-1')` находил бы подстроку внутри
    // `sm:col-span-1`, и пропажа базового литерала осталась бы незамеченной — та же
    // грабля, на которой ловились в #52.
    const literal = new RegExp(
      `(^|[\\s'"\`])${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s'"\`]|$)`,
    );

    expect(state).toMatch(literal);
  });
});

/**
 * Сторож против молчаливого расхождения правила выбора тарифа с апстримной витриной.
 *
 * `pickShowcaseTariff` — копия правила фильтрации из апстримного
 * `TariffPickerGrid.tsx` (импортировать его простому режиму нельзя, граница режимов).
 * Пока копия жива, апстрим может поменять оригинал молча: сборка зелёная, а в поле
 * суммы снова цена триального тарифа. Канон требует для заимствованной логики ровно
 * этого сторожа — читающего апстримный файл ТЕКСТОМ (образец —
 * `dashboardState.test.ts`).
 */
describe('правило выбора тарифа не разошлось с апстримной витриной (задача #56)', () => {
  const filterBody = showcaseFilterBody(rawUpstreamShowcase);
  /** Поля тарифа, которые читает фильтр витрины. */
  const fields = [...filterBody.matchAll(/\btariff\.([A-Za-z_]\w*)/g)].map((match) => match[1]);
  /**
   * Поля тарифа, которые читает НАША копия правила.
   *
   * ⚠️ Разбор идёт по тексту БЕЗ КОММЕНТАРИЕВ. По сырому маркер `function
   * isHiddenInShowcase` нашёлся бы и в докстринге — а упоминание имени функции в
   * докстринге дело обычное, — и разбор поехал бы от куска прозы: тело фильтра
   * при этом захватилось бы чужое, а сторож остался бы зелёным.
   */
  const ourFields = [...ourFilterBody(state).matchAll(/\btariff\.([A-Za-z_]\w*)/g)].map(
    (match) => match[1],
  );
  const upstreamMarker = /\.includes\('([^']*)'\)/.exec(filterBody)?.[1];
  const ourMarker = /TRIAL_NAME_MARKER = '([^']*)'/.exec(state)?.[1];

  it('разбор апстримного фильтра и нашей копии удался — иначе сторож сверял бы пустоту', () => {
    expect(rawUpstreamShowcase.length).toBeGreaterThan(2000);
    expect(rawUpstreamShowcase).toContain('export function TariffPickerGrid(');
    expect(filterBody.length).toBeGreaterThan(60);
    expect(filterBody).toContain('return true;');
    expect(fields.length).toBeGreaterThanOrEqual(2);
    expect(rawState.length).toBeGreaterThan(3000);
    expect(state.length).toBeGreaterThan(2000);
    expect(ourFilterBody(state).length).toBeGreaterThan(60);
    expect(new Set(ourFields).size).toBeGreaterThanOrEqual(3);
  });

  it('витрина по-прежнему скрывает купленные тарифы', () => {
    expect(filterBody).toContain('tariff.is_purchased');
  });

  it('витрина по-прежнему опознаёт триальный тариф по имени', () => {
    // ⚠️ Костыль апстрима, а не наш: явного признака триала в контракте тарифа нет
    // (`Tariff` в `src/types/index.ts` не знает ни `is_trial`, ни равносильного).
    expect(filterBody).toContain("tariff.name.toLowerCase().includes('trial')");
  });

  it('подстрока-признак триала в копии совпадает с апстримной', () => {
    // Сверяются два ИЗВЛЕЧЁННЫХ литерала, а не литерал с ожиданием в тесте: если
    // апстрим переименует признак, красным станет именно расхождение.
    expect(upstreamMarker, 'признак триала в апстриме не найден').toBeTruthy();
    expect(ourMarker, 'признак триала в нашей копии не найден').toBeTruthy();
    expect(ourMarker).toBe(upstreamMarker);
  });

  it('витрина не читает полей тарифа, которых нет в нашей копии', () => {
    // ⚠️ Главная часть сторожа: новое условие в апстриме (`tariff.is_hidden`,
    // `tariff.is_addon` — что угодно) добавит поле, которого копия не знает, и она
    // перестанет быть копией. Проверка «содержит известные условия» такого не
    // поймала бы.
    //
    // ⚠️ Сверяется ВКЛЮЧЕНИЕ, а не равенство, и оба набора извлечены из кода.
    // Прежняя формулировка требовала равенства с зашитой парой полей, хотя наша
    // копия читает и третье (`is_available` — добавлено нами по спеке #56). Помимо
    // того, что имя теста расходилось с делом, у равенства был вредный побочный
    // эффект: если апстрим добавит фильтр по доступности, сторож покраснел бы на
    // том, что копия стала БЛИЖЕ к оригиналу. Красным должно становиться расхождение
    // в опасную сторону — поле, которое витрина читает, а мы нет.
    const missing = [...new Set(fields)].filter((field) => !ourFields.includes(field)).sort();

    expect(missing, `поля витрины, не перенесённые в копию: ${missing.join(', ')}`).toEqual([]);
  });
});

/**
 * Сторож против молчаливого расхождения фолбэка быстрых сумм с апстримом.
 *
 * ⚠️ Раньше константа сверялась сама с собой — тест `topUpState.test.ts` ожидал
 * `FALLBACK_QUICK_AMOUNTS_RUBLES` и получал её же. Докстринг при этом обещал
 * соответствие апстриму, то есть охранял ровно ничего.
 */
describe('фолбэк быстрых сумм не разошёлся с апстримным экраном (задача #56)', () => {
  const upstreamAmounts = upstreamFallbackAmounts(rawUpstreamPage);

  it('разбор апстримного литерала удался — иначе сторож сверял бы пустоту', () => {
    expect(rawUpstreamPage.length).toBeGreaterThan(8000);
    expect(rawUpstreamPage).toContain('const quickAmounts = (');
    expect(upstreamAmounts.length).toBeGreaterThan(0);
    for (const rubles of upstreamAmounts) {
      expect(Number.isFinite(rubles)).toBe(true);
      expect(rubles).toBeGreaterThan(0);
    }
  });

  it('наша константа равна апстримному литералу', () => {
    expect(FALLBACK_QUICK_AMOUNTS_RUBLES).toEqual(upstreamAmounts);
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
