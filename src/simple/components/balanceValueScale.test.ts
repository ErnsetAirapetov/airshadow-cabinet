import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BALANCE_VALUE_BREAKPOINTS,
  balanceValueWidthPx,
  resolveBalanceValueClass,
  resolveBalanceValueSteps,
} from './balanceValueScale';

/**
 * Кегль цифры баланса на акцентной карточке главной (#72).
 *
 * Требование владельца из спеки — два, и они тянут в разные стороны: «кегль на
 * мобилке поднять до десктопного (`text-5xl`)» и «значение — одна строка, не
 * переносится и НЕ РЕЖЕТСЯ; проверить на семизначной сумме при ширине 360px».
 * Карточка — `.bento-card` с `overflow: hidden`, так что вылезшая цифра именно
 * режется, молча и только на длинных суммах: на стенде с трёхзначным балансом
 * дефекта не видно вовсе.
 *
 * ⚠️ Сторож считает бюджет ПО КАЖДОМУ брейкпоинту, а не один на всех. Первая
 * версия правила знала только про мобильную колонку — и пропускала восьмизначную
 * сумму в 48-м кегле в двухколоночную сетку `sm:`, где места на 29px меньше.
 * Ошибка держалась на неверном сравнении в комментарии (ширина содержимого
 * карточки против бюджета одной только цифры), а проверка «влезает» сверялась с
 * тем же единственным бюджетом и покраснеть не могла в принципе.
 *
 * Модуль импортируется НАПРЯМУЮ: он чистый и ни от чего не зависит, alias `@/`
 * ему не нужен (docs/architecture/two-modes.md, раздел «Тесты»). Сам виджет
 * компонентным тестом не достать — он тянет `@/api` и `@/hooks`.
 */

const source = readFileSync('src/simple/components/balanceValueScale.ts', 'utf8');

describe('разбор удался', () => {
  it('брейкпоинтов больше одного, и у каждого свой бюджет', () => {
    // ⚠️ Пара против возврата к единственному бюджету: именно так и выглядел
    // дефект — правило знало только мобильную колонку.
    expect(BALANCE_VALUE_BREAKPOINTS.length).toBeGreaterThan(1);
    for (const breakpoint of BALANCE_VALUE_BREAKPOINTS) {
      expect(`${breakpoint.name}: ${breakpoint.budgetPx > 100}`).toBe(`${breakpoint.name}: true`);
    }
  });

  it('ступени внутри каждого брейкпоинта идут от крупной к мелкой', () => {
    for (const breakpoint of BALANCE_VALUE_BREAKPOINTS) {
      for (let i = 1; i < breakpoint.steps.length; i += 1) {
        expect(breakpoint.steps[i].fontPx).toBeLessThan(breakpoint.steps[i - 1].fontPx);
      }
      expect(breakpoint.steps[0].fontPx).toBe(48);
    }
  });

  it('лестница кеглей у всех брейкпоинтов одна и та же', () => {
    // Разъедься она — «на sm ступень ниже» означало бы разные вещи в разных
    // местах, и сравнивать выбранные ступени стало бы нечем.
    const ladder = BALANCE_VALUE_BREAKPOINTS[0].steps.map((step) => step.fontPx);
    for (const breakpoint of BALANCE_VALUE_BREAKPOINTS) {
      expect(breakpoint.steps.map((step) => step.fontPx)).toEqual(ladder);
    }
  });

  it('классы записаны литералами — иначе Tailwind их не соберёт', () => {
    // ⚠️ Tailwind сканирует ИСХОДНИКИ ТЕКСТОМ: класс, собранный шаблоном вроде
    // `${prefix}text-5xl`, в CSS не попадёт вовсе, и кегль молча останется
    // дефолтным. Поэтому каждый класс обязан встречаться в файле как есть.
    for (const breakpoint of BALANCE_VALUE_BREAKPOINTS) {
      for (const step of breakpoint.steps) {
        expect(`${step.className}: ${source.includes(`'${step.className}'`)}`).toBe(
          `${step.className}: true`,
        );
      }
    }
  });

  it('префикс класса соответствует брейкпоинту', () => {
    for (const breakpoint of BALANCE_VALUE_BREAKPOINTS) {
      for (const step of breakpoint.steps) {
        const prefix = breakpoint.name === 'base' ? '' : `${breakpoint.name}:`;
        expect(step.className.startsWith(prefix)).toBe(true);
        if (breakpoint.name === 'base') expect(step.className).not.toContain(':');
      }
    }
  });

  it('оценка ширины растёт и от длины строки, и от кегля', () => {
    // Самопроверка: сломайся расчёт — и «влезает» проходило бы на чём угодно,
    // включая семизначную сумму в самом крупном кегле.
    expect(balanceValueWidthPx('1234.00', 48)).toBeGreaterThan(balanceValueWidthPx('12.00', 48));
    expect(balanceValueWidthPx('1234.00', 48)).toBeGreaterThan(balanceValueWidthPx('1234.00', 30));
    expect(balanceValueWidthPx('', 48)).toBe(0);
  });
});

describe('двухколоночная сетка sm: учтена (дефект первой версии правила)', () => {
  it('на sm колонка ýже мобильной, и бюджет это отражает', () => {
    // ⚠️ Сердце починки. На границе брейкпоинта (640px) колонка сетки
    // `sm:grid-cols-2` даёт содержимому 259px против 328px полной строки
    // мобилки — то есть места МЕНЬШЕ, а не больше. Мутация «один бюджет по
    // 360px на все брейкпоинты» краснеет здесь.
    const base = BALANCE_VALUE_BREAKPOINTS.find((point) => point.name === 'base');
    const sm = BALANCE_VALUE_BREAKPOINTS.find((point) => point.name === 'sm');

    expect(base).toBeDefined();
    expect(sm).toBeDefined();
    expect(sm!.budgetPx).toBeLessThan(base!.budgetPx);
  });

  it('восьмизначная сумма на sm опускается со ступени, а на мобилке — нет', () => {
    // `12345.00` — баланс от десяти тысяч, сумма совершенно рядовая. В 48-м
    // кегле это 249.6px: в мобильную строку (264.4) влезает, в колонку sm
    // (235.4) — нет.
    const steps = resolveBalanceValueSteps('12345.00');
    const base = steps.find((step) => step.name === 'base');
    const sm = steps.find((step) => step.name === 'sm');

    expect(base?.className).toBe('text-5xl');
    expect(sm?.className).not.toBe('sm:text-5xl');
  });
});

describe('обычная сумма получает крупный кегль (#72)', () => {
  it('ноль, сотни и четырёхзначная сумма — text-5xl на всех брейкпоинтах', () => {
    // Ровно то, ради чего кегль поднимали: на мобилке баланс — самый громкий
    // элемент экрана. Одинаковую ступень правило схлопывает в один класс.
    for (const formatted of ['0.00', '500.00', '1234.00', '9999.99']) {
      expect(`${formatted}: ${resolveBalanceValueClass(formatted)}`).toBe(`${formatted}: text-5xl`);
    }
  });
});

describe('длинная сумма не режется ни в одной колонке (#72)', () => {
  it('семизначная сумма опускается со ступени уже на мобилке', () => {
    // Мутация «всегда text-5xl» краснеет здесь: `1234567.00` в 48px не влезает
    // в колонку 360-пиксельного экрана и обрезается `overflow: hidden`.
    expect(resolveBalanceValueSteps('1234567.00')[0].className).not.toBe('text-5xl');
  });

  it('выбранная ступень влезает в бюджет СВОЕГО брейкпоинта для любой длины', () => {
    // Правило от обратного: проверяется не «семизначная сумма особенная», а
    // «ни одна длина не выходит ни за одну колонку».
    for (let length = 1; length <= 16; length += 1) {
      const formatted = '9'.repeat(length);
      for (const step of resolveBalanceValueSteps(formatted)) {
        const breakpoint = BALANCE_VALUE_BREAKPOINTS.find((point) => point.name === step.name);

        expect(breakpoint).toBeDefined();
        expect(
          `${length}/${step.name}: ${balanceValueWidthPx(formatted, step.fontPx) <= breakpoint!.budgetPx}`,
        ).toBe(`${length}/${step.name}: true`);
      }
    }
  });

  it('в выдаче по одному классу на брейкпоинт, и повторы схлопнуты', () => {
    // Класс `sm:text-5xl` рядом с `text-5xl` ничего не меняет и только шумит;
    // а вот пропущенный класс поменял бы кегль молча.
    const classes = resolveBalanceValueClass('12345.00').split(' ');

    expect(classes.length).toBeGreaterThan(1);
    expect(classes.length).toBeLessThanOrEqual(BALANCE_VALUE_BREAKPOINTS.length);
    expect(new Set(classes).size).toBe(classes.length);
    expect(classes[0]).toBe('text-5xl');
  });

  it('длина, которую не спасает и самая мелкая ступень, получает её же', () => {
    // Функция обязана вернуть класс всегда: пустая строка в `className` — это
    // кегль по умолчанию, то есть худший из возможных.
    const last = BALANCE_VALUE_BREAKPOINTS[0].steps[BALANCE_VALUE_BREAKPOINTS[0].steps.length - 1];

    expect(resolveBalanceValueSteps('9'.repeat(200))[0].className).toBe(last.className);
  });
});
