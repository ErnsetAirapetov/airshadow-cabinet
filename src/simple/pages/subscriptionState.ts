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

import {
  resolveTariffChangeOption,
  type SubscriptionCtaAction,
} from '../components/subscription/purchaseCta';
import type { Subscription } from '@/types';

/**
 * ⚠️ Акцент кнопки «Подключить устройство» переехал отсюда в
 * `src/simple/components/subscription/connectButtonAccent.ts` (#61): кнопка
 * стала общим компонентом двух экранов, и держать её акцент в модуле ОДНОЙ
 * страницы значило бы тянуть главную за импортом в `pages/`.
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

export interface AdditionalOptions {
  /** Блок рисуется вообще. */
  visible: boolean;
  /** Покупка устройств. */
  deviceTopup: boolean;
  /** Уменьшение числа устройств. */
  deviceReduction: boolean;
  /** Покупка трафика. */
  trafficTopup: boolean;
  /** Управление серверами. */
  serverManagement: boolean;
  /** Смена тарифа; `null` — пункта нет. Адрес берётся отсюда, а не пишется заново. */
  tariffChange: SubscriptionCtaAction | null;
}

const NO_OPTIONS: AdditionalOptions = {
  visible: false,
  deviceTopup: false,
  deviceReduction: false,
  trafficTopup: false,
  serverManagement: false,
  tariffChange: null,
};

/**
 * Состав блока «Дополнительные опции» (задача #61, вариант владельца A).
 *
 * ⚠️ Что изменилось и почему. Раньше блок целиком стоял под условием
 * «...и ненулевой лимит устройств», и это было верно, пока все его пункты были
 * про устройства. С переездом «Сменить тариф» условие стало ловушкой:
 * `device_limit === 0` — это БЕЗЛИМИТ по устройствам, блока такому человеку не
 * показывали вовсе, и смена тарифа пропала бы у него совсем (других входов в
 * витрину для активной платной подписки в простом режиме нет). Поэтому лимит
 * устройств переехал на сами устройство-зависимые пункты, а блок показывается,
 * когда в нём есть хоть один пункт.
 *
 * ⚠️ Видимость каждого прежнего пункта при этом НЕ ИЗМЕНИЛАСЬ ни для кого:
 * `hasDevices` — это ровно прежнее внешнее условие блока целиком. Проверено
 * перебором состояний в `tariffChangeAccess.test.ts`.
 *
 * ⚠️ `visible` считается ИЗ ПУНКТОВ, а не отдельным условием: иначе блок мог бы
 * появиться пустой карточкой с одним заголовком или, наоборот, спрятать
 * единственный пункт.
 */
export function resolveAdditionalOptions(
  subscription: Subscription | null,
  isTariffsMode: boolean,
): AdditionalOptions {
  if (!subscription) return NO_OPTIONS;

  const base = (subscription.is_active || subscription.is_limited) && !subscription.is_trial;
  const hasDevices = base && subscription.device_limit !== 0;

  const items = {
    deviceTopup: hasDevices,
    deviceReduction: hasDevices,
    trafficTopup: hasDevices && subscription.traffic_limit_gb > 0,
    serverManagement: hasDevices && !isTariffsMode,
    tariffChange: base ? resolveTariffChangeOption(subscription) : null,
  };

  return {
    ...items,
    visible:
      items.deviceTopup ||
      items.deviceReduction ||
      items.trafficTopup ||
      items.serverManagement ||
      items.tariffChange !== null,
  };
}
