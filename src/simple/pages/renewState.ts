import type { Balance } from '@/types';

/**
 * Ветвящаяся логика простого экрана продления (задача #29).
 *
 * ⚠️ Модуль чистый и импортирует из `@/types` ТОЛЬКО типы: `import type`
 * стирается при трансформации, поэтому alias `@/` тесту не нужен — его в
 * `vitest.config.ts` нет, а трогать апстримный конфиг запрещено
 * (docs/architecture/two-modes.md, раздел «Тесты»).
 */

/**
 * Баланс экрана продления — ОДНО число в двух единицах.
 *
 * ⚠️ Здесь закрыта ловушка из спеки #29. На апстримном экране продления баланс
 * приходит из `purchaseOptions.balance_kopeks` (`['purchase-options', subId]`), а
 * наш общий `BalanceWidget` спрашивает свой запрос `['balance']`. Оставь оба — и
 * получится экран, где виджет показывает одну сумму, а кнопка периода пишет «не
 * хватает» по другой: два запроса, два момента времени, одна покупка.
 *
 * Выбран вариант «прокинуть значение в виджет пропом» из двух, предложенных
 * спекой. Почему именно он:
 *
 *   - показываемое число и число, по которому считается доступность, выходят из
 *     ОДНОГО вызова этой функции. Это структурная гарантия, а не договорённость:
 *     разъехаться им негде;
 *   - запрос `['purchase-options', subId]` со страницы уходит совсем — на
 *     апстримном экране продления он существовал ровно ради баланса;
 *   - `kopeks` считается ИЗ `rubles`, а не берётся из соседнего поля ответа.
 *     Поля `balance_rubles` и `balance_kopeks` заполняет бэкенд независимо, и
 *     разойдись они — экран показывал бы одно, а считал по другому. Здесь
 *     копейки по построению равны показанным рублям.
 *
 * Пустой ответ (запрос ещё летит или упал) даёт ноль — как у апстрима
 * (`purchaseOptions?.balance_kopeks ?? 0`): до ответа человек видит «не хватает»,
 * а не ложное «хватает».
 */
export interface RenewBalance {
  /** Число, которое показывает виджет. */
  rubles: number;
  /** То же число в копейках — им и только им считается доступность. */
  kopeks: number;
}

export function resolveRenewBalance(balance: Balance | undefined | null): RenewBalance {
  const rubles = balance?.balance_rubles ?? 0;

  return { rubles, kopeks: Math.round(rubles * 100) };
}

export interface RenewOptionState {
  canAfford: boolean;
  /** Сколько не хватает. Ноль, когда хватает, — отрицательных сумм не показываем. */
  missingKopeks: number;
}

/**
 * Хватает ли баланса на период продления.
 *
 * Правило апстримное: `balanceKopeks >= option.price_kopeks`, недостача —
 * разность. Вынесено сюда, чтобы источник баланса был виден в одном месте
 * вместе с `resolveRenewBalance`.
 */
export function resolveRenewOptionState(
  balanceKopeks: number,
  priceKopeks: number,
): RenewOptionState {
  const canAfford = balanceKopeks >= priceKopeks;

  return { canAfford, missingKopeks: canAfford ? 0 : priceKopeks - balanceKopeks };
}

/**
 * Недостающая сумма из ошибки мутации продления.
 *
 * Апстрим кодирует её в состоянии строкой `insufficient:<копейки>` — форма
 * странная, но менять её здесь нельзя: тот же формат кладёт обработчик ошибки, и
 * второе правило разъехалось бы с первым молча.
 */
export function resolveMissingAmountKopeks(error: string | null): number | null {
  const match = error?.match(/^insufficient:(\d+)$/);

  return match ? Number(match[1]) : null;
}

/** `:subscriptionId` из адреса. Нечисловой параметр — это «подписки нет». */
export function resolveRenewSubscriptionId(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
