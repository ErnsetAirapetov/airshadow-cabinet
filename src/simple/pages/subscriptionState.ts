/**
 * Ветвящаяся логика простой страницы подписки (задача #59).
 *
 * ⚠️ Модуль чистый: ни React, ни `@/api`, ни `@/store`. Страница —
 * тонкая оболочка над ним, потому что компонентных тестов в проекте не бывает
 * (`environment: 'node'`, alias `@/` в тестах не разрешается,
 * docs/architecture/two-modes.md, раздел «Тесты»). Всё, что здесь ветвится,
 * проверяется вызовом функции, а не чтением разметки.
 *
 * ⚠️ Классы Tailwind записаны ЛИТЕРАЛАМИ. Сборщик сканирует исходники текстом,
 * и `grid-cols-${n}` в собранный CSS не попадает вообще — при зелёной сборке
 * (урок #55, `paymentMethodsBento.ts`).
 */

/** Сутки в миллисекундах — граница между «днями» и «часами-минутами-секундами». */
export const COUNTDOWN_DAY_MS = 86_400_000;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

/** Ниже этого остатка счётчик красится тревожным тоном — прежнее `days <= 3`. */
const URGENT_THRESHOLD_MS = 4 * COUNTDOWN_DAY_MS;

export interface CountdownInput {
  /** Остаток до `end_date` в миллисекундах. Может быть отрицательным. */
  remainingMs: number;
  /** Подписка ещё действует (`is_active || is_limited`). */
  isActive: boolean;
}

/**
 * Что именно печатает счётчик.
 *
 * Размеченное объединение, а не четыре числа: у ветки «дни» полей часов,
 * минут и секунд физически нет, поэтому разметка не может их напечатать даже
 * по недосмотру. Прежний счётчик держал все четыре и печатал ЧЧ:ММ:СС всегда —
 * это и был предмет жалобы владельца.
 */
export type CountdownDisplay =
  | { kind: 'expired' }
  | { kind: 'days'; days: number }
  | { kind: 'clock'; hours: number; minutes: number; seconds: number };

/**
 * Правило владельца: остаток НЕ МЕНЬШЕ суток — только дни; меньше суток —
 * часы, минуты, секунды; подписка не действует — «истекла».
 *
 * ⚠️ Не путать с `resolveTimeLeftDisplay` из `dashboardState.ts`: там одна
 * единица со спуском до «меньше минуты», и это другой экран. Сливать их нельзя.
 */
export function resolveCountdownDisplay({
  remainingMs,
  isActive,
}: CountdownInput): CountdownDisplay {
  if (!isActive) return { kind: 'expired' };

  // Активная подписка с истёкшим `end_date` — реальное состояние: бэкенд гасит
  // подписку не в ту же секунду. Без зажима в вёрстку уехали бы минусы.
  const left = Math.max(0, remainingMs);

  if (left >= COUNTDOWN_DAY_MS) {
    return { kind: 'days', days: Math.floor(left / COUNTDOWN_DAY_MS) };
  }

  return {
    kind: 'clock',
    hours: Math.floor(left / HOUR_MS),
    minutes: Math.floor((left % HOUR_MS) / MINUTE_MS),
    seconds: Math.floor((left % MINUTE_MS) / SECOND_MS),
  };
}

/**
 * Период тика счётчика в миллисекундах; `null` — интервал не нужен вовсе.
 *
 * ⚠️ Посекундный тик при показе дней бессмысленен: страница перерисовывалась
 * раз в секунду круглосуточно ради числа, которое меняется раз в сутки. На
 * дистанции от суток тикаем раз в минуту — этого хватает, чтобы вовремя
 * переключиться на последние сутки.
 */
export function resolveCountdownTickMs({ remainingMs, isActive }: CountdownInput): number | null {
  if (!isActive) return null;

  return remainingMs < COUNTDOWN_DAY_MS ? SECOND_MS : MINUTE_MS;
}

/** Тревожный тон счётчика — прежнее правило `countdown.days <= 3`, без изменений. */
export function isCountdownUrgent(remainingMs: number): boolean {
  return remainingMs < URGENT_THRESHOLD_MS;
}

export interface SubscriptionInfoRowLayout {
  /** Классы контейнера ряда. */
  row: string;
  /** Классы ячейки счётчика. */
  countdown: string;
  /** Классы ячейки автопродления; `null` — блока нет и рисовать его нельзя. */
  autopay: string | null;
}

const INFO_ROW_CELL = 'min-w-0';

/**
 * Ряд «Осталось» + «Автопродление»: пополам на десктопе, две строки на мобилке.
 *
 * ⚠️ Ветка «автопродления нет» — не украшение. Блок условный (его не бывает у
 * триальной и суточной подписки), и с безусловным `lg:grid-cols-2` правая
 * половина строки осталась бы пустой дырой. Поэтому вторая колонка появляется
 * ровно тогда, когда есть чем её занять.
 *
 * ⚠️ Базовый `grid-cols-1` объявлен ЯВНО: на брейкпоинтах ниже `lg` действует
 * он, а не «значение по умолчанию». Каскад min-width уже ломал раскладку кнопок
 * в #56 — «класса нет» и «класс со значением 1» это разные вещи.
 */
export function resolveSubscriptionInfoRowLayout(hasAutopay: boolean): SubscriptionInfoRowLayout {
  return hasAutopay
    ? {
        row: 'grid grid-cols-1 gap-3 lg:grid-cols-2',
        countdown: INFO_ROW_CELL,
        autopay: INFO_ROW_CELL,
      }
    : {
        row: 'grid grid-cols-1 gap-3',
        countdown: INFO_ROW_CELL,
        autopay: null,
      };
}

export interface ConnectButtonAccent {
  /** Заливка кнопки. */
  background: string;
  /** Свечение В ПОКОЕ. `'none'` — только для состояния «лимит устройств». */
  boxShadow: string;
  /** Подложка иконки на заливке. */
  iconBackground: string;
}

/**
 * Акцент кнопки «Подключить устройство».
 *
 * ⚠️ Почему инлайн-стиль и литеральные цвета, а не утилиты и не токены. Утилиты
 * рамки и свечения (`border-accent-*`, `shadow-glow`) в светлой теме подавляются
 * правилами карточек — установлено в #52 и записано в каноне. Инлайн-стиль
 * светлотемные правила перебить не могут в принципе, а литеральный `#3B82F6` не
 * ремапится под `.light`, в отличие от `var(--color-accent-*)`. Ровно этот
 * рецепт работает у красной кнопки пополнения в `SubscriptionCardExpired`.
 *
 * ⚠️ Свечение задано В ПОКОЕ, а не на `:hover`. Прежняя кнопка светилась только
 * под курсором (`.hover-border-gradient:hover` в globals.css), а на телефоне и
 * внутри Telegram наведения не существует — от акцента оставалась рамка в
 * полтора пикселя, и кнопку пролистывали.
 *
 * ⚠️ Единственный аргумент — состояние лимита устройств. Зона расхода трафика в
 * выдачу не входит: кнопка меняла тон по причине, к действию не относящейся
 * (то же правило «не красить действия статусным цветом», по которому тон убрали
 * из плитки тарифа в `SubscriptionCardActive`).
 */
export function resolveConnectButtonAccent(isAtDeviceLimit: boolean): ConnectButtonAccent {
  if (isAtDeviceLimit) {
    // Упёрлись в лимит — заливка гасится, свечение снимается совсем. Вместе с
    // `cursor-not-allowed` и подписью «лимит достигнут» состояние остаётся
    // отличимым от рабочего, а звать в него уже незачем.
    return {
      background: 'linear-gradient(135deg, #2B4A85, #24407A)',
      boxShadow: 'none',
      iconBackground: 'rgba(255,255,255,0.12)',
    };
  }

  return {
    background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
    boxShadow: '0 6px 24px rgba(59,130,246,0.38)',
    iconBackground: 'rgba(255,255,255,0.18)',
  };
}
