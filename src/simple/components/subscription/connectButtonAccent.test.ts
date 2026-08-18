import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
 * Шейды статусных палитр, которые светлая тема ПОДМЕНЯЕТ.
 *
 * ⚠️ Подменяет через `!important` (`globals.css`, блок `.light`), а тот бьёт
 * инлайн-переменные, которые ставит `applyThemeColors` на `:root`. То есть в
 * светлой теме перебивается НЕ СТИЛЬ, А САМА ПЕРЕМЕННАЯ, и приём «пишем инлайн,
 * значит светлая тема не помешает» здесь не работает вовсе.
 *
 * Список не выдуман: он сверяется с самим `globals.css` тестом ниже. Начнёт
 * апстрим ремапить ещё один шейд — сверка покраснеет, а не промолчит.
 */
const LIGHT_REMAPPED_SHADES = new Set(['300', '400']);

const PALETTE_VAR = /^--color-(?:accent|warning|success|error)-(\d{2,3})$/;

/**
 * Переменная темы, которой кнопке разрешено краситься.
 *
 * ⚠️ Правило закрывает КЛАСС, а не случай. Прежнее `--color-(accent|warning)-\d+`
 * разрешало любой шейд, включая ремапящиеся, — и приглашало наступить снова:
 * подпись «лимит достигнут» стояла на `--color-warning-400` и в светлой теме
 * превращалась в `--color-warning-700`, тёмно-оранжевый на синей заливке с
 * контрастом 1.37 к одному.
 */
function isAllowedVar(name: string): boolean {
  if (name === '--color-on-accent') return true;

  const shade = PALETTE_VAR.exec(name)?.[1];

  return shade !== undefined && !LIGHT_REMAPPED_SHADES.has(shade);
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

const enabled = resolveConnectButtonAccent(false);
const atLimit = resolveConnectButtonAccent(true);
const everyValue: string[] = [...Object.values(enabled), ...Object.values(atLimit)];

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
    expect(rgbSources('rgba(var(--color-accent-500), 0.38)')).toEqual(['var(--color-accent-500']);
    expect(foreignTokens('rgba(255,255,255,0.18)')).toEqual([]);
    expect(foreignTokens('1px solid white')).toEqual(['solid', 'white']);
    expect(foreignTokens('rgb(var(--color-critical-500))')).toEqual(['--color-critical-500']);
    expect(foreignTokens('linear-gradient(135deg, rgb(var(--color-accent-500)))')).toEqual([]);
  });

  it('разрешающее правило переменных работает на синтетических именах', () => {
    // Самопроверка: сломайся `isAllowedVar` — и запрет ремапящихся шейдов
    // молчал бы на любой выдаче.
    expect(isAllowedVar('--color-on-accent')).toBe(true);
    expect(isAllowedVar('--color-accent-500')).toBe(true);
    expect(isAllowedVar('--color-warning-200')).toBe(true);
    expect(isAllowedVar('--color-warning-400')).toBe(false);
    expect(isAllowedVar('--color-accent-300')).toBe(false);
    expect(isAllowedVar('--color-critical-500')).toBe(false);
    expect(themeVars('rgba(var(--color-accent-500), 0.4)')).toEqual(['--color-accent-500']);
  });

  it('список ремапящихся шейдов сверен с самим globals.css', () => {
    // ⚠️ Пара, без которой список выродился бы в поверье. Начнёт светлая тема
    // ремапить ещё один шейд — здесь покраснеет, и запрет ниже расширится
    // вместе с реальностью, а не через полгода по жалобе.
    const css = readFileSync('src/styles/globals.css', 'utf8');
    const lightBlock = /\n\s*\.light\s*\{([\s\S]*?)\n\s*\}/.exec(css)?.[1] ?? '';

    const remapped = new Set(
      [
        ...lightBlock.matchAll(
          /--color-(?:accent|warning|success|error)-(\d{2,3})\s*:[^;]*!important/g,
        ),
      ].map((found) => found[1]),
    );

    expect(lightBlock.length).toBeGreaterThan(200);
    expect(remapped.size).toBeGreaterThan(0);
    expect([...remapped].sort()).toEqual([...LIGHT_REMAPPED_SHADES].sort());
  });
});

describe('цвет следует акцентной палитре оператора, а не литералу (#61)', () => {
  it('hex-литералов в выдаче нет ни одного', () => {
    // Мутация: вернуть `#3B82F6` в заливку — краснеет здесь.
    for (const value of everyValue) {
      expect(hexLiterals(value)).toEqual([]);
    }
  });

  it('каждый rgb()/rgba() берёт цвет из переменной темы', () => {
    // Мутация: `rgba(59,130,246,0.38)` в свечении — краснеет здесь.
    for (const value of everyValue) {
      for (const argument of rgbSources(value)) {
        expect(argument.startsWith('var(--color-')).toBe(true);
      }
    }
  });

  it('посторонних идентификаторов в значениях нет (правило от обратного)', () => {
    // Мутация: `white` вместо `rgb(var(--color-on-accent))` — краснеет здесь,
    // хотя ни hex, ни `rgb(` в такой записи нет вовсе.
    for (const value of everyValue) {
      expect(foreignTokens(value)).toEqual([]);
    }
  });

  it('заливка и свечение идут от --color-accent-500', () => {
    // Спека #61: заливка и свечение — от акцента-500; он в светлой теме не
    // ремапится (`.light` трогает только 300 и 400), так что тон стабилен.
    expect(enabled.background).toContain('var(--color-accent-500)');
    expect(enabled.boxShadow).toContain('var(--color-accent-500)');
    expect(atLimit.background).toContain('var(--color-accent-500)');
  });

  it('текст и иконка идут от --color-on-accent, а не от белого литерала', () => {
    // ⚠️ `src/hooks/useThemeColors.ts:242-243`: захардкоженный белый ломается,
    // как только оператор выбирает светлый акцент. Цвет «поверх акцента»
    // считается там же из выбранной палитры.
    for (const value of [
      enabled.foreground,
      enabled.foregroundMuted,
      enabled.iconBackground,
      enabled.indicatorOn,
      enabled.indicatorOff,
      enabled.indicatorGlow,
      enabled.indicatorTrack,
    ]) {
      expect(value).toContain('var(--color-on-accent');
    }
  });

  it('ни один ремапящийся в светлой теме шейд в акценте не используется', () => {
    // ⚠️ Сердце починки. Подпись «лимит устройств достигнут» стояла на
    // `--color-warning-400`; в светлой теме `.light` подменяет его семисотым
    // через `!important`, и тёмно-оранжевая надпись на синей заливке давала
    // контраст 1.37 — состояние «упёрлись в лимит» переставало отличаться от
    // рабочего ровно там, где отличие и нужно. Инлайн-стиль от этого не спасает:
    // перебивается не стиль, а сама переменная.
    for (const value of everyValue) {
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
  it('в покое — заливка градиентом и свечение', () => {
    // ⚠️ Свечение задано В ПОКОЕ, а не на `:hover`: на телефоне и в Telegram
    // наведения не существует, и кнопку пролистывали.
    expect(enabled.background).toMatch(/^linear-gradient\(/);
    expect(enabled.boxShadow).not.toBe('none');
    expect(enabled.boxShadow.length).toBeGreaterThan(0);
  });

  it('упёрлись в лимит устройств — состояние остаётся отличимым', () => {
    expect(atLimit.boxShadow).toBe('none');
    expect(atLimit.background).not.toBe(enabled.background);
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
