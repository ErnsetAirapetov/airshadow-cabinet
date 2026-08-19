import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа копий, без которых простая страница поддержки не собирается (#63).
 *
 * Гейт границ (`scripts/check-mode-boundaries.mjs`) закрывает простому режиму
 * три импорта апстримной страницы поддержки, и все три уехали копиями в наш
 * слой — гейт при этом НЕ расширялся:
 *
 *   - `@/components/data-display/Card` → `components/data-display/Card.tsx`;
 *   - `staggerContainer`/`staggerItem` из `@/components/motion/transitions`
 *     → `components/motion/transitions.ts`;
 *   - `MessageMediaGrid` из `../components/tickets/MessageMediaGrid`
 *     → `components/tickets/MessageMediaGrid.tsx`.
 *
 * Копия без сторожа расходится молча в обе стороны: апстрим правит оригинал
 * (он это делает каждый синк) — и простой режим тихо остаётся вчерашним; либо
 * копию «немного улучшают» — и экран перестаёт быть тем, что владелец принял.
 * Ни сборка, ни типы про это не скажут.
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются. Компонентных тестов в проекте
 * не бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не резолвится — импорт
 * копии потянул бы весь граф приложения и упал бы на разрешении модулей. Тот же
 * приём, что в `src/simple/pages/purchaseCopies.test.ts`; цена та же — разбор
 * видит только записанное литералом, поэтому у каждой проверки ниже есть парная
 * «разбор удался».
 */

const MEDIA_COPY = 'src/simple/components/tickets/MessageMediaGrid.tsx';
const MEDIA_UPSTREAM = 'src/components/tickets/MessageMediaGrid.tsx';

const TRANSITIONS_COPY = 'src/simple/components/motion/transitions.ts';
const TRANSITIONS_UPSTREAM = 'src/components/motion/transitions.ts';

const CARD_COPY = 'src/simple/components/data-display/Card.tsx';
const CARD_UPSTREAM = 'src/components/data-display/Card/Card.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны — разбор смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Приводит файл к виду, в котором копия и оригинал обязаны совпасть.
 *
 * Нормализации те же, что в `purchaseCopies.test.ts`, и каждая закрывает свою
 * законную разницу: путь импорта сводится к имени модуля (копия ходит через
 * alias `@/`, оригинал — относительными путями, модуль один и тот же);
 * комментарии вырезаны (копия несёт свой заголовок «это копия, задача #63»);
 * пробелы схлопнуты, иначе сторож ловил бы переносы строк вместо кода.
 */
function normalize(source: string): string {
  return stripComments(source)
    .replace(/from '[^']*\/([^'/]+)'/g, "from '<$1>'")
    .replace(/\{\s*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Тело `export const <name>: Variants = { … };` целиком, нормализованное.
 *
 * Балансировка фигурных скобок, а не регулярка: у `staggerContainer` внутри
 * вложенный объект `transition`, и `.*?\}` оборвал бы тело на первой же
 * внутренней скобке — сравнение вышло бы половинчатым и молча зелёным.
 */
function variantsBlock(source: string, name: string): string {
  const marker = `export const ${name}: Variants = {`;
  const start = source.indexOf(marker);
  if (start === -1) return '';

  let depth = 0;
  for (let i = start + marker.length - 1; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return normalize(source.slice(start, i + 1));
    }
  }

  return '';
}

/** Строковые литералы первого аргумента `cva(` — базовые классы карточки. */
function cvaBaseClasses(source: string): string[] {
  const start = source.indexOf('cva(');
  if (start === -1) return [];
  const close = source.indexOf('],', start);
  if (close === -1) return [];

  return [...source.slice(start, close).matchAll(/'([^']+)'/g)].map((found) => found[1]);
}

describe('разбор копий поддержки удался (задача #63)', () => {
  it('нормализация схлопывает законные различия и НЕ схлопывает код', () => {
    // Пара «разбор удался» для самой нормализации: без неё сравнения ниже могли
    // бы проходить на пустых строках или на схлопнутом в ничто тексте.
    expect(normalize("import { X } from '../../api/tickets';")).toBe(
      normalize("import { X } from '@/api/tickets';"),
    );
    expect(normalize('/* заголовок копии */ const a = 1;')).toBe('const a = 1;');
    expect(normalize('const a = 1;')).not.toBe(normalize('const a = 2;'));
    expect(normalize('')).toBe('');
  });

  it('все шесть файлов на месте и непусты', () => {
    // Без этого удалённый или переименованный файл дал бы пустую строку, и
    // сравнения ниже сверяли бы пустоту с пустотой.
    for (const path of [
      MEDIA_COPY,
      MEDIA_UPSTREAM,
      TRANSITIONS_COPY,
      TRANSITIONS_UPSTREAM,
      CARD_COPY,
      CARD_UPSTREAM,
    ]) {
      expect(normalize(read(path)).length, path).toBeGreaterThan(200);
    }
  });
});

describe('MessageMediaGrid — точная копия апстрима (задача #63)', () => {
  it('копия совпадает с оригиналом байт в байт после нормализации', () => {
    // ⚠️ Полное сравнение, а не выборка строк. Спека владельца — «перенести как
    // есть»: галерея вложений в тикете упрощению в этой задаче не подлежит.
    expect(normalize(read(MEDIA_COPY))).toBe(normalize(read(MEDIA_UPSTREAM)));
  });

  it('копия ходит за медиа в общий api, а не за границу в апстримные компоненты', () => {
    const copy = stripComments(read(MEDIA_COPY));

    expect(copy).toContain("from '@/api/tickets'");
    expect(copy).not.toContain("from '@/components/tickets");
  });
});

describe('transitions — выдержка ровно из двух переменных (задача #63)', () => {
  const copy = read(TRANSITIONS_COPY);
  const upstream = read(TRANSITIONS_UPSTREAM);

  it('оба тела найдены в апстриме — иначе сравнения ниже пустые', () => {
    // Пара «разбор удался»: переименуй апстрим переменную или смени тип с
    // `Variants` — и балансировщик вернул бы пустую строку, а сторож сравнивал
    // бы пустоту с пустотой, оставаясь зелёным при живом расхождении.
    expect(variantsBlock(upstream, 'staggerContainer')).toContain('staggerChildren');
    expect(variantsBlock(upstream, 'staggerItem')).toContain('opacity');
  });

  it('staggerContainer совпадает с апстримным', () => {
    expect(variantsBlock(copy, 'staggerContainer')).toBe(
      variantsBlock(upstream, 'staggerContainer'),
    );
  });

  it('staggerItem совпадает с апстримным', () => {
    expect(variantsBlock(copy, 'staggerItem')).toBe(variantsBlock(upstream, 'staggerItem'));
  });

  it('скопированы ТОЛЬКО две переменные, а не файл целиком', () => {
    // Канон, «Заимствование логики»: копируем минимум — не файл, а ровно то,
    // что нужно. Апстримный файл несёт 142 строки и два десятка переменных;
    // приехавшая следом третья означала бы, что копия тихо растёт в дубль.
    const exported = [...copy.matchAll(/^export const (\w+)/gm)].map((found) => found[1]);

    expect(exported).toEqual(['staggerContainer', 'staggerItem']);
  });
});

describe('Card — минимальная копия апстримной карточки (задача #63)', () => {
  const copy = read(CARD_COPY);
  const upstream = read(CARD_UPSTREAM);
  const baseClasses = cvaBaseClasses(upstream);

  it('базовые классы апстримной карточки разобраны — иначе сверка пустая', () => {
    // Пара «разбор удался»: сломайся выделение первого аргумента `cva(`, и
    // цикл ниже не проверил бы ни одного класса, оставаясь зелёным.
    expect(baseClasses.length).toBeGreaterThanOrEqual(5);
    expect(baseClasses).toContain('relative overflow-hidden');
    expect(upstream).toContain("lg: 'p-5 sm:p-6'");
  });

  it('каждый базовый класс апстрима есть в копии', () => {
    // Вид карточки — это её классы. Перекрась апстрим рамку или радиус, и
    // простая поддержка молча осталась бы вчерашней; здесь это красное.
    const missing = baseClasses.filter((cls) => !copy.includes(cls));

    expect(missing).toEqual([]);
  });

  it('копия рисует карточку в размере lg — как апстримный дефолт', () => {
    // Апстримный `defaultVariants` задаёт `size: 'lg'`, и страница поддержки
    // размер нигде не переопределяет. Разъедься паддинг — разъедется вся сетка.
    expect(upstream).toContain("size: 'lg'");
    expect(copy).toContain("'p-5 sm:p-6'");
  });

  it('копия не тянет transitions — интерактивная ветка не копировалась', () => {
    // ⚠️ Осознанное решение, а не потеря. Апстримная карточка анимирует
    // hover/tap через `buttonHover`/`buttonTap`/`springTransition`, то есть
    // тянет из `transitions.ts` ещё три переменные сверх двух, разрешённых
    // задачей. Простая поддержка интерактивных карточек не рисует вовсе, а
    // пропа `interactive` в копии нет — попытка его передать станет ошибкой
    // типов (громко), а не молча неанимированной карточкой (тихо).
    //
    // ⚠️ Запреты идут по тексту БЕЗ КОММЕНТАРИЕВ: докстринг копии сам объясняет,
    // чего в ней нет, и на сыром тексте эти проверки падали бы по собственной
    // прозе — то есть на всё том же месте, но по ложной причине.
    const code = stripComments(copy);

    expect(upstream).toContain('whileHover={buttonHover}');
    expect(code).not.toContain('buttonHover');
    expect(code).not.toContain('interactive');
  });
});
