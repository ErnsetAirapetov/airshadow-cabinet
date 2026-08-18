import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_DAY_MS,
  type ConnectButtonAccent,
  isCountdownUrgent,
  resolveConnectButtonAccent,
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

/** Исходник охраняемого модуля — сигнатуры сверяются текстом, а не через `.length`. */
const stateSource = readFileSync('src/simple/pages/subscriptionState.ts', 'utf8');

/**
 * Список параметров экспортируемой функции — текстом, со скобочным балансом.
 *
 * ⚠️ Нужен потому, что `Function.length` НЕ СЧИТАЕТ параметры со значением по
 * умолчанию: у `f(a, isDark = true)` длина остаётся единицей. Сторож на `.length`
 * поэтому пропускал бы ровно ту правку, ради запрета которой стоял.
 */
function parameterList(source: string, name: string): string | null {
  const marker = `export function ${name}(`;
  const at = source.indexOf(marker);
  if (at === -1) return null;

  const open = at + marker.length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i).trim();
    }
  }
  return null;
}

describe('resolveConnectButtonAccent: акцент кнопки подключения', () => {
  const enabled = resolveConnectButtonAccent(false);
  const atLimit = resolveConnectButtonAccent(true);
  const accentParameters = parameterList(stateSource, 'resolveConnectButtonAccent');

  it('в покое — заливка градиентом и свечение', () => {
    // ⚠️ Причина задачи: у прежней кнопки тень стояла только на `:hover`
    // (`.hover-border-gradient` в globals.css), а на телефоне и в Telegram
    // наведения не существует.
    expect(enabled.background).toMatch(/^linear-gradient\(/);
    expect(enabled.boxShadow).not.toBe('none');
    expect(enabled.boxShadow.length).toBeGreaterThan(0);
  });

  it('цвета литеральные — светлая тема их не перебивает', () => {
    // Инлайн-стиль правила `.light …` перебить не могут в принципе, а
    // литеральные `#rrggbb`/`rgba()` не ремапятся под `.light`, в отличие от
    // токенов `var(--color-accent-*)` (канон, раздел «Акцент на способе оплаты»).
    for (const value of [enabled.background, enabled.boxShadow, enabled.iconBackground]) {
      expect(value).not.toContain('var(--');
    }
    expect(enabled.background).toMatch(/#[0-9A-Fa-f]{6}/);
    expect(enabled.boxShadow).toMatch(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,/);
  });

  it('сигнатура разобрана — иначе проверки ниже пустые', () => {
    // Пара «разбор удался» для `parameterList`: сломайся он — и «второго
    // параметра нет» проходило бы на любой сигнатуре.
    expect(stateSource.length).toBeGreaterThan(2000);
    expect(accentParameters).toBeTruthy();
    // Самопроверка разбора на синтетических сигнатурах: параметр со значением
    // по умолчанию и второй параметр обязаны попадать в выдачу целиком.
    expect(parameterList('export function f(a: boolean, isDark = true): X {', 'f')).toBe(
      'a: boolean, isDark = true',
    );
    expect(parameterList(stateSource, 'такойФункцииНет')).toBeNull();
  });

  it('в сигнатуре ровно один параметр, и он без значения по умолчанию', () => {
    // ⚠️ Прежняя проверка была `resolveConnectButtonAccent.length === 1` и
    // охраняла пустоту: параметр СО ЗНАЧЕНИЕМ ПО УМОЛЧАНИЮ арность функции не
    // меняет, поэтому добавленный `isDark = true` оставлял её зелёной — ровно
    // тот случай, против которого сторож и ставился. Здесь читается текст
    // сигнатуры: и запятая, и `=` краснеют.
    expect(accentParameters).toMatch(/^isAtDeviceLimit\s*:/);
    expect(accentParameters).not.toContain(',');
    expect(accentParameters).not.toContain('=');
  });

  it('никакой дополнительный аргумент на выдачу не влияет', () => {
    // Свойство поверх сигнатуры: даже если параметр появится, выдача обязана
    // остаться прежней при любом его значении. Зоне трафика и теме проникнуть
    // в акцент неоткуда.
    const loose = resolveConnectButtonAccent as unknown as (
      ...args: unknown[]
    ) => ConnectButtonAccent;

    for (const extra of [true, false, 'light', 'dark', undefined, null]) {
      expect(loose(false, extra)).toEqual(enabled);
      expect(loose(true, extra)).toEqual(atLimit);
    }
  });

  it('упёрлись в лимит устройств — состояние остаётся отличимым', () => {
    expect(atLimit.boxShadow).toBe('none');
    expect(atLimit.background).not.toBe(enabled.background);
  });
});
