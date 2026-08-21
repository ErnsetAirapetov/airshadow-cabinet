import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { subscriptionApi } from '@/api/subscription';
import { useTheme } from '@/hooks/useTheme';
import { getGlassColors } from '@/utils/glassTheme';
import { WebBackButton } from '../components/WebBackButton';
import { TariffCatalogSection } from '../components/subscription/purchase/TariffCatalogSection';
import {
  resolvePurchaseBackTarget,
  resolvePurchaseScreen,
  resolvePurchaseSubscriptionId,
  resolvePurchaseTitleKey,
} from './subscriptionPurchaseState';

/**
 * Покупка и продление подписки в простом режиме (задача #29).
 *
 * ⚠️ Это НЕ новый интерфейс, а копия апстримного
 * `src/pages/SubscriptionPurchase.tsx`. Спека владельца от 18.08.2026 меняет на
 * этом экране ровно один блок: из витрины тарифов убран виджет промо-группы
 * («Ваша группа: …»). Больше ничего не правим — так в спеке дословно.
 *
 * Изъятие живёт в копии витрины
 * (`../components/subscription/purchase/TariffPickerGrid`), а не здесь:
 * апстримный блок был внутри неё. Оригиналы всех четырёх компонентов остаются
 * экспертному режиму нетронутыми — канон docs/architecture/two-modes.md.
 *
 * ⚠️ Сам каталог (сетка тарифов → форма покупки, лист смены тарифа,
 * классический мастер, пустое состояние) с #69 уехал в общую секцию
 * `TariffCatalogSection`: тот же блок показывает единый экран оплаты, когда
 * тариф подписки отвалился. Второй копии этого блока быть не должно — она
 * разошлась бы молча, урок #61.
 *
 * ⚠️ Обе ветки режима продаж обязаны работать. На стенде видна только тарифная,
 * но `sales_mode: 'classic'` — единственный способ купить подписку на
 * инсталляции без тарифов, и потеряй мы её, экран там окажется пустым. Выбор
 * ветки поэтому вынесен в `./subscriptionPurchaseState` и покрыт тестами.
 *
 * ⚠️ Хром апстримный: `getGlassColors` + классы напрямую. Анимационные варианты
 * `@/components/motion/transitions` за границей режимов — тот же приём, что в
 * остальных простых страницах.
 */
export function SimpleSubscriptionPurchase() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const subscriptionId = resolvePurchaseSubscriptionId(searchParams);
  const { isDark } = useTheme();
  const g = getGlassColors(isDark);

  // Subscription query (shares cache with /subscription page)
  const { data: subscriptionResponse, isLoading } = useQuery({
    queryKey: ['subscription', subscriptionId],
    queryFn: () => subscriptionApi.getSubscription(subscriptionId),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const subscription = subscriptionResponse?.subscription ?? null;

  // Purchase options
  const {
    data: purchaseOptions,
    isLoading: optionsLoading,
    isError: optionsError,
    refetch: refetchOptions,
  } = useQuery({
    queryKey: ['purchase-options', subscriptionId],
    queryFn: () => subscriptionApi.getPurchaseOptions(subscriptionId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Multi-tariff: check via subscriptions list query
  const { data: multiSubData } = useQuery({
    queryKey: ['subscriptions-list'],
    queryFn: () => subscriptionApi.getSubscriptions(),
    staleTime: 60_000,
  });
  const isMultiTariff = multiSubData?.multi_tariff_enabled ?? false;

  // Выбор ветки продаж и состояния экрана — в чистом модуле рядом.
  const screen = resolvePurchaseScreen({
    isSubscriptionLoading: isLoading,
    isOptionsLoading: optionsLoading,
    isOptionsError: optionsError,
    purchaseOptions,
  });
  if (screen === 'loading') {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      </div>
    );
  }

  if (screen === 'error') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">{t('subscription.extend')}</h1>
        <div
          className="rounded-3xl p-6 text-center"
          style={{
            background: g.cardBg,
            border: `1px solid ${g.cardBorder}`,
          }}
        >
          <p className="mb-4 text-dark-300">
            {t('subscription.loadError', 'Не удалось загрузить варианты подписки')}
          </p>
          <button
            onClick={() => refetchOptions()}
            className="rounded-xl bg-accent-500 px-6 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-600"
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <WebBackButton to={resolvePurchaseBackTarget(subscriptionId)} />
        <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">
          {t(resolvePurchaseTitleKey({ isMultiTariff, subscriptionId, subscription }))}
        </h1>
      </div>

      <TariffCatalogSection
        subscription={subscription}
        subscriptionId={subscriptionId}
        purchaseOptions={purchaseOptions}
        isMultiTariff={isMultiTariff}
        onRetry={() => refetchOptions()}
      />
    </div>
  );
}
