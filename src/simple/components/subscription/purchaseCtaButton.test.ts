import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveConnectButtonAccent } from './connectButtonAccent';

/**
 * Сторож веса кнопки «Продлить подписку» (задача #62).
 *
 * ⚠️ Файл читается ТЕКСТОМ, а не импортируется: это `.tsx` с алиасом `@/`, а
 * компонентных тестов в проекте не бывает (`environment: 'node'`,
 * docs/architecture/two-modes.md, раздел «Тесты»). Цена приёма — разбор видит
 * только записанное литералом, поэтому у каждой проверки ниже есть парная
 * «разбор удался».
 *
 * Что охраняется и почему.
 *
 * 1. **Кнопка продления видна.** До #62 её подложка стояла на восьми процентах
 *    прозрачности — на тёмном фоне карточки это почти невидимо. Пока кнопка
 *    подключения светилась ореолом, разницу списывали на иерархию; после того
 *    как подключение приглушили, пара обязана читаться осмысленно, и вторая
 *    кнопка не может оставаться призраком.
 * 2. **Иерархия при этом сохраняется.** Подключение — СПЛОШНАЯ заливка,
 *    продление — ПОДЛОЖКА. Усиление подложки не должно догнать подключение по
 *    весу, иначе главное действие страницы перестанет быть главным. Проверка
 *    сравнивает не два числа из головы автора, а живую выдачу обоих модулей.
 * 3. **Ветка «истекла» усилена вместе с обычной.** Разъезжаются они молча:
 *    критическое состояние показывается редко, и его никто не увидит слабее
 *    рабочего до жалобы.
 */

const BUTTON = 'src/simple/components/subscription/PurchaseCTAButton.tsx';

const source = existsSync(BUTTON) ? readFileSync(BUTTON, 'utf8') : '';

/** Кусок файла между двумя маркерами — тело нужной функции. */
function section(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  if (start === -1) return '';
  const end = text.indexOf(to, start + from.length);

  return text.slice(start, end === -1 ? text.length : end);
}

/** Одинарно кавыченные строковые литералы куска кода. */
function stringLiterals(text: string): string[] {
  return [...text.matchAll(/'([^'\n]*)'/g)].map((found) => found[1]);
}

/**
 * Прозрачности значения — последний аргумент каждого `rgba()`.
 *
 * ⚠️ Ищется «число перед закрывающей скобкой», иначе шейд из
 * `rgba(var(--color-accent-400), 0.16)` уехал бы в выдачу как число 400.
 */
function alphaValues(value: string): number[] {
  return [...value.matchAll(/,\s*([01](?:\.\d+)?)\s*\)/g)].map((found) => Number(found[1]));
}

/** Тело акцентного действия — второстепенное с его серыми утилитами не мешаем. */
const primary = section(source, 'function PrimaryAction(', 'function SecondaryAction(');

/** Заливки-подложки обеих веток: обычной и «истекла». */
const fills = stringLiterals(primary).filter((value) => value.startsWith('linear-gradient('));
/** Подложки иконки обеих веток. */
const iconTints = stringLiterals(primary).filter((value) => value.startsWith('rgba('));

/** Живая выдача кнопки подключения — пара для сравнения весов. */
const connect = resolveConnectButtonAccent(false);

describe('разбор удался', () => {
  it('файл прочитан, и разобрано именно акцентное действие', () => {
    // Без этого переименованный файл или функция дали бы пустую строку — и все
    // проверки ниже проходили бы на пустоте, ничего не охраняя.
    expect(source.length).toBeGreaterThan(1000);
    expect(primary.length).toBeGreaterThan(500);
    expect(primary).toContain('HoverBorderGradient');
    expect(primary).not.toContain('function SecondaryAction');
  });

  it('обе ветки найдены — обычная и «истекла»', () => {
    expect(primary).toContain('isCritical');
    expect(fills).toHaveLength(2);
    expect(iconTints).toHaveLength(2);
  });

  it('разбор прозрачностей работает на синтетических значениях', () => {
    // Самопроверка: сломайся он — и пороги ниже проходили бы на чём угодно.
    expect(alphaValues('rgba(var(--color-accent-400), 0.16)')).toEqual([0.16]);
    expect(alphaValues('rgba(255,107,53,0.12)')).toEqual([0.12]);
    expect(alphaValues('linear-gradient(135deg, rgba(1,2,3,0.16), rgba(4,5,6,0.12))')).toEqual([
      0.16, 0.12,
    ]);
    expect(alphaValues('rgb(var(--color-accent-400))')).toEqual([]);
  });
});

describe('кнопка продления стала заметной (#62)', () => {
  it('подложка кнопки плотнее прежних восьми процентов', () => {
    // Мутация «вернуть 0.08/0.06» краснеет здесь.
    for (const fill of fills) {
      const alphas = alphaValues(fill);
      expect(alphas).toHaveLength(2);
      for (const alpha of alphas) {
        expect(`${fill} → ${alpha >= 0.1}`).toBe(`${fill} → true`);
      }
      expect(Math.max(...alphas)).toBeGreaterThanOrEqual(0.14);
    }
  });

  it('подложка иконки плотнее прежних двенадцати процентов', () => {
    for (const tint of iconTints) {
      expect(alphaValues(tint)).toHaveLength(1);
      expect(alphaValues(tint)[0]).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('ветка «истекла» усилена ровно так же, как обычная', () => {
    // ⚠️ Критическое состояние показывается редко: разъедься ветки — и «истекла»
    // осталась бы призраком, а заметил бы это человек с истёкшей подпиской.
    expect(alphaValues(fills[0])).toEqual(alphaValues(fills[1]));
    expect(alphaValues(iconTints[0])).toEqual(alphaValues(iconTints[1]));
  });
});

describe('иерархия сохранена: продление слабее подключения (#62)', () => {
  it('подключение — сплошная заливка, продление — полупрозрачная подложка', () => {
    // ⚠️ Сравнение с ЖИВОЙ выдачей модуля акцента, а не с числом из головы
    // автора: приглушат подключение ещё раз — здесь останется правдой то же
    // самое утверждение, а не устаревшая константа.
    expect(connect.background).toContain('rgb(var(--color-accent-');
    expect(alphaValues(connect.background)).toEqual([]);

    for (const fill of fills) {
      expect(fill).not.toContain('rgb(var(');
      expect(alphaValues(fill).length).toBeGreaterThan(0);
      expect(Math.max(...alphaValues(fill))).toBeLessThan(0.5);
    }
  });

  it('градиентная рамка и цвета текста #62 не трогала', () => {
    // Решение владельца — усилить ПОДЛОЖКУ. Рамка, подписи и цвет акцента
    // остаются как были; четырёхсотый шейд здесь намеренный: он лежит на
    // поверхности, а не на заливке, и `.light` подменяет его тёмным — это
    // единственный способ одной записью получить светло-синий в тёмной теме и
    // тёмно-синий в светлой.
    expect(primary).toContain('rgb(var(--color-critical-500))');
    expect(primary).toContain('rgb(var(--color-accent-400))');
    expect(primary).toContain('<HoverBorderGradient');
    expect(primary).toContain('text-dark-50');
  });
});
