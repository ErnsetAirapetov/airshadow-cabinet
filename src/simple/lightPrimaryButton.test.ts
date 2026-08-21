import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MIN_ACCENT_SHADE,
  isAllowedAccentShade,
  isLightRemappedShade,
} from './components/accentShades';

/**
 * Сторож главной кнопки в СВЕТЛОЙ теме (#76).
 *
 * ⚠️ Что охраняется. `.light .btn-primary` в `src/styles/globals.css` — наш
 * локальный патч в апстримном файле (реестр — docs/architecture/two-modes.md,
 * «Что остаётся нашим в апстримных файлах»). Апстримное правило красило главную
 * кнопку `bg-champagne-700`, то есть уводило её с акцентной палитры оператора на
 * нейтральную «шампань»: в тёмной теме «Купить» и «Вход» акцентные
 * (`.btn-primary` → `bg-accent-500`), в светлой — серые. Владелец на стенде,
 * 21.08.2026.
 *
 * ⚠️ Зачем сторож вообще, если сборка зелёная. Именно потому, что зелёная. Патч
 * лежит в файле, который апстрим правит регулярно; при разрешении конфликта
 * «шампань» вернётся МОЛЧА — ни сборка, ни типы про цвет кнопки ничего не знают.
 * Этот форк уже терял правки ровно так (#59 → #61, #33). Читаем CSS текстом,
 * потому что другого способа нет: `environment: 'node'`, вычисленных стилей не
 * существует (docs/architecture/two-modes.md, раздел «Тесты»). Поэтому же
 * обязателен блок «разбор удался»: промахнувшаяся регулярка даёт вечно зелёного
 * сторожа, который хуже отсутствующего.
 *
 * ⚠️ Запреты — ОТ ОБРАТНОГО и по классу. Разрешена ровно акцентная палитра
 * оператора и ровно глубокие шейды; всё прочее — красное, включая палитры,
 * которых в `globals.css` сегодня нет. Список запрещённых шейдов НЕ заводится
 * здесь заново: он один на форк и живёт в `components/accentShades.ts`, вместе с
 * разбором, почему 300 и 400 подменяются светлой темой, а акцент светлее
 * шестисотого запрещён решением #62. Второй список разъехался бы с первым молча.
 *
 * ⚠️ Чего сторож НЕ проверяет: как это выглядит. Смена палитры оператора и
 * светлая тема автотестом не воспроизводятся — проверка глазами за владельцем на
 * дев-стенде.
 */

const CSS_PATH = 'src/styles/globals.css';
const css = readFileSync(CSS_PATH, 'utf8');

/** Правило целиком: селектор, за которым идёт тело без вложенных скобок. */
const LIGHT_PRIMARY_RULE = /\.light\s+\.btn-primary\s*\{([^}]*)\}/g;

/**
 * Цветная утилита Tailwind: свойство, палитра, шейд и необязательная прозрачность.
 *
 * ⚠️ Вариант (`hover:`, `active:`, `focus-visible:`) отсекается сам: двоеточие не
 * входит ни в `\w`, ни в `-`, поэтому граница `(?<![\w-])` его пропускает, а
 * запреты действуют на все состояния разом. Утилиты размера (`shadow-md`,
 * `ring-2`) сюда не попадают: у них нет двух-трёхзначного шейда.
 *
 * ⚠️ `ring-offset` стоит в списке ПЕРЕД `ring`: иначе `ring-offset-champagne-100`
 * разобралось бы как палитра «offset-champagne», и запрет палитры промолчал бы.
 */
const COLOR_UTILITY =
  /(?<![\w-])(bg|text|shadow|ring-offset|ring|border|from|via|to|placeholder|decoration|outline|divide|caret|fill|stroke)-([a-z][a-z-]*?)-(\d{2,3})(?:\/(\d{1,3}))?(?![\w-])/g;

/**
 * Цвет, названный именем, а не шейдом: `text-white`, `text-on-accent`.
 *
 * Нужен отдельным разбором ровно ради `text-white` — литерального белого, который
 * ломается на светлом акценте оператора (`src/hooks/useThemeColors.ts:242-243`):
 * шейда у него нет, и проверка выше его не видит вовсе.
 */
const NAMED_COLOR =
  /(?<![\w-])(?:bg|text|shadow|ring|border|from|via|to|placeholder|fill|stroke)-(white|black|transparent|current|inherit|on-accent|on-success|on-warning|on-error)(?![\w-])/g;

/**
 * Любая утилита тени: и размер (`shadow-md`, `shadow-2xl`), и цвет
 * (`shadow-accent-900/20`).
 *
 * ⚠️ Хвост начинается с `[a-z0-9]`, а НЕ с буквы, и это не косметика. Пока там
 * стояло `[a-z]`, `shadow-2xl` не давал совпадения ВООБЩЕ — ни как размер, ни как
 * цвет: группа хвоста не бралась, а голое `shadow` упиралось в `-` и отсекалось
 * границей `(?![\w-])`. Запрет ореола молчал ровно на том размере, ради которого
 * заведён: мутация `hover:shadow-lg` → `hover:shadow-2xl` проходила зелёной.
 * Поэтому же самопроверка ниже гоняет `2xl` и `3xl` — дыра была в самом стороже.
 */
const SHADOW_UTILITY = /(?<![\w-])shadow(?:-([a-z0-9][a-z0-9-]*(?:\/\d{1,3})?))?(?![\w-])/g;

/**
 * Хвост утилиты, по которому она опознаётся как ЦВЕТ, а не размер.
 *
 * ⚠️ Разделение структурное, а не по списку имён размеров: список пришлось бы
 * пополнять за каждой новой утилитой Tailwind, и `shadow-2xl`, забытый в нём,
 * прошёл бы молча. Здесь наоборот — цветом считается всё, что кончается шейдом,
 * остальное разбирается как размер и обязано быть в разрешённых.
 */
const COLOR_TAIL = /-\d{2,3}(?:\/\d{1,3})?$/;

/**
 * Палитра, которой главной кнопке разрешено краситься. Одна и без исключений:
 * «шампань», серые `dark-*` и статусные палитры на главном действии — это и есть
 * дефект #76, только с другим именем.
 */
const ALLOWED_PALETTE = 'accent';

/** Именованный цвет, который разрешён. Считается от палитры, а не захардкожен. */
const ALLOWED_NAMED_COLOR = 'on-accent';

/**
 * Размеры тени, которые остаются тенью ГЛУБИНЫ.
 *
 * ⚠️ `xl`, `2xl` и `glow` — это ореол: свет вокруг кнопки, а не под ней. С
 * акцентной палитрой ореол вернул бы ровно ту «кислотность», которую сняли в #62,
 * — там же, в `components/accentSurface.ts`, тень срезана до короткой по той же
 * причине.
 */
const ALLOWED_SHADOW_SIZES = new Set(['', 'sm', 'md', 'lg']);

/** Тень красится ГЛУБОКИМ концом палитры — тем же, что и низ акцентной заливки. */
const SHADOW_MIN_SHADE = 800;

/** И остаётся негромкой: тень глубины не светит. */
const SHADOW_MAX_ALPHA = 25;

interface ColorUtility {
  property: string;
  palette: string;
  shade: string;
  alpha: number | null;
}

function colorUtilities(text: string): ColorUtility[] {
  return [...text.matchAll(COLOR_UTILITY)].map((found) => ({
    property: found[1],
    palette: found[2],
    shade: found[3],
    alpha: found[4] === undefined ? null : Number(found[4]),
  }));
}

function namedColors(text: string): string[] {
  return [...text.matchAll(NAMED_COLOR)].map((found) => found[1]);
}

function shadowSizes(text: string): string[] {
  return [...text.matchAll(SHADOW_UTILITY)]
    .map((found) => found[1] ?? '')
    .filter((tail) => !COLOR_TAIL.test(tail));
}

/** Инструкция `@apply` в теле правила. Их может быть несколько — берём ВСЕ. */
const APPLY_INSTRUCTION = /@apply\s+([^;]+);/g;

/** Комментарий CSS: ничего не красит, в остаток тела не идёт. */
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

/**
 * Утилиты правила, собранные из всех `@apply` его тела.
 *
 * ⚠️ `matchAll`, а не `exec`. С одним разбором второй `@apply` в том же теле был
 * сторожу невиден, а в CSS он совершенно законен и перебивает первый: мутация
 * «дописать `@apply hover:bg-champagne-600 text-white;` строкой ниже» возвращала
 * «шампань» при зелёном стороже.
 */
function applyUtilities(body: string): string {
  return [...body.matchAll(APPLY_INSTRUCTION)].map((found) => found[1]).join(' ');
}

/**
 * Что осталось в теле правила, кроме `@apply` и комментариев.
 *
 * ⚠️ Проверка СТРУКТУРНАЯ, а не по списку имён свойств, и по той же причине, по
 * которой размер тени отделяется от цвета структурно: список пришлось бы
 * пополнять за каждым свойством CSS, а забытое в нём `background-color` вернуло
 * бы «шампань» мимо всех запретов разом. Сырое объявление не даёт НИ ОДНОЙ
 * утилиты Tailwind — разбирать в нём нечего, поэтому запреты ниже его и не
 * видят. Значит, тело обязано состоять из `@apply` и больше ни из чего.
 */
function bodyLeftover(body: string): string {
  return body.replace(CSS_COMMENT, ' ').replace(APPLY_INSTRUCTION, ' ').trim();
}

const ruleBodies = [...css.matchAll(LIGHT_PRIMARY_RULE)].map((found) => found[1]);
const ruleBody = ruleBodies[0] ?? '';
const applyList = applyUtilities(ruleBody);
const utilities = applyList.split(/\s+/).filter(Boolean);

describe('разбор удался', () => {
  it('правило .light .btn-primary найдено в globals.css ровно одно', () => {
    // ⚠️ Пара, без которой сторож молчал бы на переименованном селекторе. И
    // «ровно одно» здесь не педантизм: второе правило ниже по файлу перебило бы
    // первое, и все запреты ниже проверяли бы мёртвый текст.
    expect(css.length).toBeGreaterThan(1000);
    expect(ruleBodies).toHaveLength(1);
  });

  it('список утилит разобран и не пуст', () => {
    expect(utilities.length).toBeGreaterThan(4);
    expect(colorUtilities(applyList).length).toBeGreaterThan(0);
  });

  it('в теле правила нет ничего, кроме @apply', () => {
    // ⚠️ Пара ко ВСЕМ запретам ниже сразу, и потому она структурная. Каждый из
    // них разбирает утилиты Tailwind; сырое `background-color:
    // rgb(var(--color-champagne-700))` в том же теле не даёт ни одной утилиты —
    // и «шампань» возвращается молча, при зелёном стороже. Мутация «дописать
    // сырое объявление рядом с @apply» краснеет здесь.
    expect(bodyLeftover(ruleBody)).toBe('');
  });

  it('разбор утилит работает на синтетическом тексте', () => {
    // Самопроверка регулярок: промахнись любая — запреты ниже прошли бы на
    // пустом списке, а сторож стал бы вечно зелёным.
    expect(colorUtilities('bg-champagne-700 hover:shadow-accent-900/25 shadow-md')).toEqual([
      { property: 'bg', palette: 'champagne', shade: '700', alpha: null },
      { property: 'shadow', palette: 'accent', shade: '900', alpha: 25 },
    ]);
    expect(colorUtilities('focus-visible:ring-offset-champagne-100')).toEqual([
      { property: 'ring-offset', palette: 'champagne', shade: '100', alpha: null },
    ]);
    expect(namedColors('text-white bg-accent-600 text-on-accent')).toEqual(['white', 'on-accent']);
    // ⚠️ `2xl` и `3xl` здесь не для полноты: на них сторож и промолчал. Хвост,
    // обязанный начинаться с буквы, не давал совпадения вовсе — размер уезжал
    // мимо запрета, не попадая при этом и в цвета. Рядом стоят цветные хвосты:
    // отделение цвета от размера обязано пережить починку.
    expect(
      shadowSizes(
        'shadow-md hover:shadow-xl shadow-2xl shadow-3xl shadow-accent-900/20 shadow-champagne-500 shadow',
      ),
    ).toEqual(['md', 'xl', '2xl', '3xl', '']);
  });

  it('тело правила разбирается целиком: все @apply и остаток', () => {
    // Самопроверка второй пары регулярок. Слева — два `@apply` в одном теле:
    // с `exec` вместо `matchAll` второй был невиден. Справа — сырое объявление,
    // которое обязано остаться в остатке, а комментарий — нет.
    expect(
      applyUtilities('@apply bg-accent-600;\n@apply hover:bg-accent-700 text-on-accent;'),
    ).toBe('bg-accent-600 hover:bg-accent-700 text-on-accent');
    expect(bodyLeftover('/* про цвет */\n@apply bg-accent-600;\n')).toBe('');
    expect(bodyLeftover('@apply bg-accent-600;\ncolor: #fff;')).toBe('color: #fff;');
  });
});

describe('главная кнопка светлой темы красится акцентом оператора (#76)', () => {
  it('ни одной цветной утилиты вне акцентной палитры', () => {
    // ⚠️ Сердце задачи и правило ОТ ОБРАТНОГО. Мутация «вернуть
    // `bg-champagne-700 … hover:bg-champagne-600`» краснеет здесь — как покраснела
    // бы любая другая палитра, включая ту, которой в апстриме ещё нет.
    for (const utility of colorUtilities(applyList)) {
      const found = `${utility.property}-${utility.palette}-${utility.shade}`;
      expect(`${found}: ${utility.palette}`).toBe(`${found}: ${ALLOWED_PALETTE}`);
    }
  });

  it('заливка у кнопки есть, и она акцентная', () => {
    // Пара к запрету выше: правило без единой заливки прошло бы его молча.
    const fills = colorUtilities(applyList).filter((utility) => utility.property === 'bg');

    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill.palette).toBe(ALLOWED_PALETTE);
    }
  });

  it('надпись идёт от --color-on-accent, а не от белого литерала', () => {
    // ⚠️ `src/hooks/useThemeColors.ts:242-243`: цвет «поверх акцента» считается от
    // выбранной палитры именно потому, что «захардкоженный белый ломается, как
    // только оператор выбирает светлый акцент». Апстримное правило ставило
    // `text-white`. Мутация «вернуть `text-white`» краснеет здесь.
    expect(applyList).toContain(`text-${ALLOWED_NAMED_COLOR}`);
    for (const color of namedColors(applyList)) {
      expect(color).toBe(ALLOWED_NAMED_COLOR);
    }
  });
});

describe('запрещённые шейды в правило не попадают', () => {
  it('ни один шейд не из тех, что светлая тема подменяет', () => {
    // ⚠️ Блок `.light` ремапит третьи и четвёртые шейды всех палитр через
    // `!important`: `bg-accent-400` в светлой теме — это семисотый, то есть не тот
    // цвет, который написан. Мутация «поставить `bg-accent-400`» краснеет здесь.
    // Список — общий с акцентом кнопки «Подключить устройство», см.
    // `components/accentShades.ts`; сверка списка с самим `globals.css` живёт в
    // `components/subscription/connectButtonAccent.test.ts`.
    for (const utility of colorUtilities(applyList)) {
      const found = `${utility.property}-${utility.palette}-${utility.shade}`;
      expect(`${found}: ${isLightRemappedShade(utility.shade)}`).toBe(`${found}: false`);
    }
  });

  it('акцентных шейдов светлее шестисотого нет ни одного', () => {
    // ⚠️ Решение #62, тот же класс запрета: приглушается ТОН, а не вес. Мутация
    // «поставить `bg-accent-500`» краснеет здесь, хотя пятисотый светлой темой не
    // ремапится и проверку выше прошёл бы.
    for (const utility of colorUtilities(applyList)) {
      const found = `${utility.property}-${utility.palette}-${utility.shade}`;
      expect(`${found}: ${isAllowedAccentShade(utility.shade)}`).toBe(`${found}: true`);
    }
  });

  it('правило запрета — общее с акцентом простого режима, а не своя копия', () => {
    // Пара к двум проверкам выше: разъедься константы — здесь покраснеет.
    expect(MIN_ACCENT_SHADE).toBe(600);
    expect(isAllowedAccentShade(500)).toBe(false);
    expect(isAllowedAccentShade(400)).toBe(false);
    expect(isAllowedAccentShade(600)).toBe(true);
  });
});

describe('тень — глубины, а не цветной ореол', () => {
  it('размер тени короткий: ни xl, ни свечения', () => {
    // ⚠️ Апстримное правило светило `hover:shadow-xl`. С «шампанью» это было
    // терпимо, с акцентной палитрой вернуло бы «кислотно яркую» кнопку из #62.
    const sizes = shadowSizes(applyList);

    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(`shadow-${size}: ${ALLOWED_SHADOW_SIZES.has(size)}`).toBe(`shadow-${size}: true`);
    }
  });

  it('цвет тени — глубокий конец палитры и малая прозрачность', () => {
    // ⚠️ Апстримное `shadow-champagne-500/20` светило цветом ВОКРУГ кнопки.
    // Мутация «вернуть светлый шейд тени» или «поднять прозрачность» краснеет
    // здесь. Та же тень, что у акцентной поверхности простого режима:
    // `0 2px 8px rgba(var(--color-accent-900), 0.25)`.
    const shadows = colorUtilities(applyList).filter((utility) => utility.property === 'shadow');

    expect(shadows.length).toBeGreaterThan(0);
    for (const shadow of shadows) {
      const found = `shadow-${shadow.palette}-${shadow.shade}`;
      expect(`${found}: ${Number(shadow.shade) >= SHADOW_MIN_SHADE}`).toBe(`${found}: true`);
      expect(`${found}: ${(shadow.alpha ?? 100) <= SHADOW_MAX_ALPHA}`).toBe(`${found}: true`);
    }
  });
});
