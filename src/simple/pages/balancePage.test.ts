import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа самой страницы баланса простого режима (задача #30).
 *
 * ⚠️ Файл читается ТЕКСТОМ, а не импортируется. Компонентных тестов в проекте не
 * бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * страницы потянул бы весь граф приложения и упал бы на разрешении модулей. Тот
 * же приём, что в `src/simple/components/headerActions.test.ts`; цена та же —
 * разбор видит только то, что записано литералом, поэтому у каждого сторожа ниже
 * есть парная проверка «разбор удался».
 *
 * Зачем эти сторожа поверх `balanceState.test.ts`: тот проверяет чистые функции,
 * но не то, что страница их ЗОВЁТ. Без сторожей ниже можно было удалить со
 * страницы весь перехват возврата от платёжного шлюза (или вызов `refreshUser`)
 * — и `npm test` остался бы зелёным.
 */

const PAGE = 'src/simple/pages/Balance.tsx';

const page = existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : '';

/**
 * Тела вызовов `useEffect(...)` — от слова `useEffect` до парной закрывающей
 * скобки. Балансировка скобок, а не регулярка: у эффекта перехвата внутри свои
 * вызовы со скобками, и `.*?\)` оборвал бы тело на первом же из них.
 */
function useEffectCalls(source: string): string[] {
  const marker = 'useEffect(';
  const calls: string[] = [];
  let from = 0;

  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) break;

    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    calls.push(source.slice(start, i + 1));
    from = i + 1;
  }

  return calls;
}

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('акцентная карточка способа пополнения (задача #30)', () => {
  // Ветка `isAccented ? '...'` — единственное место, где живут классы акцента.
  const accent = /isAccented\s*\?\s*'([^']*)'/.exec(page)?.[1] ?? '';

  it('разбор ветки акцента удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(page.length).toBeGreaterThan(3000);
    expect(page).toContain('export function SimpleBalance');
    expect(accent.length).toBeGreaterThan(40);
    expect(accent).toContain('sm:col-span-2');
  });

  it('состав акцента из спеки владельца на месте', () => {
    // Акцентная рамка, градиентная подсветка, свечение и ширина строки сетки на
    // `sm` и выше. Границы задачи: состав акцента переделывать нельзя.
    expect(accent).toMatch(/(^|\s)border-accent-500\/40(\s|$)/);
    expect(accent).toMatch(/(^|\s)shadow-glow(\s|$)/);
    expect(accent).toContain('from-accent-500/10');
    expect(accent).toContain('lg:col-span-3');
  });

  it('под курсором акцентная карточка остаётся акцентной', () => {
    // ⚠️ `.bento-card-hover:hover` из `src/styles/globals.css` — специфичность
    // 0,2,0 — перебивает утилиты акцента (0,1,0) и на hover возвращает серую
    // рамку с собственным box-shadow. Hover-варианты тоже 0,2,0, но лежат в
    // `@layer utilities` — ниже по источнику, поэтому выигрывают.
    // Сторож текстовый: он держит классы, а не каскад. Каскад проверяется
    // собранным CSS (см. описание MR).
    expect(accent).toContain('hover:border-accent-500/60');
    expect(accent).toContain('hover:shadow-glow');
  });
});

describe('страница зовёт свои же чистые функции (задача #30)', () => {
  const effects = useEffectCalls(page);

  it('разбор эффектов удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(effects.length).toBeGreaterThanOrEqual(2);
    for (const effect of effects) {
      expect(effect).toContain('=> {');
      expect(effect.endsWith(')')).toBe(true);
    }
  });

  it('перехват возврата от платёжного шлюза стоит внутри эффекта', () => {
    // Без него человек, вернувшийся от провайдера, видит баланс и не понимает,
    // прошла оплата или нет.
    expect(page).toContain('resolvePaymentReturnRedirect,');
    expect(page).toContain("} from './balanceState'");

    const intercepting = effects.filter(
      (effect) =>
        effect.includes('resolvePaymentReturnRedirect(searchParams)') &&
        effect.includes('navigate(') &&
        effect.includes('replace: true'),
    );

    expect(intercepting).toHaveLength(1);
    expect(intercepting[0]).toContain('[searchParams, navigate]');
  });

  it('перехват не продублирован в мёртвом коде вне эффектов', () => {
    // Все вызовы разрешителя в файле должны быть внутри тел эффектов: иначе
    // проверка выше остаётся зелёной, пока рабочий вызов уехал в недостижимую
    // ветку, а в эффекте лежит его копия.
    const inEffects = effects.reduce(
      (sum, effect) => sum + countOf(effect, 'resolvePaymentReturnRedirect('),
      0,
    );

    expect(countOf(page, 'resolvePaymentReturnRedirect(')).toBe(inEffects);
  });

  it('пользователь обновляется на маунте — баланс в сторе совпадает с экраном', () => {
    const refreshing = effects.filter(
      (effect) => effect.includes('refreshUser()') && effect.includes('[refreshUser]'),
    );

    expect(refreshing).toHaveLength(1);
  });
});
