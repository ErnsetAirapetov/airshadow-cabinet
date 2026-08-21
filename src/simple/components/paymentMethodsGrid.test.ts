import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type MethodCardSpans, resolveMethodCardSpans, spanClasses } from './paymentMethodsBento';

/**
 * Сторожа общего блока карточек способов оплаты (задача #55).
 *
 * ⚠️ Разметка читается ТЕКСТОМ, а не импортируется, потому что alias `@/` в
 * тестах не разрешается: компонент тянет `@/hooks/useCurrency`, и импорт упал бы
 * на разрешении модулей. Не потому, что «отрисовку проверить нечем» — серверный
 * рендер тут работает, просто до этого компонента не достаёт (канон, «Тесты»). Тот
 * же приём, что в `src/simple/pages/balancePage.test.ts`; цена та же — разбор
 * видит только то, что записано литералом, поэтому у каждого блока ниже есть
 * парная проверка «разбор удался».
 *
 * Чистая раскладка при этом ИМПОРТИРУЕТСЯ: `paymentMethodsBento.ts` не тянет
 * ничего вообще. Именно из этого получается главное свойство сторожей ниже —
 * пролёт акцентной карточки сверяется с числом колонок сетки, взятым из разметки,
 * а не с константой в тесте.
 *
 * До #55 всё это жило в `balancePage.test.ts` и охраняло инлайн-блок на странице
 * баланса. Блок стал общим — уехали и сторожа.
 */

const GRID = 'src/simple/components/PaymentMethodsGrid.tsx';
const BALANCE_PAGE = 'src/simple/pages/Balance.tsx';
const SELECT_PAGE = 'src/simple/pages/TopUpMethodSelect.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const rawGrid = read(GRID);

/** Комментарии вырезаны — разбор ниже смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const grid = stripComments(rawGrid);

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/**
 * Утилиты `grid-cols-*` из литерала сетки — парами «префикс брейкпоинта, число
 * колонок». Базовый брейкпоинт даёт пустой префикс.
 */
function gridColumns(source: string): Array<{ breakpoint: string; count: number }> {
  return [...source.matchAll(/(?:([a-z0-9]+):)?grid-cols-(\d+)/g)].map((match) => ({
    breakpoint: match[1] ?? '',
    count: Number(match[2]),
  }));
}

/**
 * Литерал `className` контейнера способов оплаты — последний `grid-cols-*` перед
 * `methods.map(`.
 *
 * Привязка к самому контейнеру, а не «первый `grid-cols-` в файле»: любая другая
 * сетка, добавленная выше, увела бы сторож ширины на чужой контейнер — и он падал
 * бы не молча, а с сообщением про акцент, которое врёт про причину.
 */
function methodsGridClass(source: string): string {
  const anchor = source.indexOf('methods.map(');
  if (anchor === -1) return '';

  const matches = [...source.slice(0, anchor).matchAll(/className="([^"]*\bgrid-cols-\d+[^"]*)"/g)];

  return matches.length === 0 ? '' : matches[matches.length - 1][1];
}

/**
 * Тело массива `className` карточки способа оплаты — от `className={[` до парной
 * закрывающей скобки.
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

  return source.slice(start + marker.length, i);
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
 * (`sm:col-span-6`, `hover:shadow-glow`), и регулярка обрывала бы ветвь «да» на
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

/** Порядок брейкпоинтов Tailwind — по нему считается каскад числа колонок. */
const BREAKPOINT_ORDER = ['', 'sm', 'md', 'lg', 'xl', '2xl'];

/**
 * Сколько колонок у сетки на брейкпоинте с учётом каскада.
 *
 * ⚠️ Нужно именно так: контейнер объявляет `grid-cols-1 sm:grid-cols-6`, и на `lg`
 * колонок тоже шесть — они унаследованы от `sm`. Без каскада сторож пролёта на
 * `lg` сверял бы его с единицей базового брейкпоинта и врал.
 */
function effectiveColumns(
  declared: Array<{ breakpoint: string; count: number }>,
  breakpoint: string,
): number {
  const upTo = BREAKPOINT_ORDER.slice(0, BREAKPOINT_ORDER.indexOf(breakpoint) + 1);
  let columns = 1;

  for (const name of upTo) {
    const found = declared.find((entry) => entry.breakpoint === name);
    if (found) columns = found.count;
  }

  return columns;
}

const declaredColumns = gridColumns(methodsGridClass(grid));
const accentSpans = resolveMethodCardSpans(4)[0];
/** Брейкпоинты, для которых раскладка вообще считает пролёты. */
const spanBreakpoints = Object.keys(accentSpans ?? {}) as Array<keyof MethodCardSpans>;

describe('разбор разметки блока способов удался (задача #55)', () => {
  it('файл на месте и опознан', () => {
    // Без этой проверки любой сторож ниже проходил бы на пустой строке: `''` не
    // содержит ничего, но и не содержит запрещённого.
    //
    // ⚠️ Имя компонента сверяется С открывающей скобкой: `toContain` без неё
    // вырождается в поиск подстроки, и переименование в
    // `PaymentMethodsGridRenamed` оставило бы сторож зелёным.
    expect(rawGrid.length).toBeGreaterThan(1500);
    expect(grid).toMatch(/export function PaymentMethodsGrid\(/);
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(rawGrid).toContain('⚠️');
    expect(grid).not.toContain('⚠️');
    expect(grid).toContain('methods.map(');
  });

  it('сетка найдена, и это именно контейнер карточек', () => {
    const gridClass = methodsGridClass(grid);

    expect(gridClass).toContain('grid-cols-');
    expect(declaredColumns.length).toBeGreaterThanOrEqual(2);

    // Между литералом сетки и вызовом `map` нет другого `className` — значит
    // захвачен тот самый контейнер, а не «какой-то grid выше».
    const anchor = grid.indexOf('methods.map(');
    const gridAt = grid.lastIndexOf(gridClass, anchor);
    expect(gridAt).toBeGreaterThan(-1);
    expect(grid.slice(gridAt + gridClass.length, anchor)).not.toContain('className');
  });

  it('массив className карточки разобран на элементы и литералы', () => {
    const elements = classNameElements(grid);

    expect(elements.length).toBeGreaterThanOrEqual(4);
    expect(elements).toContain("'text-left'");

    const literals = elements.flatMap(classLiterals);
    expect(literals.length).toBeGreaterThanOrEqual(5);
    expect(literals.filter(({ text }) => text.includes('hover:')).length).toBeGreaterThanOrEqual(1);
  });

  it('раскладка отдала пролёты хотя бы для двух брейкпоинтов', () => {
    // Пустой список ключей сделал бы сторожа пролётов ниже вечно зелёными: цикл
    // по нулю итераций проходит всегда.
    expect(spanBreakpoints.length).toBeGreaterThanOrEqual(2);
    expect(spanBreakpoints).toContain('sm');
    expect(spanBreakpoints).toContain('lg');
  });
});

describe('бенто-сетка соответствует спеке владельца (задача #55)', () => {
  it('на телефоне одна колонка — карточки во всю ширину', () => {
    // Спека: «на базовом брейкпоинте (телефон) — одна колонка, все карточки во
    // всю ширину», бенто включается с `sm`.
    expect(effectiveColumns(declaredColumns, '')).toBe(1);
  });

  it('каждый объявленный брейкпоинт сетки известен раскладке', () => {
    // ⚠️ Обратное направление сверки: дописать контейнеру `xl:grid-cols-8`, не
    // научив раскладку считать пролёты для `xl`, — значит получить строку с
    // дырой на широком экране при зелёных тестах.
    for (const { breakpoint, count } of declaredColumns) {
      if (count === 1) continue;
      expect(spanBreakpoints as string[], `брейкпоинт ${breakpoint || 'базовый'}`).toContain(
        breakpoint,
      );
    }
  });

  it('акцентная карточка занимает всю ширину строки на каждом брейкпоинте', () => {
    // ⚠️ Спека владельца — «акцентная всегда отдельной строкой во всю ширину», а
    // не «пролёт равен шести». Числа связаны: сменить `sm:grid-cols-6` у
    // контейнера и не сменить пролёт — значит молча вернуть акцентную карточку в
    // одну колонку. Поэтому сторож сверяет пролёт с ЧИСЛОМ КОЛОНОК, прочитанным
    // из разметки, а не с константой (в #52 на этом уже попадались).
    for (const breakpoint of spanBreakpoints) {
      expect(accentSpans[breakpoint], `пролёт акцента на ${breakpoint}`).toBe(
        effectiveColumns(declaredColumns, breakpoint),
      );
    }
  });

  it('класс пролёта акцента объявлен отдельным классом, а не подстрокой', () => {
    const classes = spanClasses(accentSpans);

    for (const { breakpoint, count } of declaredColumns) {
      if (count === 1) {
        // Одна колонка — карточка и так во всю ширину, `col-span` не нужен.
        continue;
      }

      if (breakpoint === '') {
        // ⚠️ Беспрефиксный `col-span-N` — требуем именно отдельным классом, с
        // границами слова. `toContain` при пустом префиксе вырождался в поиск
        // подстроки `':col-span-N'` и находил её внутри `sm:col-span-6`: базовую
        // сетку можно было сменить на многоколоночную, и сторож оставался
        // зелёным, хотя карточка перестала занимать всю ширину строки на
        // телефоне (поймано в #52).
        expect(classes).toMatch(new RegExp(`(^|\\s)col-span-${count}(\\s|$)`));
        continue;
      }

      expect(classes).toMatch(new RegExp(`(^|\\s)${breakpoint}:col-span-${count}(\\s|$)`));
    }
  });

  it('пролёты берутся из чистой функции, а не из условий в разметке', () => {
    // ⚠️ Спека: «реализовать чистой функцией, разметка её только читает, условий
    // в JSX не плодить». Литерал `col-span` в массиве `className` означает, что
    // раскладка снова расползлась по ветвям — и таблица пролётов из задачи
    // перестала быть единственным источником истины.
    expect(grid).toContain('resolveMethodCardSpans(');
    expect(grid).toContain('spanClasses(');
    expect(countOf(classNameArrayBody(grid), 'col-span')).toBe(0);
    // И нигде в файле нет собственного класса пролёта — все они живут в картах
    // чистого модуля.
    expect(countOf(grid, 'col-span-')).toBe(0);
  });
});

describe('акцентная карточка способа пополнения (задачи #30, #52, #55)', () => {
  /**
   * Ветка покоя — `isAccented ? '...'`. Регулярка требует `?` сразу за
   * `isAccented`, поэтому ветку hover (`isAccented && method.is_available ? …`)
   * она не захватывает: у той после имени идёт `&&`.
   */
  const accent = /isAccented\s*\?\s*'([^']*)'/.exec(grid)?.[1] ?? '';

  /**
   * Ветка hover — отдельная и обязательно под условием доступности (#52): у
   * приглушённой некликабельной карточки подсветки под курсором быть не должно.
   */
  const hoverAccent =
    /isAccented\s*&&\s*method\.is_available\s*\?\s*'([^']*)'/.exec(grid)?.[1] ?? '';

  const elements = classNameElements(grid);

  /** Hover-варианты акцента — именно они не должны достаться недоступной карточке. */
  const HOVER_ACCENT_UTILITIES = ['hover:border-accent-500/60', 'hover:shadow-glow'];

  it('разбор обеих ветвей акцента удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(accent.length).toBeGreaterThan(40);
    expect(accent).toContain('accent-500');
    expect(hoverAccent.length).toBeGreaterThan(10);
    expect(hoverAccent).toContain('hover:');
  });

  it('акцент достаётся буквально первой карточке, а решает это чистая функция', () => {
    // ⚠️ Решение владельца 17.08.2026 (#52): доступность в выборе не участвует.
    // Правило живёт в `resolveAccentedMethodId` — его ветки покрыты
    // `paymentMethodsState.test.ts`; здесь сторожим, что компонент его ЗОВЁТ, а
    // не переписал условие в разметке.
    expect(grid).toContain('resolveAccentedMethodId(methods)');
    expect(grid).toContain('const isAccented = method.id === accentedMethodId');
  });

  it('состав акцента в покое из спеки владельца на месте', () => {
    // Акцентная рамка, градиентная подсветка и свечение. Границы задачи: состав
    // акцента переделывать нельзя. Растягивание на ширину строки с #55 приходит
    // из раскладки, а не отсюда, — его сторожит блок выше.
    expect(accent).toMatch(/(^|\s)border-accent-500\/40(\s|$)/);
    expect(accent).toMatch(/(^|\s)shadow-glow(\s|$)/);
    expect(accent).toContain('from-accent-500/10');
  });

  it('акцент в покое не зависит от доступности — условие ветки только isAccented', () => {
    // Доказывается двумя фактами вместе: состав покоя в файле ровно один, и он
    // лежит в ветке, чьё условие — `isAccented` без продолжения (регулярка
    // `accent` требует `?` сразу за именем, так что `isAccented && …` она не
    // захватит и захваченная строка окажется пустой).
    expect(countOf(grid, 'border-accent-500/40')).toBe(1);
    expect(accent).toContain('border-accent-500/40');
  });

  it('под курсором акцентная доступная карточка остаётся акцентной', () => {
    // ⚠️ `.bento-card-hover:hover` из `src/styles/globals.css` — специфичность
    // 0,2,0 — перебивает утилиты акцента (0,1,0) и на hover возвращает серую
    // рамку с собственным box-shadow. Hover-варианты тоже 0,2,0, но лежат в
    // `@layer utilities` — ниже по источнику, поэтому выигрывают.
    for (const utility of HOVER_ACCENT_UTILITIES) {
      expect(hoverAccent).toContain(utility);
    }
  });

  it('ни одна hover-утилита карточки не выдаётся вне ветви method.is_available', () => {
    // ⚠️ Инвариант структурный, а не списочный: КАЖДЫЙ строковый литерал массива
    // `className`, содержащий `hover:`, обязан лежать в ветви «да» тройного
    // оператора, условие которого включает `method.is_available`. Проверка по
    // списку известных утилит ловила бы только их переименование, но не третью
    // дописанную утилиту — ни безусловным элементом, ни в ветви «иначе».
    //
    // `:hover` на `disabled`-кнопке в CSS срабатывает: класс-гейт есть только у
    // `.bento-card-hover:hover`, у utility-вариантов `hover:` его нет.
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

  it('недоступная карточка приглушена и некликабельна', () => {
    expect(grid).toContain("'bento-card cursor-not-allowed opacity-50'");
    expect(grid).toContain('disabled={!method.is_available}');
  });
});

describe('иконок способов в блоке нет (задача #55)', () => {
  it('апстримный PaymentMethodIcon не импортирован и не отрисован', () => {
    // ⚠️ Требование владельца: иконки способов ему не нравятся, их нет ни на
    // балансе, ни на экране выбора. Апстримный компонент (501 строка) запрещено и
    // копировать, и импортировать — границы задачи #55.
    expect(grid).not.toContain('PaymentMethodIcon');
  });
});

describe('блок карточек живёт одним компонентом (задача #55)', () => {
  const balancePage = stripComments(read(BALANCE_PAGE));
  const selectPage = stripComments(read(SELECT_PAGE));

  it('разбор обеих страниц удался', () => {
    expect(balancePage).toMatch(/export function SimpleBalance\(/);
    expect(selectPage).toMatch(/export function SimpleTopUpMethodSelect\(/);
  });

  it('оба экрана рендерят общий компонент', () => {
    for (const [name, page] of [
      ['баланс', balancePage],
      ['выбор способа', selectPage],
    ] as const) {
      expect(page, name).toContain('<PaymentMethodsGrid');
      expect(page, name).toContain("PaymentMethodsGrid } from '../components/PaymentMethodsGrid'");
    }
  });

  it('копии разметки карточки на страницах не осталось', () => {
    // ⚠️ Сторож против расползания: диапазон сумм, класс кликабельной карточки и
    // признак акцента живут ровно в одном файле — в компоненте. Инлайн-копия на
    // любой из страниц (а именно так блок и жил до #55) разъехалась бы с
    // оригиналом при первой правке.
    const MARKERS = ['min_amount_kopeks', 'bento-card-hover', 'isAccented'];

    for (const marker of MARKERS) {
      expect(countOf(grid, marker), `${marker} в компоненте`).toBeGreaterThan(0);
      expect(countOf(balancePage, marker), `${marker} на балансе`).toBe(0);
      expect(countOf(selectPage, marker), `${marker} на выборе способа`).toBe(0);
    }
  });
});
