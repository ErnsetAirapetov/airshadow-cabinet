import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сторож кнопки возврата в простой режим (задача #41).
 *
 * `AppShell.tsx` и `AppHeader.tsx` — файлы апстрима, которыми мы владеем
 * осознанно (канон: docs/architecture/two-modes.md, «Что остаётся нашим в
 * апстримных файлах»). При синке апстрим правит их регулярно, и наша кнопка
 * может уехать вместе с разрешением конфликта — молча, с зелёной сборкой.
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

const HEADERS = [
  { name: 'AppShell.tsx (десктопная шапка)', file: 'AppShell.tsx' },
  { name: 'AppHeader.tsx (мобильная шапка)', file: 'AppHeader.tsx' },
] as const;

function read(file: string): string {
  return readFileSync(resolve(SHELL_DIR, file), 'utf8');
}

describe('кнопка возврата в простой режим в экспертной шапке', () => {
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

  it.each(HEADERS)('$name: кнопка переключает режим на simple', ({ file }) => {
    expect(read(file)).toContain("setMode('simple')");
  });

  it.each(HEADERS)('$name: иконка — PiArrowsInSimple из react-icons/pi', ({ file }) => {
    const source = read(file);
    expect(source).toContain("from 'react-icons/pi'");
    expect(source).toContain('PiArrowsInSimple');
  });

  it.each(HEADERS)('$name: кнопка рендерится только при mode === expert', ({ file }) => {
    // #41: кнопка безусловно видна и на страницах простого режима, которые
    // отдаются апстримным Layout (/subscriptions, /balance, /support, /profile,
    // /info) — там setMode('simple') не меняет уже simple-режим. Гейт — явное
    // условие рендера, как в src/simple/ModeAffordance.tsx.
    expect(read(file)).toContain("mode === 'expert' && (");
  });

  it.each(HEADERS)('$name: подпись «Упрощённый вид» в aria-label и title', ({ file }) => {
    const source = read(file);
    expect(source).toContain('aria-label="Упрощённый вид"');
    expect(source).toContain('title="Упрощённый вид"');
  });
});
