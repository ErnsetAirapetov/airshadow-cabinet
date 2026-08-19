import type { Subscription } from '@/types';

/**
 * Чистая логика единственной кнопки истёкшей платной подписки (задача #65).
 *
 * ⚠️ Модуль чистый: ни React, ни `@/api`, ни `@/store`. Разметка блока —
 * тонкая оболочка над ним, потому что компонентных тестов в проекте не бывает
 * (docs/architecture/two-modes.md, раздел «Тесты»). До #65 всё это ветвление
 * жило разметкой карточки главной, то есть проверить его было нечем.
 *
 * Решение «продлить или пополнить» здесь НЕ живёт: оно называется
 * `resolveExpiredCardAction` и лежит в `pages/dashboardState.ts` рядом с
 * остальным состоянием главной. Второй копии этого правила быть не должно —
 * блок действия его импортирует.
 */

/** «Есть хоть рубль» — порог для обычной подписки. */
export const MIN_RENEW_BALANCE_KOPEKS = 100;

/** На сколько дней продлевается обычная подписка одной кнопкой. */
export const RENEW_PERIOD_DAYS = 30;

/** Сколько дней покупается за раз у суточного тарифа. */
export const DAILY_PURCHASE_DAYS = 1;

/**
 * Хватает ли денег на продление — ГРУБО.
 *
 * ⚠️ Цены продления проверка не знает и знать не может: у обычной подписки
 * цена периода приходит только с попыткой. Поэтому она отвечает лишь на «есть
 * ли на балансе хоть что-то», а реальный отказ API по нехватке средств обязан
 * перебивать её результат — это и делает `resolveExpiredCardAction`.
 *
 * У суточного тарифа цена известна (`daily_price_kopeks`), и порогом служит
 * она. Нулевая цена означает «цену не отдали», а не «продление бесплатно»:
 * без условия `> 0` кнопка продления показалась бы при пустом балансе и
 * отказала бы на первом же нажатии.
 */
export function hasBalanceForRenew({
  subscription,
  balanceKopeks,
}: {
  subscription: Subscription;
  balanceKopeks: number;
}): boolean {
  if (subscription.is_daily) {
    const dailyPrice = subscription.daily_price_kopeks ?? 0;
    return dailyPrice > 0 && balanceKopeks >= dailyPrice;
  }

  return balanceKopeks >= MIN_RENEW_BALANCE_KOPEKS;
}

/**
 * Суточный тариф с остановленными списаниями — «приостановлена», а не «истекла».
 *
 * ⚠️ Условие спрашивают двое: выбор операции ниже (снять с паузы, а не покупать
 * заново) и заголовок карточки на главной («Подписка приостановлена»). Второй
 * записи этого условия быть не должно: заголовок и действие разъехались бы
 * молча — кнопка «Возобновить» под заголовком «Подписка истекла».
 */
export function isPausedDailySubscription(subscription: Subscription): boolean {
  return Boolean(subscription.is_daily) && subscription.status === 'disabled';
}

/**
 * Чем именно продлевается подписка при нажатии кнопки.
 *
 * Размеченное объединение, а не три флага: у ветки «снять с паузы» нет ни
 * тарифа, ни числа дней, и разметка не может передать их по недосмотру.
 */
export type ExpiredRenewOperation =
  | { kind: 'resumeDaily' }
  | { kind: 'purchaseDailyTariff'; tariffId: number; days: number }
  | { kind: 'renewSubscription'; days: number };

/**
 * ⚠️ Три ветки — не украшение, каждая лечит свой отказ бэкенда:
 *
 * - приостановленный суточный тариф (`status === 'disabled'`) снимается с
 *   паузы; покупка тарифа поверх дала бы «Тариф уже активен» и возврат средств;
 * - истёкший суточный покупается на один день, и `subscription.id` в запросе
 *   обязателен — иначе бэкенд ищет строку по `(user_id, tariff_id)` и
 *   проигрывает гонку с вебхуками панели;
 * - у всего остального продление периодом.
 *
 * Суточный без `tariff_id` покупать нечем, поэтому он уходит в обычное
 * продление, а не остаётся без действия.
 *
 * ⚠️ ПРО `is_daily_paused` У ИСТЁКШЕЙ ПОДПИСКИ — вопрос закрыт, пересматривать
 * не нужно. Ветка `purchaseDailyTariff` достаётся и суточной подписке с
 * `is_daily_paused = true`, у которой статус НЕ `disabled`. Опасение «покупка
 * дня не снимет флаг, автосписание останется выключенным, и завтра экран
 * повторится» проверено ПО КОДУ БЭКЕНДА 19.08.2026
 * (репозиторий `remnawave-bedolaga-telegram-bot`) и НЕ подтвердилось:
 *
 * - `app/cabinet/routes/subscription_modules/purchase.py:945-948` — эндпоинт
 *   `purchase-tariff`, тот самый, что зовёт эта ветка, в суточном тарифе
 *   выставляет `last_daily_charge_at = now` и `is_daily_paused = False`;
 * - `app/cabinet/routes/subscription_modules/daily.py:61-72` — `togglePause`
 *   относит истёкшую подписку (`EXPIRED` входит в `was_disabled`) к требующим
 *   возобновления и тоже приводит к `is_daily_paused = False`.
 *
 * То есть оба пути одинаково возвращают службу, одинаково стоят суточную цену
 * (у возобновления есть свой отказ `subscription.pause.insufficientBalance`) и
 * оба снимают флаг. Цикла и тупика нет, поэтому `isPausedDailySubscription`
 * НЕ расширяется до `is_daily_paused`: это было бы решение про поведение
 * бэкенда, а не про разметку, и в задаче его нет.
 */
export function resolveExpiredRenewOperation(subscription: Subscription): ExpiredRenewOperation {
  if (isPausedDailySubscription(subscription)) {
    return { kind: 'resumeDaily' };
  }

  if (subscription.is_daily && subscription.tariff_id) {
    return {
      kind: 'purchaseDailyTariff',
      tariffId: subscription.tariff_id,
      days: DAILY_PURCHASE_DAYS,
    };
  }

  return { kind: 'renewSubscription', days: RENEW_PERIOD_DAYS };
}

/**
 * Что рисует единственная кнопка блока.
 *
 * `pending` — баланс ещё не пришёл. Это не косметика: пока запрос в полёте,
 * баланс равен нулю, грубая проверка «денег хватает» отвечает «нет», и на
 * 200–400 мс единственной кнопкой экрана становится «Пополнить баланс», которая
 * затем превращается в «Продлить». На главной рядом стоит сумма баланса, а на
 * странице подписки её нет — человек с деньгами успевает нажать пополнение.
 *
 * ⚠️ ОШИБКА запроса баланса сюда НЕ приравнена к загрузке — сознательно.
 * Соблазн понятен: при отказе `isPending` уже `false`, данных нет, баланс
 * считается нулём, и человеку с деньгами предлагают «Пополнить баланс». Но
 * `pending` — это `disabled`-кнопка со спиннером, то есть экран БЕЗ рабочего
 * действия, и держался бы он не 300 мс, а до конца отказа. Это прямо нарушает
 * инвариант «без действия не остаётся ни одно состояние» (перебор в
 * `pages/expiredSingleAction.test.ts`), тогда как «Пополнить баланс» ведёт на
 * экран, где настоящий баланс виден. Правильный ответ — показать отказ запроса
 * баланса отдельно от кнопки, и это спека владельца, а не догадка исполнителя;
 * вопрос вынесен в MR отдельным пунктом.
 */
export type ExpiredActionButton = 'pending' | 'renew' | 'topUp';

export function resolveExpiredActionButton({
  action,
  isBalanceLoading,
}: {
  /** Решение `resolveExpiredCardAction`: продлить или пополнить. */
  action: 'renew' | 'topUp';
  /** Запрос баланса ещё идёт — решение выше принято по нулю, а не по данным. */
  isBalanceLoading: boolean;
}): ExpiredActionButton {
  if (isBalanceLoading) return 'pending';

  return action;
}

/**
 * Короткое «Продлить» — подпись кнопки на главной, где она стоит в тесной
 * плитке рядом с суммой баланса. Ключ апстримный, из неймспейса `translation`.
 */
export const DEFAULT_RENEW_LABEL_KEY = 'dashboard.expired.quickRenew';

/**
 * «Продлить подписку» — подпись на странице подписки, где кнопка идёт во всю
 * ширину (решение владельца от 19.08.2026: критерий #65 требует именно этой
 * формулировки, а на главной остаётся короткая).
 *
 * ⚠️ Ключ НАШ, поэтому с префиксом неймспейса: строки простого режима живут в
 * `src/simple/locales/*.json` под неймспейсом `simple`, а блок зовёт `t()`
 * одного инстанса и для апстримного ключа выше. Без префикса на кнопке
 * напечатается сам ключ — молча, при зелёной сборке; резолв обеих подписей
 * проверяется настоящим i18next в `expiredAction.test.ts`.
 */
export const PAGE_RENEW_LABEL_KEY = 'simple:subscription.expiredRenewAction';

/**
 * Подпись кнопки: снятие с паузы — «Возобновить», остальное — «Продлить».
 *
 * ⚠️ `renewLabelKey` — способ развести подписи ДВУХ мест вызова, не разводя сам
 * блок: место вызова передаёт свой ключ, ветки «на главной / на странице» внутри
 * блока нет. Ровно так же у общей кнопки подключения разведён `className` (#61).
 *
 * ⚠️ На снятие с паузы подмена НЕ действует: списания всего лишь остановлены,
 * там «Возобновить», и «Продлить подписку» на этой кнопке врало бы.
 */
export function resolveExpiredActionLabelKey(
  operation: ExpiredRenewOperation,
  renewLabelKey: string = DEFAULT_RENEW_LABEL_KEY,
): string {
  return operation.kind === 'resumeDaily' ? 'dashboard.suspended.resume' : renewLabelKey;
}
