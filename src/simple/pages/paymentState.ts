import { isNonRenewableStatus } from '../components/subscription/expiredAction';
import type { RenewalOption, Subscription, Tariff, TariffPeriod } from '@/types';

/**
 * Единый экран оплаты подписки — выбор операции и источника цен (задача #69).
 *
 * ⚠️ Модуль чистый: ни React, ни `@/api`, ни `@/store`. Из `@/types` берутся
 * ТОЛЬКО типы — `import type` стирается при трансформации, поэтому alias `@/`
 * тесту не нужен (docs/architecture/two-modes.md, раздел «Тесты»).
 *
 * ⚠️ Зачем модуль вообще. Владелец забраковал то, что оплата подписки жила на
 * двух разных экранах: продление истёкшей — на одном, покупка тарифа — на
 * другом. Для человека разницы нет, и интерфейс обязан быть один. Но одним
 * источником цен единый экран не собрать — этого не позволяет бэкенд:
 *
 * - продление запрещено статусам `disabled` и `pending`
 *   (`renewal.py:130-136`), а `expired` в этот список НЕ входит — обычная
 *   истёкшая подписка продлевается, и это работает сегодня;
 * - эндпоинт цен `renewal-options` тем же двум статусам отдаёт ПУСТОЙ список
 *   (`renewal.py:53-57`), то есть сроков он для них не вернёт вовсе;
 * - значит непродлеваемым сроки надо брать из `period_prices` тарифа в
 *   каталоге, а платить — `purchase-tariff`, у которого запрета на эти статусы
 *   нет (`purchase.py`).
 *
 * Здесь этот разбор записан один раз. На стенде состояние «тариф отвалился»
 * воспроизвести нечем, поэтому единственное доказательство правильности —
 * перебор состояний в `paymentState.test.ts`.
 *
 * ⚠️ Списка непродлеваемых статусов здесь НЕТ и быть не должно: он один и
 * лежит в `components/subscription/expiredAction.ts` (`NON_RENEWABLE_STATUSES`,
 * задача #67). Вторая запись разъехалась бы с первой молча.
 */

/** Один срок на экране — уже независимо от того, откуда пришла цена. */
export interface PaymentPeriod {
  periodDays: number;
  priceKopeks: number;
  discountPercent: number;
  /** Цена до скидки. `null` — скидки нет, зачёркивать нечего. */
  originalPriceKopeks: number | null;
}

/**
 * Откуда взяты цены. Не косметика: от источника зависит, применяет ли экран
 * промо-скидку клиентом (см. `promoDiscountable`).
 */
export type PaymentPriceSource = 'renewalOptions' | 'tariffCatalog';

/**
 * Что рисует единый экран оплаты.
 *
 * Размеченное объединение, а не набор флагов: у ветки «выбрать тариф» нет ни
 * сроков, ни операции, и разметка не может позвать оплату по недосмотру, а у
 * ветки покупки тариф есть всегда — числом, а не «может быть».
 */
export type PaymentPlan =
  | {
      /** Запрос ещё в полёте — решать не по чему. */
      screen: 'pending';
    }
  | {
      screen: 'periods';
      operation: 'renew';
      source: 'renewalOptions';
      /**
       * ⚠️ ЛОЖЬ здесь стоит денег. Цены продления бэкенд считает
       * `calculate_renewal_price(..., user=user)` — промо-оффер пользователя в
       * них УЖЕ учтён. Применить `applyPromoDiscount` поверх значит показать
       * скидку дважды и списать не ту сумму, которую человек видел.
       */
      promoDiscountable: false;
      periods: PaymentPeriod[];
    }
  | {
      screen: 'periods';
      operation: 'purchaseTariff';
      source: 'tariffCatalog';
      /**
       * ⚠️ А здесь наоборот. Периоды тарифа несут только скидку промо-ГРУППЫ
       * (`purchase.py:137-152`), промо-оффер к ним добавляет клиент — ровно
       * так же, как в `TariffPurchaseForm`. Без этого цена на едином экране
       * разошлась бы с ценой в форме покупки того же тарифа.
       */
      promoDiscountable: true;
      tariffId: number;
      periods: PaymentPeriod[];
    }
  | {
      /** Платить нечем — остаётся сетка выбора тарифа. */
      screen: 'pickTariff';
      /**
       * ⚠️ Баннер «ваш тариф больше не поддерживается» показывается ТОЛЬКО
       * тому, у кого тариф был и отвалился. Человеку без подписки вовсе это
       * сообщение — ложь: терять ему нечего.
       */
      unsupportedTariffBanner: boolean;
    };

/**
 * Можно ли оплатить свой тариф из каталога.
 *
 * ⚠️ Три условия — это ровно те три, при которых бэкенд перестаёт отдавать
 * тарифные периоды: тарифа нет в выдаче `purchase-options`, он скрыт
 * (`is_available` заполняется из `tariff.is_active`, `purchase.py:247`) или у
 * него нет `period_prices` (`purchase.py:120-121`). В последних двух случаях
 * `renewal-options` подставляет СТАНДАРТНЫЕ периоды настроек вместо тарифных
 * (`renewal.py:60-70`), то есть тихо предлагает продлить то, чего в каталоге
 * уже нет.
 */
export function isPayableTariff(tariff: Tariff | null | undefined): tariff is Tariff {
  if (!tariff) return false;

  return tariff.is_available !== false && tariff.periods.length > 0;
}

function fromRenewalOptions(options: RenewalOption[]): PaymentPeriod[] {
  return options.map((option) => ({
    periodDays: option.period_days,
    priceKopeks: option.price_kopeks,
    discountPercent: option.discount_percent,
    originalPriceKopeks: option.original_price_kopeks ?? null,
  }));
}

function fromTariffPeriods(periods: TariffPeriod[]): PaymentPeriod[] {
  return periods.map((period) => ({
    periodDays: period.days,
    priceKopeks: period.price_kopeks,
    discountPercent: period.discount_percent ?? 0,
    originalPriceKopeks: period.original_price_kopeks ?? null,
  }));
}

/**
 * Ключ заголовка единого экрана оплаты.
 *
 * ⚠️ Заголовок один на обе операции — это и есть требование владельца
 * «интерфейс должен быть одинаковым». Продление и покупка своего же тарифа для
 * человека одно и то же действие, и подписывать их разными словами значило бы
 * вернуть два экрана, просто на одном адресе. Отличается только выбор тарифа:
 * там оплачивать пока нечего.
 *
 * Оба ключа АПСТРИМНЫЕ и уже переведены на все языки — своих строк заголовку
 * задача не заводит.
 */
export function resolvePaymentTitleKey(plan: PaymentPlan): string {
  return plan.screen === 'pickTariff' ? 'subscription.getSubscription' : 'subscription.extend';
}

/** Результат `applyPromoDiscount` — ровно те поля, которые нужны цене периода. */
export interface PaymentPromo {
  price: number;
  original: number | null;
  percent: number | null;
}

export interface PaymentPeriodPrice {
  priceKopeks: number;
  originalPriceKopeks: number | null;
  discountPercent: number;
}

/**
 * Цена периода на экране: своя или пересчитанная промо-скидкой.
 *
 * ⚠️ Промо-скидку передаёт ВЫЗЫВАЮЩИЙ и только когда план разрешил
 * (`promoDiscountable`, источник — каталог тарифа). `null` означает «цена уже
 * окончательная», и подмешать скидку второй раз здесь нечем: у функции просто
 * нет такого входа.
 */
export function resolvePeriodPrice(
  period: PaymentPeriod,
  promo: PaymentPromo | null,
): PaymentPeriodPrice {
  if (!promo) {
    return {
      priceKopeks: period.priceKopeks,
      originalPriceKopeks: period.originalPriceKopeks,
      discountPercent: period.discountPercent,
    };
  }

  return {
    priceKopeks: promo.price,
    originalPriceKopeks: promo.original ?? period.originalPriceKopeks,
    discountPercent: promo.percent ?? period.discountPercent,
  };
}

export interface PaymentPlanInput {
  /** `undefined` — запрос подписки ещё идёт; `null` — подписки нет вовсе. */
  subscription: Subscription | null | undefined;
  /** Цены продления. `undefined` — запрос ещё идёт, `[]` — сервер ответил пустым. */
  renewalOptions: RenewalOption[] | undefined;
  /** Каталог тарифов из `purchase-options`. `undefined` — запрос ещё идёт. */
  tariffs: Tariff[] | undefined;
  /** Тарифный режим продаж (`sales_mode === 'tariffs'`). */
  isTariffsMode: boolean;
}

/**
 * ⚠️ ПОРЯДОК ВЕТОК — часть правила, и каждая перестановка ломает свой экран.
 *
 * 1. «Подписки нет» стоит выше всего: продлевать нечего, и баннер про
 *    отвалившийся тариф здесь был бы ложью.
 * 2. Непродлеваемый статус стоит ВЫШЕ проверки цен продления: их для него всё
 *    равно не будет (`renewal.py:53-57`), а поставь мы проверку выше — экран
 *    ушёл бы в сетку выбора там, где своим тарифом заплатить можно.
 * 3. Ожидание цен продления стоит НИЖЕ непродлеваемого статуса ровно поэтому
 *    же: тому запрос `renewal-options` не нужен вовсе.
 * 4. Сетка выбора — последняя: это состояние «платить нечем», а не первое,
 *    что приходит в голову.
 */
export function resolvePaymentPlan(input: PaymentPlanInput): PaymentPlan {
  const { subscription, renewalOptions, tariffs, isTariffsMode } = input;

  if (subscription === undefined || tariffs === undefined) {
    return { screen: 'pending' };
  }

  // Подписки нет — сетка выбора без баннера. Ровно случай «оформить подписку».
  if (!subscription) {
    return { screen: 'pickTariff', unsupportedTariffBanner: false };
  }

  const tariff = subscription.tariff_id
    ? tariffs.find((candidate) => candidate.id === subscription.tariff_id)
    : undefined;

  /**
   * ⚠️ «Тариф был и отвалился» — не то же самое, что «тарифа нет».
   *
   * Баннер не достаётся ни триалу (платного тарифа у него не было), ни
   * классическому режиму продаж (тарифов там не существует вовсе, и подписка
   * без `tariff_id` там норма). Обоим сетка показывается молча.
   */
  const pickTariff: PaymentPlan = {
    screen: 'pickTariff',
    unsupportedTariffBanner: isTariffsMode && !subscription.is_trial,
  };

  if (isNonRenewableStatus(subscription)) {
    // Продление бэкенд запретил — платим покупкой своего же тарифа. Цены
    // только из каталога: `renewal-options` для этого статуса пуст.
    if (!isPayableTariff(tariff)) return pickTariff;

    return {
      screen: 'periods',
      operation: 'purchaseTariff',
      source: 'tariffCatalog',
      promoDiscountable: true,
      tariffId: tariff.id,
      periods: fromTariffPeriods(tariff.periods),
    };
  }

  if (renewalOptions === undefined) {
    return { screen: 'pending' };
  }

  // ⚠️ Тариф проверяется и на продлеваемом статусе — по требованию владельца:
  // «если истёкшая подписка больше не доступна, показать окно с выбором
  // подписки». Продление такой подписке бэкенд формально разрешит, но
  // подставит СТАНДАРТНЫЕ периоды настроек вместо тарифных
  // (`renewal.py:60-70`), то есть продаст срок тарифа, которого уже нет.
  if (isTariffsMode && !isPayableTariff(tariff)) return pickTariff;

  // Цены не пришли ни из одного источника — пустой экран задача запрещает
  // прямо, и это состояние обязано вести в сетку выбора.
  if (renewalOptions.length === 0) return pickTariff;

  return {
    screen: 'periods',
    operation: 'renew',
    source: 'renewalOptions',
    promoDiscountable: false,
    periods: fromRenewalOptions(renewalOptions),
  };
}
