import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LIGHT_REMAPPED_SHADES,
  MIN_ACCENT_SHADE,
  lightBlock,
  lightRemappedShades,
} from '../accentShades';
import {
  ACCENT_FOREGROUND,
  ACCENT_FOREGROUND_MUTED,
  ACCENT_SHADOW,
  accentFill,
} from '../accentSurface';
import { type ConnectButtonAccent, resolveConnectButtonAccent } from './connectButtonAccent';

/**
 * Акцент кнопки «Подключить устройство» (задача #61).
 *
 * Модуль импортируется НАПРЯМУЮ, а не читается текстом: он чистый и вообще ни от
 * чего не зависит, так что alias `@/` ему не нужен
 * (docs/architecture/two-modes.md, раздел «Тесты»). Текстом сторожится сам
 * компонент — в `connectDeviceButton.test.ts`.
 *
 * ⚠️ Главное, что здесь охраняется, — цвет идёт из АКЦЕНТНОЙ ПАЛИТРЫ ОПЕРАТОРА,
 * а не литералом. До #61 в выдаче стояли `#3B82F6`/`#1D4ED8` и белый текст: это
 * ровно акцент ПО УМОЛЧАНИЮ (`--color-accent-500: 59, 130, 246`,
 * `src/styles/globals.css:167`), то есть кнопка выглядела правильно ровно до
 * первой смены палитры в админке. Проверка ниже написана ОТ ОБРАТНОГО —
 * запрещено всё, кроме явно разрешённого, — потому что перечень запрещённых форм
 * записи цвета уже однажды подводил (канон, «ложно-зелёные сторожа»).
 */

/** Исходник охраняемого модуля — сигнатура сверяется текстом, а не через `.length`. */
const source = readFileSync('src/simple/components/subscription/connectButtonAccent.ts', 'utf8');

/**
 * Исходник ОБЩЕЙ акцентной поверхности (#72).
 *
 * ⚠️ С #72 заливку, тень и цвет «поверх акцента» задаёт не этот модуль, а
 * `src/simple/components/accentSurface.ts`: ту же поверхность носит карточка
 * баланса на главной. Причина переезда — ровно та, что записана в докстринге
 * кнопки: копии расходятся молча, со сборкой зелёной (#59 → #61). Поэтому и
 * СТОРОЖ переезжает вместе с поверхностью: запреты ниже гоняются не только по
 * выдаче кнопки, но и по значениям общего модуля — иначе яркость вернулась бы
 * через поле, которым пользуется только виджет баланса.
 */
const surfaceSource = readFileSync('src/simple/components/accentSurface.ts', 'utf8');

/**
 * Комментарии вырезаны — докстринги обоих модулей сами называют запрещённые
 * шейды, разбирая, почему их тут не бывает. На сыром тексте структурная проверка
 * ниже краснела бы по собственной прозе.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Код общего модуля без прозы — по нему идут структурные запреты. */
const surfaceCode = stripComments(surfaceSource);

/** Код акцента кнопки без прозы — по нему проверяется, что шейдов тут не осталось. */
const buttonCode = stripComments(source);

/** Все шейды палитр, на которые ссылается текст. */
function paletteShades(text: string, palette = '(?:accent|warning|success|error)'): string[] {
  return [...text.matchAll(new RegExp(`--color-${palette}-(\\d{2,3})`, 'g'))].map(
    (found) => found[1],
  );
}

/**
 * Список параметров экспортируемой функции — текстом, со скобочным балансом.
 *
 * ⚠️ Нужен потому, что `Function.length` НЕ СЧИТАЕТ параметры со значением по
 * умолчанию: у `f(a, isDark = true)` длина остаётся единицей. Сторож на `.length`
 * поэтому пропускал бы ровно ту правку, ради запрета которой стоит (урок #59).
 */
function parameterList(text: string, name: string): string | null {
  const marker = `export function ${name}(`;
  const at = text.indexOf(marker);
  if (at === -1) return null;

  const open = at + marker.length - 1;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i).trim();
    }
  }
  return null;
}

/**
 * Идентификаторы, которые в CSS-значении разрешены. Всё остальное — подозрение
 * на цвет: `white`, `red`, `currentColor` попадут сюда одинаково.
 */
const ALLOWED_TOKENS = new Set(['linear-gradient', 'var', 'rgb', 'rgba', 'none', 'transparent']);

/**
 * Запрещённые шейды — ОДИН список на весь форк (#76).
 *
 * ⚠️ До #76 `LIGHT_REMAPPED_SHADES` и `MIN_ACCENT_SHADE` были объявлены прямо
 * здесь. В #76 те же два запрета понадобились сторожу правила
 * `.light .btn-primary` в `globals.css` — и второй список означал бы ровно тот
 * дефект, против которого стоит весь остальной сторож: копии расходятся молча.
 * Поэтому правило переехало в `../../accentShades`, а разбор, почему шейды 300 и
 * 400 подменяются, а акцент светлее шестисотого запрещён, живёт в его докстринге.
 *
 * Что остаётся ЗДЕСЬ и никуда не переезжает: исключения именно этого модуля —
 * `--color-on-accent` (не шейд, а считанный контрастный цвет) и
 * `--color-warning-200` у подписи лимита, которая лежит НА заливке, где светлый
 * тон и нужен, — и сверка списка с самим `globals.css` (тест ниже). Сверка тоже в
 * единственном экземпляре: два сторожа читают один список, проверяет его один.
 */

const PALETTE_VAR = /^--color-(?:accent|warning|success|error)-(\d{2,3})$/;
const ACCENT_VAR = /^--color-accent-(\d{2,3})$/;

/**
 * Переменная темы, которой кнопке разрешено краситься.
 *
 * ⚠️ Правило закрывает КЛАСС, а не случай. Прежнее `--color-(accent|warning)-\d+`
 * разрешало любой шейд, включая ремапящиеся, — и приглашало наступить снова:
 * подпись «лимит достигнут» стояла на `--color-warning-400` и в светлой теме
 * превращалась в `--color-warning-700`, тёмно-оранжевый на синей заливке с
 * контрастом 1.37 к одному.
 *
 * ⚠️ С #62 к нему добавлено второе условие — акцент не светлее шестисотого.
 * Запрет ремапящихся шейдов сам по себе кислотность не ловит: `--color-accent-500`
 * ремапу не подвержен и прошёл бы, а именно он и давал яркость.
 */
function isAllowedVar(name: string): boolean {
  if (name === '--color-on-accent') return true;

  const shade = PALETTE_VAR.exec(name)?.[1];
  if (shade === undefined || LIGHT_REMAPPED_SHADES.has(shade)) return false;

  const accentShade = ACCENT_VAR.exec(name)?.[1];

  return accentShade === undefined || Number(accentShade) >= MIN_ACCENT_SHADE;
}

/**
 * Идентификаторы значения, не входящие в разрешённый список.
 *
 * ⚠️ Правило от обратного. Границей `(?<![\w-])` отсекаются единицы (`135deg`,
 * `24px`): они начинаются сразу за цифрой и цветом быть не могут.
 */
function foreignTokens(value: string): string[] {
  const found: string[] = [];

  for (const match of value.matchAll(/(?<![\w-])(?:--)?[A-Za-z][\w-]*/g)) {
    const token = match[0];
    if (token.startsWith('--')) {
      if (!isAllowedVar(token)) found.push(token);
    } else if (!ALLOWED_TOKENS.has(token)) {
      found.push(token);
    }
  }

  return found;
}

/** Первые аргументы всех `rgb()`/`rgba()` значения — источник цвета каждой функции. */
function rgbSources(value: string): string[] {
  return [...value.matchAll(/rgba?\(\s*([^,)]+)/g)].map((match) => match[1].trim());
}

/** Все переменные темы, на которые ссылается значение. */
function themeVars(value: string): string[] {
  return [...value.matchAll(/(?<![\w-])--[A-Za-z][\w-]*/g)].map((match) => match[0]);
}

/** Hex-литералы значения. */
function hexLiterals(value: string): string[] {
  return [...value.matchAll(/#[0-9A-Fa-f]{3,8}/g)].map((match) => match[0]);
}

/** Пиксельные длины значения — смещения и радиус размытия тени. */
function pixelLengths(value: string): number[] {
  return [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
}

/**
 * Прозрачности значения — последний аргумент каждого `rgba()`.
 *
 * ⚠️ Ищется именно «число перед закрывающей скобкой», иначе шейд из
 * `rgba(var(--color-accent-900), 0.25)` уехал бы в выдачу как число 900.
 */
function alphaValues(value: string): number[] {
  return [...value.matchAll(/,\s*([01](?:\.\d+)?)\s*\)/g)].map((match) => Number(match[1]));
}

const enabled = resolveConnectButtonAccent(false);
const atLimit = resolveConnectButtonAccent(true);
const everyValue: string[] = [...Object.values(enabled), ...Object.values(atLimit)];

/**
 * Значения общего модуля — включая те, которыми кнопка не пользуется (#72).
 *
 * ⚠️ Список собран ВРУЧНУЮ, а не из выдачи кнопки: смысл сторожа как раз в
 * полях, которых в кнопке нет. `ACCENT_FOREGROUND_MUTED` носит подпись «Текущий
 * баланс», приглушённая заливка `accentFill(0.55)` — состояние лимита; вернись
 * светлый шейд в любое из них, выдача кнопки осталась бы прежней и запреты
 * промолчали бы.
 */
const surfaceValues: string[] = [
  accentFill(),
  accentFill(0.55),
  ACCENT_SHADOW,
  ACCENT_FOREGROUND,
  ACCENT_FOREGROUND_MUTED,
];

/** Всё, на что распространяются запреты цвета: выдача кнопки плюс общая поверхность. */
const everyGuardedValue: string[] = [...everyValue, ...surfaceValues];

describe('разбор удался', () => {
  it('исходник модуля прочитан и сигнатура разобрана', () => {
    // Без пары проверки «в значениях нет литералов» проходили бы на пустоте.
    expect(source.length).toBeGreaterThan(1000);
    expect(parameterList(source, 'resolveConnectButtonAccent')).toBeTruthy();
    expect(parameterList('export function f(a: boolean, isDark = true): X {', 'f')).toBe(
      'a: boolean, isDark = true',
    );
    expect(parameterList(source, 'такойФункцииНет')).toBeNull();
  });

  it('в выдаче есть все поля, и они непустые', () => {
    expect(everyValue.length).toBeGreaterThan(0);
    for (const value of everyValue) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('разбор цвета ловит литералы на синтетических значениях', () => {
    // Самопроверка детекторов: сломайся любой — и запреты ниже молчали бы.
    expect(hexLiterals('linear-gradient(135deg, #3B82F6, #1D4ED8)')).toHaveLength(2);
    expect(hexLiterals('rgb(var(--color-accent-500))')).toHaveLength(0);
    expect(rgbSources('0 6px 24px rgba(59,130,246,0.38)')).toEqual(['59']);
    expect(rgbSources('rgba(var(--color-accent-900), 0.25)')).toEqual(['var(--color-accent-900']);
    expect(foreignTokens('rgba(255,255,255,0.18)')).toEqual([]);
    expect(foreignTokens('1px solid white')).toEqual(['solid', 'white']);
    expect(foreignTokens('rgb(var(--color-critical-500))')).toEqual(['--color-critical-500']);
    expect(foreignTokens('linear-gradient(135deg, rgb(var(--color-accent-600)))')).toEqual([]);
  });

  it('разбор длин и прозрачностей работает на синтетических значениях', () => {
    // Самопроверка: сломайся любой из двух — и «тень короткая и тихая» ниже
    // проходило бы на чём угодно, включая вернувшийся ореол.
    expect(pixelLengths('0 2px 8px rgba(var(--color-accent-900), 0.25)')).toEqual([2, 8]);
    expect(pixelLengths('none')).toEqual([]);
    // ⚠️ Именно ради этой строки альфа ищется перед закрывающей скобкой: шейд
    // `900` числом прозрачности не является.
    expect(alphaValues('0 6px 24px rgba(var(--color-accent-900), 0.38)')).toEqual([0.38]);
    expect(alphaValues('rgb(var(--color-accent-600))')).toEqual([]);
  });

  it('разрешающее правило переменных работает на синтетических именах', () => {
    // Самопроверка: сломайся `isAllowedVar` — и запрет ремапящихся шейдов
    // молчал бы на любой выдаче.
    expect(isAllowedVar('--color-on-accent')).toBe(true);
    expect(isAllowedVar('--color-accent-600')).toBe(true);
    expect(isAllowedVar('--color-accent-800')).toBe(true);
    expect(isAllowedVar('--color-accent-900')).toBe(true);
    expect(isAllowedVar('--color-warning-200')).toBe(true);
    expect(isAllowedVar('--color-warning-400')).toBe(false);
    expect(isAllowedVar('--color-accent-300')).toBe(false);
    // ⚠️ #62: пятисотый ремапу не подвержен и прежним правилом проходил — а
    // кислотность давал именно он.
    expect(isAllowedVar('--color-accent-500')).toBe(false);
    expect(isAllowedVar('--color-accent-50')).toBe(false);
    expect(isAllowedVar('--color-critical-500')).toBe(false);
    expect(themeVars('rgba(var(--color-accent-600), 0.4)')).toEqual(['--color-accent-600']);
  });

  it('список ремапящихся шейдов сверен с самим globals.css', () => {
    // ⚠️ Пара, без которой список выродился бы в поверье. Начнёт светлая тема
    // ремапить ещё один шейд — здесь покраснеет, и запрет ниже расширится
    // вместе с реальностью, а не через полгода по жалобе.
    const css = readFileSync('src/styles/globals.css', 'utf8');
    const remapped = lightRemappedShades(css);

    // ⚠️ Длина ИМЕННО блока `.light`, а не всего файла: `globals.css` весит
    // десятки килобайт и прошёл бы проверку длины даже с вырезанным блоком —
    // такая проверка непадаема и пару держала бы только на вид.
    expect(lightBlock(css).length).toBeGreaterThan(200);
    expect(remapped.size).toBeGreaterThan(0);
    expect([...remapped].sort()).toEqual([...LIGHT_REMAPPED_SHADES].sort());
  });
});

describe('цвет следует акцентной палитре оператора, а не литералу (#61)', () => {
  it('hex-литералов в выдаче нет ни одного', () => {
    // Мутация: вернуть `#3B82F6` в заливку — краснеет здесь.
    for (const value of everyGuardedValue) {
      expect(hexLiterals(value)).toEqual([]);
    }
  });

  it('каждый rgb()/rgba() берёт цвет из переменной темы', () => {
    // Мутация: `rgba(59,130,246,0.38)` в свечении — краснеет здесь.
    for (const value of everyGuardedValue) {
      for (const argument of rgbSources(value)) {
        expect(argument.startsWith('var(--color-')).toBe(true);
      }
    }
  });

  it('посторонних идентификаторов в значениях нет (правило от обратного)', () => {
    // Мутация: `white` вместо `rgb(var(--color-on-accent))` — краснеет здесь,
    // хотя ни hex, ни `rgb(` в такой записи нет вовсе.
    for (const value of everyGuardedValue) {
      expect(foreignTokens(value)).toEqual([]);
    }
  });

  it('заливка идёт от глубоких акцентных шейдов — 600 и 800 (#62)', () => {
    // Решение владельца по #62: тон заливки уходит глубже, 500→700 становится
    // 600→800. Кнопка остаётся сплошной заливкой и самым громким элементом
    // страницы — приглушается тон, а не вес.
    for (const value of [enabled.background, atLimit.background]) {
      expect(value).toContain('var(--color-accent-600)');
      expect(value).toContain('var(--color-accent-800)');
      expect(value).not.toContain('var(--color-accent-500)');
      expect(value).not.toContain('var(--color-accent-700)');
    }
  });

  it('акцентных шейдов светлее шестисотого в выдаче нет ни одного (#62)', () => {
    // ⚠️ Сердце #62, и правило от обратного: запрещён КЛАСС, а не поле. Мутация
    // «вернуть `--color-accent-500` в свечение» (или в подложку иконки, или в
    // дорожку индикатора) краснеет здесь, хотя пятисотый в светлой теме не
    // ремапится и проверку выше прошёл бы.
    for (const value of everyGuardedValue) {
      for (const name of themeVars(value)) {
        const shade = ACCENT_VAR.exec(name)?.[1];
        if (shade === undefined) continue;
        expect(`${name}: ${Number(shade) >= MIN_ACCENT_SHADE}`).toBe(`${name}: true`);
      }
    }
  });

  it('текст и иконка идут от --color-on-accent, а не от белого литерала', () => {
    // ⚠️ `src/hooks/useThemeColors.ts:242-243`: захардкоженный белый ломается,
    // как только оператор выбирает светлый акцент. Цвет «поверх акцента»
    // считается там же из выбранной палитры.
    //
    // ⚠️ `indicatorGlow` из списка выбыл по #62: свечение точек снято совсем,
    // ссылаться ему теперь не на что. Его отсутствие охраняется отдельной
    // проверкой ниже — иначе оно вернулось бы молча.
    for (const value of [
      enabled.foreground,
      enabled.foregroundMuted,
      enabled.iconBackground,
      enabled.indicatorOn,
      enabled.indicatorOff,
      enabled.indicatorTrack,
    ]) {
      expect(value).toContain('var(--color-on-accent');
    }
  });

  it('ни один ремапящийся в светлой теме шейд в акценте не используется', () => {
    // ⚠️ Список включает и общий модуль (#72): подпись «Текущий баланс» лежит на
    // той же заливке, и ремапнутый шейд гасил бы её ровно так же.
    // ⚠️ Сердце починки. Подпись «лимит устройств достигнут» стояла на
    // `--color-warning-400`; в светлой теме `.light` подменяет его семисотым
    // через `!important`, и тёмно-оранжевая надпись на синей заливке давала
    // контраст 1.37 — состояние «упёрлись в лимит» переставало отличаться от
    // рабочего ровно там, где отличие и нужно. Инлайн-стиль от этого не спасает:
    // перебивается не стиль, а сама переменная.
    for (const value of everyGuardedValue) {
      for (const name of themeVars(value)) {
        const shade = PALETTE_VAR.exec(name)?.[1] ?? '';
        expect(`${name}: ${LIGHT_REMAPPED_SHADES.has(shade)}`).toBe(`${name}: false`);
      }
    }
  });

  it('у --color-on-accent есть запасное значение', () => {
    // Переменную заводит `applyThemeColors` в эффекте провайдера, а объявления
    // по умолчанию в `globals.css` у неё нет (в отличие от `--color-accent-*`).
    // Без запасного значения первый кадр остался бы с невалидным цветом.
    expect(enabled.foreground).toContain('var(--color-on-accent, 255, 255, 255)');
  });
});

describe('состав акцента в покое сохранён (#59, требование в силе)', () => {
  it('в покое — заливка градиентом и тень', () => {
    // ⚠️ Тень задана В ПОКОЕ, а не на `:hover`: на телефоне и в Telegram
    // наведения не существует, и кнопку пролистывали. По #62 она приглушается,
    // но не исчезает — «none» здесь по-прежнему краснеет.
    expect(enabled.background).toMatch(/^linear-gradient\(/);
    expect(enabled.boxShadow).not.toBe('none');
    expect(enabled.boxShadow.length).toBeGreaterThan(0);
  });

  it('упёрлись в лимит устройств — состояние остаётся отличимым', () => {
    expect(atLimit.boxShadow).toBe('none');
    expect(atLimit.background).not.toBe(enabled.background);
  });
});

describe('неона больше нет: ореол и свечение точек сняты (#62)', () => {
  it('тень короткая и тихая, а не цветной ореол', () => {
    // ⚠️ Ореол `0 6px 24px rgba(…, 0.38)` и был жалобой владельца: кнопка
    // светилась в обе стороны и в светлой теме читалась «вырвиглазно». Осталась
    // мягкая тень глубины — короткая по размытию и негромкая по прозрачности.
    // Мутация «вернуть 24px» или «вернуть 0.38» краснеет здесь.
    const lengths = pixelLengths(enabled.boxShadow);
    expect(lengths.length).toBeGreaterThan(0);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(10);

    const alphas = alphaValues(enabled.boxShadow);
    expect(alphas).toHaveLength(1);
    expect(alphas[0]).toBeLessThanOrEqual(0.3);
  });

  it('свечение точек индикатора снято в обоих состояниях', () => {
    // ⚠️ Белые светящиеся точки на акцентной заливке давали ровно тот неон, на
    // который жалоба. Проверка явная, потому что поле из списка «ссылается на
    // --color-on-accent» выбыло: без неё свечение вернулось бы молча.
    expect(enabled.indicatorGlow).toBe('none');
    expect(atLimit.indicatorGlow).toBe('none');
  });

  it('подложка иконки стала тише прежних 0.18', () => {
    expect(alphaValues(enabled.iconBackground)).toEqual([0.14]);
  });
});

describe('акцентная поверхность одна на кнопку и карточку баланса (#72)', () => {
  it('разбор удался — общий модуль прочитан и не пуст', () => {
    // Без пары запреты ниже проходили бы на пустоте, а сверка «литерала нет»
    // стала бы вечно зелёной после переименования модуля.
    expect(surfaceSource.length).toBeGreaterThan(500);
    expect(surfaceSource).toContain('export function accentFill(');
  });

  it('кнопка берёт поверхность из общего модуля, а не объявляет свою', () => {
    // ⚠️ Сердце #72. Копия поверхности в двух файлах — ровно тот дефект, что уже
    // случился с самой кнопкой (#59 → #61): значения разъезжаются молча, сборка
    // зелёная, а на экране два разных синих.
    expect(source).toContain("from '../accentSurface'");
    expect(source).toContain('accentFill(');
    expect(source).toContain('ACCENT_SHADOW');
  });

  it('шейды заливки объявлены ровно в одном месте', () => {
    // Мутация «вернуть градиент литералом в connectButtonAccent.ts» краснеет
    // здесь: имя шейда в этом файле больше не пишется вовсе.
    expect(buttonCode).not.toContain('--color-accent-600');
    expect(buttonCode).not.toContain('--color-accent-800');
    expect(buttonCode).not.toContain('--color-accent-900');
    // Пара: в общем модуле они, наоборот, обязаны быть — иначе запрет выше
    // проходил бы на модуле, который заливку потерял.
    expect(surfaceCode).toContain('--color-accent-600');
    expect(surfaceCode).toContain('--color-accent-800');
    expect(surfaceCode).toContain('--color-accent-900');
  });

  it('в общем модуле нет ремапящихся шейдов — СТРУКТУРНО, а не по списку значений', () => {
    // ⚠️ Пара к `surfaceValues`: тот список собран РУКАМИ, и новое
    // экспортируемое поле (скажем, рамка акцентной карточки) выпало бы из-под
    // запретов молча — ровно тот класс дефекта, против которого стоит весь
    // остальной сторож. Проверка по тексту модуля от списка не зависит вовсе.
    const shades = paletteShades(surfaceCode);

    // Разбор удался: шейды в файле вообще есть.
    expect(shades.length).toBeGreaterThan(0);
    for (const shade of shades) {
      expect(`${shade}: ${LIGHT_REMAPPED_SHADES.has(shade)}`).toBe(`${shade}: false`);
    }
  });

  it('в общем модуле нет акцентных шейдов светлее шестисотого — тоже структурно', () => {
    const accentShades = paletteShades(surfaceCode, 'accent').map(Number);

    expect(accentShades.length).toBeGreaterThan(0);
    for (const shade of accentShades) {
      expect(`${shade}: ${shade >= MIN_ACCENT_SHADE}`).toBe(`${shade}: true`);
    }
  });

  it('разбор шейдов работает на синтетическом тексте', () => {
    // Самопроверка: промахнись регулярка — и обе проверки выше проходили бы на
    // пустом списке… если бы не пара «шейды вообще есть». Здесь — что она ловит
    // именно то, что нужно.
    expect(
      paletteShades('rgb(var(--color-accent-500)) rgba(var(--color-warning-300), 0.4)'),
    ).toEqual(['500', '300']);
    expect(paletteShades('var(--color-on-accent, 255, 255, 255)')).toEqual([]);
    expect(paletteShades('--color-accent-600 --color-warning-200', 'accent')).toEqual(['600']);
  });

  it('приглушение заливки — прозрачностью, а не вторым набором шейдов', () => {
    // Один аргумент вместо второго градиента: состояние «лимит» не заводит
    // собственных шейдов, значит и разойтись с рабочим не может.
    expect(accentFill()).toBe(enabled.background);
    expect(accentFill(0.55)).toBe(atLimit.background);
    expect(accentFill(0.55)).toContain('0.55');
  });

  it('цвет «поверх акцента» и его приглушённая версия идут из общего модуля', () => {
    expect(ACCENT_FOREGROUND).toBe(enabled.foreground);
    expect(ACCENT_FOREGROUND_MUTED).toBe(enabled.foregroundMuted);
    expect(ACCENT_FOREGROUND).toContain('var(--color-on-accent, 255, 255, 255)');
  });

  it('тень поверхности — та же, что у кнопки', () => {
    expect(ACCENT_SHADOW).toBe(enabled.boxShadow);
  });
});

describe('в акцент не проникает ничего, кроме состояния лимита (#59, требование в силе)', () => {
  it('в сигнатуре ровно один параметр, и он без значения по умолчанию', () => {
    // ⚠️ Зона расхода трафика и тема в выдачу не входят: кнопка меняла тон по
    // причине, к действию не относящейся.
    const parameters = parameterList(source, 'resolveConnectButtonAccent');
    expect(parameters).toMatch(/^isAtDeviceLimit\s*:/);
    expect(parameters).not.toContain(',');
    expect(parameters).not.toContain('=');
  });

  it('никакой дополнительный аргумент на выдачу не влияет', () => {
    const loose = resolveConnectButtonAccent as unknown as (
      ...args: unknown[]
    ) => ConnectButtonAccent;

    for (const extra of [true, false, 'light', 'dark', undefined, null]) {
      expect(loose(false, extra)).toEqual(enabled);
      expect(loose(true, extra)).toEqual(atLimit);
    }
  });
});
