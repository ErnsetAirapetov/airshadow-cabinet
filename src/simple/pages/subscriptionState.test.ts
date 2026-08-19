import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_DAY_MS,
  isCountdownUrgent,
  resolveCountdownDisplay,
  resolveCountdownTickMs,
  resolveSubscriptionCardActions,
  resolveSubscriptionInfoRowLayout,
} from './subscriptionState';
import { isExpiredPaidSubscription } from '../components/subscription/purchaseCta';
import type { Subscription } from '@/types';

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

/* ══════════════════════════════════════════════════════════════════════════
 * Действия карточки подписки на странице (задача #65).
 *
 * Спека владельца: у истёкшей платной подписки на экране ОДНА кнопка —
 * «Продлить подписку» либо «Пополнить баланс», как на главной. «Подключить
 * устройство» при истёкшей подписке не рисуется вовсе: подключаться к мёртвой
 * подписке бессмысленно, а после #61 это самая громкая кнопка экрана.
 * ══════════════════════════════════════════════════════════════════════════ */

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 7,
    status: 'active',
    is_trial: false,
    start_date: '2026-08-01T00:00:00',
    end_date: '2026-09-01T00:00:00',
    days_left: 19,
    hours_left: 0,
    minutes_left: 0,
    time_left_display: '19 дней',
    traffic_limit_gb: 100,
    traffic_used_gb: 1,
    traffic_used_percent: 1,
    device_limit: 3,
    connected_squads: [],
    servers: [],
    autopay_enabled: false,
    autopay_days_before: 3,
    subscription_url: null,
    hide_subscription_link: false,
    is_active: true,
    is_expired: false,
    is_limited: false,
    ...overrides,
  };
}

describe('resolveSubscriptionCardActions: что за действия у карточки (#65)', () => {
  it('активная платная — подключение есть, блока истёкшей нет', () => {
    expect(resolveSubscriptionCardActions(sub())).toEqual({
      connectDevice: true,
      expiredAction: false,
      dailyPause: false,
    });
  });

  it('истёкшая платная — блок истёкшей вместо подключения', () => {
    // ⚠️ Сердце задачи. Мутация «оставить подключение при истёкшей» красит
    // здесь, и она же была предметом жалобы владельца.
    expect(resolveSubscriptionCardActions(sub({ is_active: false, is_expired: true }))).toEqual({
      connectDevice: false,
      expiredAction: true,
      dailyPause: false,
    });
  });

  it('истёкший суточный тариф — то же самое', () => {
    expect(resolveSubscriptionCardActions(sub({ is_active: false, is_daily: true }))).toEqual({
      connectDevice: false,
      expiredAction: true,
      dailyPause: false,
    });
  });

  it('триал и limited ведут себя как активная — их поведение не менялось', () => {
    // ⚠️ Истёкший триал сюда не относится: он ведёт на витрину своей кнопкой
    // `purchase`, и спека велела его не трогать.
    expect(resolveSubscriptionCardActions(sub({ is_active: false, is_trial: true }))).toEqual({
      connectDevice: true,
      expiredAction: false,
      dailyPause: false,
    });
    expect(resolveSubscriptionCardActions(sub({ is_active: false, is_limited: true }))).toEqual({
      connectDevice: true,
      expiredAction: false,
      dailyPause: false,
    });
  });

  it('подписки нет вовсе — карточки нет, значит и действий карточки нет', () => {
    // Кнопку «Оформить подписку» в этом состоянии рисует `PurchaseCTAButton`
    // СНАРУЖИ карточки, и она здесь не при чём.
    expect(resolveSubscriptionCardActions(null)).toEqual({
      connectDevice: false,
      expiredAction: false,
      dailyPause: false,
    });
  });

  it('правило «истекла» берётся из purchaseCta, а не пишется второй раз', () => {
    // ⚠️ Два условия «истекла» разъехались бы молча: `PurchaseCTAButton`
    // показал бы витрину рядом с продлением или спрятал бы всё сразу.
    for (const subscription of [
      sub(),
      sub({ is_active: false, is_expired: true }),
      sub({ is_active: false, is_trial: true }),
      sub({ is_active: false, is_limited: true }),
      sub({ is_active: false, is_daily: true, status: 'disabled' }),
    ]) {
      expect(resolveSubscriptionCardActions(subscription).expiredAction).toBe(
        isExpiredPaidSubscription(subscription),
      );
    }
  });

  it('живой суточный тариф — блок паузы есть, блока истёкшей нет', () => {
    // Блок «Пауза списаний» адресован именно этому состоянию: списания идут,
    // человек может их остановить.
    expect(resolveSubscriptionCardActions(sub({ is_daily: true }))).toEqual({
      connectDevice: true,
      expiredAction: false,
      dailyPause: true,
    });
  });

  it('истёкший суточный тариф — блока паузы нет вовсе (решение владельца 19.08.2026)', () => {
    // ⚠️ Довод владельца не про лишнюю кнопку, а про ложь: строка состояния
    // блока у истёкшей подписки печатает «Списания активны». Мутация «вернуть
    // кнопку паузы при истёкшей» краснеет здесь и в `expiredSingleAction.test.ts`.
    expect(
      resolveSubscriptionCardActions(sub({ is_active: false, is_daily: true })).dailyPause,
    ).toBe(false);
    // И у приостановленного суточного тоже: «Возобновить» ему даёт общий блок
    // действия веткой `resumeDaily`, тем же вызовом `togglePause`.
    expect(
      resolveSubscriptionCardActions(sub({ is_active: false, is_daily: true, status: 'disabled' })),
    ).toEqual({ connectDevice: false, expiredAction: true, dailyPause: false });
  });

  it('суточный триал — блока паузы не было и нет', () => {
    // Условие блока всегда содержало `!is_trial`: пробный период не списывают.
    expect(resolveSubscriptionCardActions(sub({ is_daily: true, is_trial: true })).dailyPause).toBe(
      false,
    );
  });

  it('обычная подписка блока паузы не получает ни в каком состоянии', () => {
    // Пауза — механизм суточного тарифа, и мутация «смотреть только на
    // истекла» краснеет здесь.
    for (const subscription of [
      sub(),
      sub({ is_active: false }),
      sub({ is_limited: true }),
      sub({ status: 'disabled' }),
    ]) {
      expect(resolveSubscriptionCardActions(subscription).dailyPause).toBe(false);
    }
  });

  it('подключение и блок истёкшей никогда не показываются вместе', () => {
    // Свойство «на экране одно действие»: перебор по всем полям, которые в
    // правило входят.
    const states: Subscription[] = [];
    for (const isActive of [true, false]) {
      for (const isLimited of [true, false]) {
        for (const isTrial of [true, false]) {
          for (const isDaily of [true, false]) {
            states.push({
              ...sub(),
              is_active: isActive,
              is_limited: isLimited,
              is_trial: isTrial,
              is_daily: isDaily,
            });
          }
        }
      }
    }

    // Пара «разбор удался»: в переборе есть оба исхода, иначе проверка пустая.
    expect(states.some((state) => resolveSubscriptionCardActions(state).expiredAction)).toBe(true);
    expect(states.some((state) => resolveSubscriptionCardActions(state).connectDevice)).toBe(true);

    for (const state of states) {
      const actions = resolveSubscriptionCardActions(state);

      expect(actions.connectDevice && actions.expiredAction).toBe(false);
      // ⚠️ И блок паузы с блоком истёкшей — тоже никогда вместе: их кнопки
      // зовут один и тот же `togglePause`, то есть это было бы два одинаковых
      // «Возобновить» на одном экране.
      expect(actions.dailyPause && actions.expiredAction).toBe(false);
    }

    // Пара «разбор удался» для третьего поля: в переборе есть состояние с блоком
    // паузы, иначе проверка выше проходила бы ни на чём.
    expect(states.some((state) => resolveSubscriptionCardActions(state).dailyPause)).toBe(true);
  });
});
