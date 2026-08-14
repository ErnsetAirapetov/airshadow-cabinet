import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сторож выхода из экспертного режима (задачи #41, #48).
 *
 * `AppShell.tsx` и `AppHeader.tsx` — файлы апстрима, которыми мы владеем
 * осознанно (канон: docs/architecture/two-modes.md, «Что остаётся нашим в
 * апстримных файлах»). При синке апстрим правит их регулярно, и наш выход из
 * режима может уехать вместе с разрешением конфликта — молча, с зелёной сборкой.
 *
 * Мест два, и они разные (решение владельца 14.08.2026, #48):
 *   - десктоп (`AppShell.tsx`) — кнопка-иконка в ряду действий шапки;
 *   - мобилка (`AppHeader.tsx`) — отдельная строка в оверлее бургер-меню, как в
 *     ящике простого режима; кнопки-иконки в ряду действий там больше нет.
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются: `vitest.config.ts` задаёт
 * `environment: 'node'`, alias `@/` в тестах не работает, а импорт шапки
 * потянул бы весь граф приложения. Отрисовку проверить нечем — проверяем
 * присутствие ключевых кусков патча.
 *
 * Цена приёма — тест видит только литералы, поэтому обязателен тест
 * «разбор удался»: без него опечатка в пути даст вечно зелёного сторожа,
 * который ничего не охраняет.
 */
const SHELL_DIR = resolve(__dirname, '../components/layout/AppShell');
const SIMPLE_LOCALES_DIR = resolve(__dirname, '../simple/locales');
const SIMPLE_I18N_FILE = resolve(__dirname, '../simple/i18n.ts');

const HEADERS = [
  { name: 'AppShell.tsx (десктопная шапка)', file: 'AppShell.tsx' },
  { name: 'AppHeader.tsx (мобильная шапка)', file: 'AppHeader.tsx' },
] as const;

function read(file: string): string {
  return readFileSync(resolve(SHELL_DIR, file), 'utf8');
}

/**
 * Окно текста вокруг переключения режима.
 *
 * Проверки «в том же обработчике» иначе не выразить: разбирать JSX нечем, а
 * поиск по всему файлу нашёл бы `setMobileMenuOpen(false)` у любой соседней
 * кнопки и был бы зелёным всегда.
 *
 * Передняя граница — фиксированный отступ (ложных срабатываний назад не
 * даёт). Задняя граница — структурная, а не на фиксированное число символов:
 * до закрывающего `</button>` нашего элемента. Это конец JSX-узла кнопки
 * «В простой режим» — обработчик, className и подпись внутри, а соседняя
 * кнопка «Выход» со своим `setMobileMenuOpen(false)` лежит уже за пределами
 * этого узла и в окно не попадает.
 */
function modeSwitchBlock(source: string): string {
  const at = source.indexOf("setMode('simple')");
  expect(at, "в файле нет setMode('simple')").toBeGreaterThan(-1);

  const closeButton = source.indexOf('</button>', at);
  expect(closeButton, "не найден закрывающий </button> после setMode('simple')").toBeGreaterThan(
    -1,
  );

  return source.slice(Math.max(0, at - 600), closeButton + '</button>'.length);
}

describe('выход в простой режим из экспертной шапки', () => {
  it.each(HEADERS)('$name: разбор удался — файл найден и непустой', ({ file }) => {
    expect(read(file).length).toBeGreaterThan(1000);
  });

  it.each(HEADERS)('$name: стор режима берётся из @/store/mode, а не из @/simple', ({ file }) => {
    const source = read(file);
    // Гейт scripts/check-mode-boundaries.mjs запрещает апстримным файлам
    // импортировать src/simple/** — ради этого стор и переехал (#40).
    expect(source).toContain("from '@/store/mode'");
    expect(source).not.toContain('@/simple');
  });

  it.each(HEADERS)('$name: переключает режим на simple', ({ file }) => {
    expect(read(file)).toContain("setMode('simple')");
  });

  it.each(HEADERS)('$name: иконка — PiArrowsInSimple из react-icons/pi', ({ file }) => {
    const source = read(file);
    expect(source).toContain("from 'react-icons/pi'");
    expect(source).toContain('PiArrowsInSimple');
  });

  it.each(HEADERS)('$name: рендерится только при mode === expert', ({ file }) => {
    // #41: выход был бы виден и на страницах простого режима, которые отдаются
    // апстримным Layout (/subscriptions, /balance, /support, /profile, /info) —
    // там setMode('simple') не меняет уже simple-режим. Гейт — явное условие
    // рендера, как в src/simple/components/layout/SimpleHeader.tsx.
    expect(read(file)).toContain("mode === 'expert' && (");
  });

  describe('десктоп: кнопка-иконка в ряду действий', () => {
    // Владелец одобрил её отдельно и явно (#48): на десктопе всё остаётся как
    // есть, подпись живёт в title/aria-label.
    it('AppShell.tsx: подпись «Упрощённый вид» в aria-label и title', () => {
      const source = read('AppShell.tsx');
      expect(source).toContain('aria-label="Упрощённый вид"');
      expect(source).toContain('title="Упрощённый вид"');
    });
  });

  describe('мобилка: строка в бургер-меню', () => {
    it('AppHeader.tsx: кнопки-иконки в ряду действий шапки больше нет', () => {
      // #48 отменяет решение #41: на мобилке переключатель — строка меню в обоих
      // режимах, единообразно. Признак старой кнопки — подпись в атрибутах.
      const source = read('AppHeader.tsx');
      expect(source).not.toContain('aria-label="Упрощённый вид"');
      expect(source).not.toContain('title="Упрощённый вид"');
    });

    it('AppHeader.tsx: строка оформлена как соседние пункты меню', () => {
      expect(modeSwitchBlock(read('AppHeader.tsx'))).toContain('className="nav-item w-full"');
    });

    it('AppHeader.tsx: подпись — ключ из нашего неймспейса, не из апстримных локалей', () => {
      // Апстримному файлу запрещено импортировать SIMPLE_NS из src/simple/i18n
      // (гейт границ), поэтому неймспейс написан литералом. Ключ живёт в
      // src/simple/locales/{ru,en}.json — апстримные ru/en/fa/zh.json не трогаем.
      expect(modeSwitchBlock(read('AppHeader.tsx'))).toContain(
        "t('mode.toSimple', { ns: 'simple' })",
      );
    });

    it('AppHeader.tsx: клик закрывает бургер', () => {
      expect(modeSwitchBlock(read('AppHeader.tsx'))).toContain('setMobileMenuOpen(false)');
    });

    it.each(['ru', 'en'])('%s.json простого режима: ключ mode.toSimple на месте', (lng) => {
      const bundle = JSON.parse(
        readFileSync(resolve(SIMPLE_LOCALES_DIR, `${lng}.json`), 'utf8'),
      ) as { mode?: Record<string, string> };
      expect(bundle.mode?.toSimple, `нет mode.toSimple в ${lng}.json`).toBeTruthy();
    });

    it("src/simple/i18n.ts: неймспейс объявлен строкой 'simple'", () => {
      // AppHeader.tsx пишет ns: 'simple' литералом (импорт SIMPLE_NS из
      // src/simple/ ему запрещает гейт границ). Если константу NS в
      // src/simple/i18n.ts переименуют или изменят значение, литерал в
      // шапке молча разойдётся с реальным неймспейсом, и подпись рендерится
      // как сырой ключ. Проверяем факт объявления, а не импортируем модуль:
      // environment у vitest — 'node', импорт потянул бы i18next и весь граф.
      const source = readFileSync(SIMPLE_I18N_FILE, 'utf8');
      expect(source).toContain("const NS = 'simple'");
    });
  });
});
