import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BENTO_COLUMNS,
  LG_COL_SPAN_CLASS,
  resolveMethodCardSpans,
  SM_COL_SPAN_CLASS,
  spanClasses,
} from './paymentMethodsBento';

/**
 * Чистая раскладка бенто для карточек способов оплаты (задача #55).
 *
 * Модуль импортируется, а не читается текстом: он ничего не тянет за собой — ни
 * `@/`-alias, ни react, — поэтому обычный импорт в vitest разрешается. Текстовые
 * сторожа нужны только там, где проверяется РАЗМЕТКА
 * (`paymentMethodsGrid.test.ts`).
 */

const SOURCE_PATH = 'src/simple/components/paymentMethodsBento.ts';

/**
 * Пролёты, разложенные по полкам: полка закрывается, когда сумма пролётов
 * ровно равна числу колонок.
 *
 * ⚠️ Именно здесь ловятся дыры в сетке. Переполненная полка (сумма больше числа
 * колонок) означает, что последняя карточка уехала на следующую строку и хвост
 * предыдущей остался пустым; незакрытая последняя полка — что пустой остался
 * хвост последней строки. Оба случая спека запрещает при ЛЮБОМ числе способов.
 */
function shelves(spans: number[], columns: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;

  for (const span of spans) {
    row.push(span);
    used += span;

    if (used === columns) {
      rows.push(row);
      row = [];
      used = 0;
    } else if (used > columns) {
      throw new Error(`полка переполнена: ${used} > ${columns} на пролётах [${spans.join(', ')}]`);
    }
  }

  if (row.length > 0) {
    throw new Error(`полка не закрыта: занято ${used} из ${columns} на [${spans.join(', ')}]`);
  }

  return rows;
}

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 20];

describe('раскладка бенто: разбор удался (задача #55)', () => {
  it('число колонок делится и на 2, и на 3 — иначе полок из двух и трёх не бывает', () => {
    // Без этого проверки ниже сверяли бы раскладку с сеткой, в которой ровные
    // полки невозможны в принципе.
    expect(BENTO_COLUMNS % 2).toBe(0);
    expect(BENTO_COLUMNS % 3).toBe(0);
  });

  it('на каждое число карточек приходит ровно столько же пролётов', () => {
    // Слабое место любой раскладки: потерянная карточка не получила бы классов и
    // молча заняла бы одну колонку из шести.
    for (const count of COUNTS) {
      expect(resolveMethodCardSpans(count), `count=${count}`).toHaveLength(count);
    }
  });

  it('пустой список и мусорное число не роняют раскладку', () => {
    expect(resolveMethodCardSpans(0)).toEqual([]);
    expect(resolveMethodCardSpans(-3)).toEqual([]);
  });
});

describe('акцентная карточка занимает строку целиком (задача #55)', () => {
  it('первая карточка получает пролёт во все колонки на обоих брейкпоинтах', () => {
    // ⚠️ Спека владельца: «акцентная всегда отдельной строкой во всю ширину».
    // Сверка с `BENTO_COLUMNS`, а не с числом 6: сменить число колонок и не
    // сменить пролёт — значит молча вернуть акцентную карточку в одну колонку.
    for (const count of COUNTS) {
      expect(resolveMethodCardSpans(count)[0], `count=${count}`).toEqual({
        sm: BENTO_COLUMNS,
        lg: BENTO_COLUMNS,
      });
    }
  });
});

describe('таблица пролётов из спеки владельца (задача #55)', () => {
  /**
   * `r` — сколько мелких карточек осталось после акцентной. Пролёты выписаны
   * ровно как в таблице задачи #55, включая порядок полок.
   */
  const TABLE: Array<{ r: number; sm: number[]; lg: number[] }> = [
    { r: 0, sm: [], lg: [] },
    { r: 1, sm: [6], lg: [6] },
    { r: 2, sm: [3, 3], lg: [3, 3] },
    { r: 3, sm: [3, 3, 6], lg: [2, 2, 2] },
    { r: 4, sm: [3, 3, 3, 3], lg: [3, 3, 3, 3] },
    { r: 5, sm: [3, 3, 3, 3, 6], lg: [2, 2, 2, 3, 3] },
  ];

  it('таблица разобрана целиком — иначе проверка ниже сверяла бы пустоту', () => {
    expect(TABLE).toHaveLength(6);
    for (const { r, sm, lg } of TABLE) {
      expect(sm).toHaveLength(r);
      expect(lg).toHaveLength(r);
    }
  });

  it.each(TABLE)('r=$r раскладывается по спеке', ({ r, sm, lg }) => {
    const spans = resolveMethodCardSpans(r + 1).slice(1);

    expect(spans.map((span) => span.sm)).toEqual(sm);
    expect(spans.map((span) => span.lg)).toEqual(lg);
  });
});

describe('дыр в сетке не бывает ни при каком числе способов (задача #55)', () => {
  it('на каждом брейкпоинте полки закрываются ровно', () => {
    // ⚠️ Главное требование спеки: «пустых клеток не бывает ни при каком числе
    // карточек». `shelves` бросает исключение и на переполненной полке, и на
    // незакрытой последней.
    for (const count of COUNTS) {
      const spans = resolveMethodCardSpans(count);

      for (const breakpoint of ['sm', 'lg'] as const) {
        const rows = shelves(
          spans.map((span) => span[breakpoint]),
          BENTO_COLUMNS,
        );

        expect(rows.length, `count=${count}, ${breakpoint}`).toBeGreaterThan(0);
        for (const row of rows) {
          expect(
            row.reduce((sum, span) => sum + span, 0),
            `count=${count}, ${breakpoint}, полка [${row.join(', ')}]`,
          ).toBe(BENTO_COLUMNS);
        }
      }
    }
  });

  it('на sm в полке не больше двух карточек, на lg — не больше трёх', () => {
    // ⚠️ Спека: три карточки на 640-пиксельном экране дали бы по 200 пикселей —
    // туда не влезает ни название способа, ни диапазон сумм. Акцентная строка
    // из проверки исключена: она одна и во всю ширину.
    const LIMITS = { sm: 2, lg: 3 } as const;

    for (const count of COUNTS) {
      const spans = resolveMethodCardSpans(count).slice(1);
      if (spans.length === 0) continue;

      for (const breakpoint of ['sm', 'lg'] as const) {
        const rows = shelves(
          spans.map((span) => span[breakpoint]),
          BENTO_COLUMNS,
        );

        for (const row of rows) {
          expect(
            row.length,
            `count=${count}, ${breakpoint}, полка [${row.join(', ')}]`,
          ).toBeLessThanOrEqual(LIMITS[breakpoint]);
        }
      }
    }
  });
});

describe('классы пролётов — литералами, иначе Tailwind их не соберёт (задача #55)', () => {
  it('карты классов покрывают все возможные пролёты', () => {
    // Пролёт без записи в карте дал бы `undefined` в className — карточка молча
    // осталась бы в одной колонке.
    for (let span = 1; span <= BENTO_COLUMNS; span += 1) {
      expect(SM_COL_SPAN_CLASS[span], `sm, пролёт ${span}`).toBe(`sm:col-span-${span}`);
      expect(LG_COL_SPAN_CLASS[span], `lg, пролёт ${span}`).toBe(`lg:col-span-${span}`);
    }
  });

  it('каждый пролёт раскладки находит свой класс', () => {
    // ⚠️ Связка между числами и классами: раскладка может выдать пролёт, которого
    // в карте нет, и сборка при этом останется зелёной.
    for (const count of COUNTS) {
      for (const span of resolveMethodCardSpans(count)) {
        expect(spanClasses(span), `count=${count}`).toBe(
          `${SM_COL_SPAN_CLASS[span.sm]} ${LG_COL_SPAN_CLASS[span.lg]}`,
        );
      }
    }
  });

  it('акцентная карточка получает класс на всю ширину строки', () => {
    expect(spanClasses(resolveMethodCardSpans(4)[0])).toBe(
      `sm:col-span-${BENTO_COLUMNS} lg:col-span-${BENTO_COLUMNS}`,
    );
  });

  it('в коде модуля классы записаны литералами, а не собраны шаблонной строкой', () => {
    // ⚠️ Сторож ТЕКСТОВЫЙ, и без него не обойтись: шаблонная строка
    // `col-span-${span}` даёт в рантайме тот же текст, поэтому все проверки выше
    // остаются зелёными — а Tailwind сканирует исходники и такого класса не
    // видит, то есть правила в собранном CSS нет. Поймано мутацией 17.08.2026.
    //
    // ⚠️ Требуется КАЖДАЯ запись обеих карт, а не только запись на всю ширину
    // строки. Запрет шаблонной строки закрывает лишь одну форму подмены; склейка
    // (`3: 'sm:col-span-' + 3`) шаблоном не является, в рантайме даёт тот же текст
    // и точно так же теряется для Tailwind — а стоит это полок из двух карточек на
    // планшете: без правила `sm:col-span-3` они схлопнутся в одну колонку.
    // Замечено на ревью MR !35.
    //
    // Комментарии вырезаны: тот же шаблон нарочно упомянут в докстринге модуля.
    const code = readFileSync(SOURCE_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    // Разбор удался: вырезаны комментарии, но не код.
    expect(code).toContain("6: 'sm:col-span-6'");
    expect(code).not.toContain('Бенто-раскладка карточек способов оплаты');

    for (let span = 1; span <= BENTO_COLUMNS; span += 1) {
      expect(code, `запись sm на пролёт ${span}`).toContain(`${span}: 'sm:col-span-${span}'`);
      expect(code, `запись lg на пролёт ${span}`).toContain(`${span}: 'lg:col-span-${span}'`);
    }

    expect(code).not.toMatch(/col-span-\$\{/);
  });
});
