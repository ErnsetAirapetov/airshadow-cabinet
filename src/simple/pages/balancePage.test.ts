import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа самой страницы баланса простого режима (задача #30).
 *
 * ⚠️ Файл читается ТЕКСТОМ, а не импортируется. Компонентных тестов в проекте не
 * бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * страницы потянул бы весь граф приложения и упал бы на разрешении модулей. Тот
 * же приём, что в `src/simple/components/headerActions.test.ts`; цена та же —
 * разбор видит только то, что записано литералом, поэтому у каждого сторожа ниже
 * есть парная проверка «разбор удался».
 *
 * Зачем эти сторожа поверх `balanceState.test.ts`: тот проверяет чистые функции,
 * но не то, что страница их ЗОВЁТ. Без сторожей ниже можно было удалить со
 * страницы весь перехват возврата от платёжного шлюза (или вызов `refreshUser`)
 * — и `npm test` остался бы зелёным.
 */

const PAGE = 'src/simple/pages/Balance.tsx';

const page = existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : '';

/**
 * Тела вызовов `useEffect(...)` — от слова `useEffect` до парной закрывающей
 * скобки. Балансировка скобок, а не регулярка: у эффекта перехвата внутри свои
 * вызовы со скобками, и `.*?\)` оборвал бы тело на первом же из них.
 */
function useEffectCalls(source: string): string[] {
  const marker = 'useEffect(';
  const calls: string[] = [];
  let from = 0;

  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) break;

    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    calls.push(source.slice(start, i + 1));
    from = i + 1;
  }

  return calls;
}

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/**
 * Утилиты `grid-cols-*` из литерала сетки — парами «префикс брейкпоинта, число
 * колонок». Базовый брейкпоинт даёт пустой префикс.
 */
function gridColumns(source: string): Array<{ breakpoint: string; count: number }> {
  return [...source.matchAll(/(?:([a-z]+):)?grid-cols-(\d+)/g)].map((match) => ({
    breakpoint: match[1] ?? '',
    count: Number(match[2]),
  }));
}

/**
 * Литерал `className` контейнера способов оплаты — последний `grid-cols-*` перед
 * `paymentMethods.map(`.
 *
 * Привязка к самому контейнеру, а не «первый `grid-cols-` в файле»: любая другая
 * сетка, добавленная на страницу выше, увела бы сторож ширины на чужой контейнер
 * — и он падал бы не молча, а с сообщением про акцент, которое врёт про причину.
 */
function paymentMethodsGrid(source: string): string {
  const anchor = source.indexOf('paymentMethods.map(');
  if (anchor === -1) return '';

  const matches = [...source.slice(0, anchor).matchAll(/className="([^"]*\bgrid-cols-\d+[^"]*)"/g)];

  return matches.length === 0 ? '' : matches[matches.length - 1][1];
}

/** Комментарии вырезаны — разбор ниже смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Тело массива `className` карточки способа оплаты — от `className={[` до парной
 * закрывающей скобки. Комментарии вырезаны сразу: в них есть и запятые, и слово
 * `hover:`, а сторожа ниже режут тело по запятым и ищут `hover:`.
 */
function classNameArrayBody(source: string): string {
  const marker = 'className={[';
  const start = source.indexOf(marker);
  if (start === -1) return '';

  let depth = 0;
  let i = start + marker.length - 1;
  for (; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    else if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  return stripComments(source.slice(start + marker.length, i));
}

/** Элементы массива `className` — по одному на запятую верхнего уровня. */
function classNameElements(source: string): string[] {
  const body = classNameArrayBody(source);
  const elements: string[] = [];
  let current = '';
  let quote = '';

  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ',') {
      elements.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  elements.push(current.trim());

  return elements.filter((element) => element.length > 0);
}

/**
 * Строковые литералы одного элемента массива `className` — каждый с условием той
 * ветви, в которой он лежит: текст условия тройного оператора для ветви «да»,
 * пустая строка для ветви «иначе» и `null` для безусловного элемента.
 *
 * Ищем вручную, а не регуляркой: двоеточие встречается внутри самих литералов
 * (`sm:col-span-2`, `hover:shadow-glow`), и регулярка обрывала бы ветвь «да» на
 * первом же из них.
 */
function classLiterals(element: string): Array<{ text: string; condition: string | null }> {
  const literals: Array<{ text: string; start: number }> = [];
  let question = -1;
  let colon = -1;

  for (let i = 0; i < element.length; i += 1) {
    const char = element[i];

    if (char === "'") {
      const end = element.indexOf("'", i + 1);
      if (end === -1) break;
      literals.push({ text: element.slice(i + 1, end), start: i });
      i = end;
      continue;
    }

    if (char === '?' && question === -1) question = i;
    else if (char === ':' && question !== -1 && colon === -1) colon = i;
  }

  if (question === -1) {
    return literals.map(({ text }) => ({ text, condition: null }));
  }

  const condition = element.slice(0, question).trim();

  return literals.map(({ text, start }) => ({
    text,
    condition: start > question && (colon === -1 || start < colon) ? condition : '',
  }));
}

describe('акцентная карточка способа пополнения (задачи #30, #52)', () => {
  /**
   * Ветка покоя — `isAccented ? '...'`. Регулярка требует `?` сразу за
   * `isAccented`, поэтому ветку hover (`isAccented && method.is_available ? …`)
   * она не захватывает: у той после имени идёт `&&`.
   */
  const accent = /isAccented\s*\?\s*'([^']*)'/.exec(page)?.[1] ?? '';

  /**
   * Ветка hover — отдельная и обязательно под условием доступности (#52): у
   * приглушённой некликабельной карточки подсветки под курсором быть не должно.
   */
  const hoverAccent =
    /isAccented\s*&&\s*method\.is_available\s*\?\s*'([^']*)'/.exec(page)?.[1] ?? '';

  /** Литерал `className` контейнера способов оплаты — того, внутри которого сетка. */
  const grid = paymentMethodsGrid(page);

  /** Элементы массива `className` карточки способа оплаты. */
  const elements = classNameElements(page);

  /** Hover-варианты акцента — именно они не должны достаться недоступной карточке. */
  const HOVER_ACCENT_UTILITIES = ['hover:border-accent-500/60', 'hover:shadow-glow'];

  it('разбор обеих ветвей акцента, сетки и массива className удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(page.length).toBeGreaterThan(3000);
    expect(page).toContain('export function SimpleBalance');
    expect(accent.length).toBeGreaterThan(40);
    expect(accent).toContain('sm:col-span-2');
    expect(hoverAccent.length).toBeGreaterThan(10);
    expect(hoverAccent).toContain('hover:');
    expect(grid).toContain('grid-cols-');
    expect(gridColumns(grid).length).toBeGreaterThanOrEqual(2);

    // Захваченная сетка — именно та, что оборачивает `paymentMethods.map(`, а не
    // «какой-то grid выше»: между её литералом и вызовом `map` нет другого
    // `className`, то есть контейнер тот самый.
    const anchor = page.indexOf('paymentMethods.map(');
    const gridAt = page.lastIndexOf(grid, anchor);
    expect(gridAt).toBeGreaterThan(-1);
    expect(page.slice(gridAt + grid.length, anchor)).not.toContain('className');

    // Массив className разобран на элементы, и литералы в них видны.
    expect(elements.length).toBeGreaterThanOrEqual(4);
    expect(elements).toContain("'text-left'");
    const literals = elements.flatMap(classLiterals);
    expect(literals.length).toBeGreaterThanOrEqual(5);
    expect(literals.filter(({ text }) => text.includes('hover:')).length).toBeGreaterThanOrEqual(1);
  });

  it('состав акцента в покое из спеки владельца на месте', () => {
    // Акцентная рамка, градиентная подсветка, свечение и ширина строки сетки на
    // `sm` и выше. Границы задачи: состав акцента переделывать нельзя.
    expect(accent).toMatch(/(^|\s)border-accent-500\/40(\s|$)/);
    expect(accent).toMatch(/(^|\s)shadow-glow(\s|$)/);
    expect(accent).toContain('from-accent-500/10');
    expect(accent).toContain('lg:col-span-3');
  });

  it('акцент в покое не зависит от доступности — условие ветки только isAccented', () => {
    // ⚠️ Решение владельца 17.08.2026 (#52): акцент у буквально первой карточки,
    // недоступной в том числе. Классы покоя, уехавшие под условие доступности,
    // вернули бы удалённое исключение — теперь уже в разметке.
    //
    // Доказывается двумя фактами вместе: состав покоя в файле ровно один, и он
    // лежит в ветке, чьё условие — `isAccented` без продолжения (регулярка
    // `accent` требует `?` сразу за именем, так что `isAccented && …` она не
    // захватит и захваченная строка окажется пустой).
    expect(countOf(page, 'sm:col-span-2')).toBe(1);
    expect(accent).toContain('sm:col-span-2');
  });

  it('под курсором акцентная доступная карточка остаётся акцентной', () => {
    // ⚠️ `.bento-card-hover:hover` из `src/styles/globals.css` — специфичность
    // 0,2,0 — перебивает утилиты акцента (0,1,0) и на hover возвращает серую
    // рамку с собственным box-shadow. Hover-варианты тоже 0,2,0, но лежат в
    // `@layer utilities` — ниже по источнику, поэтому выигрывают.
    // Сторож текстовый: он держит классы, а не каскад. Каскад проверяется
    // собранным CSS (см. описание MR).
    for (const utility of HOVER_ACCENT_UTILITIES) {
      expect(hoverAccent).toContain(utility);
    }
  });

  it('ни одна hover-утилита карточки не выдаётся вне ветви method.is_available', () => {
    // ⚠️ Сторож про карточку, а не про чистоту одного литерала. `:hover` на
    // `disabled`-кнопке в CSS срабатывает: класс-гейт есть только у
    // `.bento-card-hover:hover`, у utility-вариантов `hover:` его нет. Значит
    // любая hover-утилита, доставшаяся недоступной карточке, подсветит то, что не
    // нажимается.
    //
    // Инвариант структурный, а не списочный: КАЖДЫЙ строковый литерал массива
    // `className`, содержащий `hover:`, обязан лежать в ветви «да» тройного
    // оператора, условие которого включает `method.is_available`. Проверка по
    // списку известных утилит ловила бы только их переименование, но не третью
    // дописанную утилиту — ни безусловным элементом, ни в ветви «иначе».
    //
    // Комментарии из разбора вырезаны (`stripComments`), поэтому упоминать
    // hover-утилиты в комментариях страницы можно свободно: сторож смотрит только
    // на литералы.
    const hoverLiterals = elements.flatMap((element) =>
      classLiterals(element).filter(({ text }) => text.includes('hover:')),
    );

    expect(hoverLiterals.length).toBeGreaterThanOrEqual(1);

    for (const { text, condition } of hoverLiterals) {
      expect(
        condition,
        `литерал '${text}' обязан лежать в ветви под method.is_available, а его условие — ${JSON.stringify(condition)}`,
      ).toEqual(expect.stringContaining('method.is_available'));
    }

    // Ветка покоя достаётся и недоступной карточке — там `hover:` быть не должно.
    expect(accent).not.toContain('hover:');
  });

  it('акцентная карточка занимает всю ширину строки на каждом брейкпоинте сетки', () => {
    // ⚠️ Спека владельца — «растянута на всю ширину строки», а не «span равен 2 и
    // 3». Числа связаны: сменить `lg:grid-cols-3` у контейнера и не сменить
    // `lg:col-span-3` у акцента — значит молча вернуть карточку в одну колонку.
    // Поэтому сторож сверяет span с числом колонок, а не с константой.
    const columns = gridColumns(grid);

    for (const { breakpoint, count } of columns) {
      if (count === 1) {
        // Одна колонка — карточка и так во всю ширину, `col-span` не нужен.
        continue;
      }

      if (breakpoint === '') {
        // ⚠️ Беспрефиксный `col-span-N` — требуем именно отдельным классом, с
        // границами слова. `toContain` при пустом префиксе вырождался в поиск
        // подстроки `':col-span-N'` и находил её внутри `sm:col-span-2` и
        // `lg:col-span-3`: базовую сетку можно было сменить на `grid-cols-2` или
        // `grid-cols-3`, и сторож оставался зелёным, хотя карточка перестала
        // занимать всю ширину строки на базовом брейкпоинте.
        expect(accent).toMatch(new RegExp(`(^|\\s)col-span-${count}(\\s|$)`));
        continue;
      }

      expect(accent).toContain(`${breakpoint}:col-span-${count}`);
    }
  });

  it('недоступная карточка приглушена и некликабельна', () => {
    // Приглушение и запрет клика — не часть акцента и от него не зависят.
    expect(page).toContain("'bento-card cursor-not-allowed opacity-50'");
    expect(page).toContain('disabled={!method.is_available}');
    expect(page).toContain('method.is_available && navigate(topUpHref(method.id))');
  });
});

describe('страница зовёт свои же чистые функции (задача #30)', () => {
  const effects = useEffectCalls(page);

  it('разбор эффектов удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(effects.length).toBeGreaterThanOrEqual(2);
    for (const effect of effects) {
      expect(effect).toContain('=> {');
      expect(effect.endsWith(')')).toBe(true);
    }
  });

  it('перехват возврата от платёжного шлюза стоит внутри эффекта', () => {
    // Без него человек, вернувшийся от провайдера, видит баланс и не понимает,
    // прошла оплата или нет.
    expect(page).toContain('resolvePaymentReturnRedirect,');
    expect(page).toContain("} from './balanceState'");

    const intercepting = effects.filter(
      (effect) =>
        effect.includes('resolvePaymentReturnRedirect(searchParams)') &&
        effect.includes('navigate(') &&
        effect.includes('replace: true'),
    );

    expect(intercepting).toHaveLength(1);
    expect(intercepting[0]).toContain('[searchParams, navigate]');
  });

  it('перехват не продублирован в мёртвом коде вне эффектов', () => {
    // Все вызовы разрешителя в файле должны быть внутри тел эффектов: иначе
    // проверка выше остаётся зелёной, пока рабочий вызов уехал в недостижимую
    // ветку, а в эффекте лежит его копия.
    const inEffects = effects.reduce(
      (sum, effect) => sum + countOf(effect, 'resolvePaymentReturnRedirect('),
      0,
    );

    expect(countOf(page, 'resolvePaymentReturnRedirect(')).toBe(inEffects);
  });

  it('пользователь обновляется на маунте — баланс в сторе совпадает с экраном', () => {
    const refreshing = effects.filter(
      (effect) => effect.includes('refreshUser()') && effect.includes('[refreshUser]'),
    );

    expect(refreshing).toHaveLength(1);
  });
});
