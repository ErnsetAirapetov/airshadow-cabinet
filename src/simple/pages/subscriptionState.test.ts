import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_DAY_MS,
  isCountdownUrgent,
  resolveCountdownDisplay,
  resolveCountdownTickMs,
  resolveSubscriptionInfoRowLayout,
} from './subscriptionState';

/**
 * Чистая логика простой страницы подписки (задача #59).
 *
 * Модуль импортируется НАПРЯМУЮ, а не читается текстом: он чистый и тянет из
 * `@/types` только типы, так что alias `@/` ему не нужен
 * (docs/architecture/two-modes.md, раздел «Тесты»). Текстом сторожится сама
 * страница — в `subscriptionPage.test.ts`.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;
const SECOND = 1_000;

describe('resolveCountdownDisplay: единицы остатка (граница — НЕ МЕНЬШЕ суток)', () => {
  it('неактивная подписка — «истекла» при любом остатке', () => {
    // Ветку «истекла» спека велела оставить как была: её решает состояние
    // подписки, а не остаток времени.
    expect(
      resolveCountdownDisplay({ remainingMs: 30 * COUNTDOWN_DAY_MS, isActive: false }),
    ).toEqual({ kind: 'expired' });
    expect(resolveCountdownDisplay({ remainingMs: 0, isActive: false })).toEqual({
      kind: 'expired',
    });
  });

  it('остаток ровно сутки — уже дни, а не 24 часа', () => {
    // Граница правила «остаток НЕ МЕНЬШЕ суток — только дни». Мутация
    // `>` вместо `>=` красит именно этот тест.
    expect(resolveCountdownDisplay({ remainingMs: COUNTDOWN_DAY_MS, isActive: true })).toEqual({
      kind: 'days',
      days: 1,
    });
  });

  it('остаток заметно больше суток — только дни, часов в выдаче нет', () => {
    const display = resolveCountdownDisplay({
      remainingMs: 12 * COUNTDOWN_DAY_MS + 5 * HOUR + 30 * MINUTE,
      isActive: true,
    });

    expect(display).toEqual({ kind: 'days', days: 12 });
    // Структурная проверка: в объекте нет полей часов/минут/секунд, поэтому
    // разметка физически не может их напечатать.
    expect(Object.keys(display).sort()).toEqual(['days', 'kind']);
  });

  it('меньше суток — часы, минуты и секунды', () => {
    expect(
      resolveCountdownDisplay({
        remainingMs: 23 * HOUR + 59 * MINUTE + 59 * SECOND,
        isActive: true,
      }),
    ).toEqual({ kind: 'clock', hours: 23, minutes: 59, seconds: 59 });

    expect(
      resolveCountdownDisplay({ remainingMs: 5 * MINUTE + 7 * SECOND, isActive: true }),
    ).toEqual({ kind: 'clock', hours: 0, minutes: 5, seconds: 7 });
  });

  it('нулевой и отрицательный остаток активной подписки — нули, а не мусор', () => {
    // Активная подписка с истёкшим `end_date` — реальное состояние: бэкенд
    // гасит подписку не в ту же секунду. Без зажима получились бы
    // отрицательные числа в вёрстке.
    expect(resolveCountdownDisplay({ remainingMs: 0, isActive: true })).toEqual({
      kind: 'clock',
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
    expect(resolveCountdownDisplay({ remainingMs: -5 * HOUR, isActive: true })).toEqual({
      kind: 'clock',
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });
});

describe('resolveCountdownTickMs: посекундный тик только на последних сутках', () => {
  it('истёкшей подписке интервал не нужен вовсе', () => {
    expect(resolveCountdownTickMs({ remainingMs: 5 * HOUR, isActive: false })).toBeNull();
  });

  it('меньше суток — раз в секунду', () => {
    expect(resolveCountdownTickMs({ remainingMs: COUNTDOWN_DAY_MS - 1, isActive: true })).toBe(
      1000,
    );
    expect(resolveCountdownTickMs({ remainingMs: 0, isActive: true })).toBe(1000);
  });

  it('сутки и больше — секундного тика нет', () => {
    // ⚠️ Сердце пункта «посекундный тик при показе дней бессмысленен».
    // Проверяется не «интервал другой», а именно «не 1000»: страница
    // перерисовывалась раз в секунду круглосуточно.
    for (const remainingMs of [COUNTDOWN_DAY_MS, 3 * COUNTDOWN_DAY_MS, 400 * COUNTDOWN_DAY_MS]) {
      const tick = resolveCountdownTickMs({ remainingMs, isActive: true });

      expect(tick).not.toBe(1000);
      expect(tick).toBeGreaterThanOrEqual(60_000);
    }
  });
});

describe('isCountdownUrgent: граница тревоги', () => {
  it('прежнее правило `days <= 3` сохранено', () => {
    expect(isCountdownUrgent(4 * COUNTDOWN_DAY_MS - 1)).toBe(true);
    expect(isCountdownUrgent(4 * COUNTDOWN_DAY_MS)).toBe(false);
    expect(isCountdownUrgent(0)).toBe(true);
  });
});

/** Все `grid-cols-N`, объявленные в наборе классов, с префиксом брейкпоинта. */
function gridColumns(row: string): { breakpoint: string; columns: number }[] {
  return [...row.matchAll(/(?:^|\s)(?:([a-z]+):)?grid-cols-(\d+)(?=\s|$)/g)].map((found) => ({
    breakpoint: found[1] ?? 'base',
    columns: Number(found[2]),
  }));
}

describe('resolveSubscriptionInfoRowLayout: ряд «счётчик и автопродление»', () => {
  it('разбор классов сетки работает — иначе проверки ниже пустые', () => {
    // Пара «разбор удался» для регулярки выше: без неё «колонок больше одной
    // нет» проходило бы на любом наборе классов.
    expect(gridColumns('mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2')).toEqual([
      { breakpoint: 'base', columns: 1 },
      { breakpoint: 'lg', columns: 2 },
    ]);
    expect(gridColumns('flex gap-3')).toEqual([]);
  });

  it('с автопродлением — одна колонка на мобилке и две на десктопе', () => {
    const layout = resolveSubscriptionInfoRowLayout(true);

    // ⚠️ Каскад min-width: базовый `grid-cols-1` обязан быть объявлен явно.
    // «Класса нет» и «значение по умолчанию» — разные вещи (урок #56).
    expect(gridColumns(layout.row)).toEqual([
      { breakpoint: 'base', columns: 1 },
      { breakpoint: 'lg', columns: 2 },
    ]);
    expect(layout.autopay).not.toBeNull();
  });

  it('без автопродления — счётчик во всю ширину, дыры нет', () => {
    const layout = resolveSubscriptionInfoRowLayout(false);
    const columns = gridColumns(layout.row);

    // ⚠️ Отдельная ветка из спеки. Оставь `lg:grid-cols-2` безусловным — и на
    // триальной/суточной подписке правая половина строки осталась бы пустой.
    expect(columns).toContainEqual({ breakpoint: 'base', columns: 1 });
    expect(columns.every((entry) => entry.columns === 1)).toBe(true);
    expect(layout.autopay).toBeNull();
  });

  it('классы записаны литералами, а не собраны шаблоном', () => {
    // Tailwind сканирует исходники текстом: `grid-cols-${n}` в собранный CSS
    // не попадает вообще, а сборка при этом зелёная (урок #55).
    expect(resolveSubscriptionInfoRowLayout(true).row).toContain('lg:grid-cols-2');
    expect(resolveSubscriptionInfoRowLayout(true).countdown).toBe(
      resolveSubscriptionInfoRowLayout(false).countdown,
    );
  });
});
