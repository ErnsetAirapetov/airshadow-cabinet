import type { ClassicPurchaseOptions, PurchaseOptions, Subscription, Tariff } from '@/types';

/**
 * Ветвящаяся логика простого экрана покупки (задача #29).
 *
 * ⚠️ Модуль чистый и импортирует из `@/types` ТОЛЬКО типы: `import type`
 * стирается при трансформации, поэтому alias `@/` тесту разрешать не нужно —
 * его в `vitest.config.ts` нет, а трогать апстримный конфиг запрещено
 * (docs/architecture/two-modes.md, раздел «Тесты»).
 *
 * Зачем вообще: компонентных тестов в проекте не бывает, а на экране покупки
 * ветвится самое дорогое — РЕЖИМ ПРОДАЖ. Их два, тарифный и классический; на
 * стенде виден только тарифный, но на другой инсталляции классический —
 * единственный способ купить подписку. Ошибка в этом выборе даёт пустой экран,
 * который никакая сборка не поймает. Поэтому правило живёт здесь, а страница —
 * тонкая оболочка над ним.
 *
 * Правила перенесены из апстримного `src/pages/SubscriptionPurchase.tsx` как
 * есть: спека владельца от 18.08.2026 меняет на этом экране ровно один блок —
 * виджет промо-группы в витрине тарифов.
 */

/** Что рисует экран: спиннер, ошибку загрузки или содержимое. */
export type PurchaseScreen = 'loading' | 'error' | 'content';

export function resolvePurchaseScreen(input: {
  isSubscriptionLoading: boolean;
  isOptionsLoading: boolean;
  isOptionsError: boolean;
  purchaseOptions: PurchaseOptions | undefined;
}): PurchaseScreen {
  if (input.isSubscriptionLoading || input.isOptionsLoading) {
    return 'loading';
  }

  // ⚠️ `!purchaseOptions && !isOptionsLoading` — не тавтология после проверки
  // выше, а второй случай ошибки: запрос завершился, но данных нет. Без него
  // экран рисовал бы содержимое по `undefined`.
  if (input.isOptionsError || (!input.purchaseOptions && !input.isOptionsLoading)) {
    return 'error';
  }

  return 'content';
}

export interface PurchaseSalesMode {
  /** Тарифный режим продаж — витрина тарифов вместо классического мастера. */
  isTariffsMode: boolean;
  tariffs: Tariff[];
  classicOptions: ClassicPurchaseOptions | null;
  showTariffsSection: boolean;
  showClassicSection: boolean;
  /** Данные пришли, но купить нечего — обе ветки пусты. */
  showNoOptionsFallback: boolean;
}

/**
 * Разбор ответа `/cabinet/subscription/purchase-options` на две ветки продаж.
 *
 * ⚠️ `sales_mode` — единственный признак: `'tariffs'` даёт витрину тарифов,
 * всё остальное (включая `'classic'`) — классический мастер. Так у апстрима,
 * и переизобретать это правило нельзя: бэкенд решает, что показывать.
 */
export function resolveSalesMode(purchaseOptions: PurchaseOptions | undefined): PurchaseSalesMode {
  const isTariffsMode = purchaseOptions?.sales_mode === 'tariffs';
  const classicOptions = !isTariffsMode
    ? ((purchaseOptions as ClassicPurchaseOptions | undefined) ?? null)
    : null;
  const tariffs =
    isTariffsMode && purchaseOptions && 'tariffs' in purchaseOptions ? purchaseOptions.tariffs : [];

  const showTariffsSection = isTariffsMode && tariffs.length > 0;
  // Опциональная цепочка вместо апстримного `classicOptions.periods.length`:
  // отличие видно только там, где апстрим упал бы с исключением на ответе без
  // `periods`. Поведение на штатных ответах то же.
  const showClassicSection = (classicOptions?.periods?.length ?? 0) > 0;

  return {
    isTariffsMode,
    tariffs,
    classicOptions,
    showTariffsSection,
    showClassicSection,
    showNoOptionsFallback:
      purchaseOptions !== undefined && !showTariffsSection && !showClassicSection,
  };
}

/**
 * Ключ заголовка экрана.
 *
 * Лестница апстримная и порядок в ней важен: мультитариф без конкретной
 * подписки — «Новый тариф», посуточный не-триал — «Сменить тариф», активная
 * не-триальная подписка — «Продлить», иначе — «Получить подписку».
 *
 * Апстрим передаёт `t('subscription.newTariff', 'Новый тариф')` со значением по
 * умолчанию; здесь его нет, потому что ключ заведён во всех четырёх апстримных
 * локалях — фолбэк был бы мёртвым кодом.
 */
export function resolvePurchaseTitleKey(input: {
  isMultiTariff: boolean;
  subscriptionId: number | undefined;
  subscription: Subscription | null;
}): string {
  const { isMultiTariff, subscriptionId, subscription } = input;

  if (isMultiTariff && !subscriptionId) {
    return 'subscription.newTariff';
  }
  if (!isMultiTariff && subscription?.is_daily && !subscription?.is_trial) {
    return 'subscription.switchTariff.title';
  }
  if (subscription && !subscription.is_trial) {
    return 'subscription.extend';
  }
  return 'subscription.getSubscription';
}

/** Куда ведёт кнопка «назад»: к своей подписке или к списку. */
export function resolvePurchaseBackTarget(subscriptionId: number | undefined): string {
  return subscriptionId ? `/subscriptions/${subscriptionId}` : '/subscriptions';
}

/**
 * `?subscriptionId=N` из адреса — «продлить именно эту подписку».
 *
 * Принимает не `URLSearchParams`, а минимальный контракт `{ get }`: так функция
 * остаётся чистой и тестируемой без DOM.
 */
export function resolvePurchaseSubscriptionId(searchParams: {
  get(name: string): string | null;
}): number | undefined {
  const raw = searchParams.get('subscriptionId');
  if (!raw) {
    return undefined;
  }

  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
