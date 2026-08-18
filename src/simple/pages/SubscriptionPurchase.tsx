import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { subscriptionApi } from '@/api/subscription';
import { ExclamationIcon } from '@/components/icons';
import { useTheme } from '@/hooks/useTheme';
import { useCloseOnSuccessNotification } from '@/store/successNotification';
import type { Tariff } from '@/types';
import { getGlassColors } from '@/utils/glassTheme';
import { WebBackButton } from '../components/WebBackButton';
import { ClassicPurchaseWizard } from '../components/subscription/purchase/ClassicPurchaseWizard';
import { TariffPickerGrid } from '../components/subscription/purchase/TariffPickerGrid';
import { TariffPurchaseForm } from '../components/subscription/purchase/TariffPurchaseForm';
import { SwitchTariffSheet } from '../components/subscription/sheets/SwitchTariffSheet';
import {
  resolvePurchaseBackTarget,
  resolvePurchaseScreen,
  resolvePurchaseSubscriptionId,
  resolvePurchaseTitleKey,
  resolveSalesMode,
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
 * ⚠️ Обе ветки режима продаж обязаны работать. На стенде видна только тарифная,
 * но `sales_mode: 'classic'` — единственный способ купить подписку на
 * инсталляции без тарифов, и потеряй мы её, экран там окажется пустым. Выбор
 * ветки поэтому вынесен в `./subscriptionPurchaseState` и покрыт тестами: сам
 * экран отрисовкой не проверяется — компонентных тестов в проекте не бывает.
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

  // Tariffs mode state
  const [selectedTariff, setSelectedTariff] = useState<Tariff | null>(null);
  const [showTariffPurchase, setShowTariffPurchase] = useState(false);

  // Tariff switch
  const [switchTariffId, setSwitchTariffId] = useState<number | null>(null);

  // Auto-close all modals on success notification
  const handleCloseAllModals = () => {
    setShowTariffPurchase(false);
    setSwitchTariffId(null);
    setSelectedTariff(null);
  };
  useCloseOnSuccessNotification(handleCloseAllModals);

  // Выбор ветки продаж и состояния экрана — в чистом модуле рядом.
  const screen = resolvePurchaseScreen({
    isSubscriptionLoading: isLoading,
    isOptionsLoading: optionsLoading,
    isOptionsError: optionsError,
    purchaseOptions,
  });
  const {
    isTariffsMode,
    tariffs,
    classicOptions,
    showTariffsSection,
    showClassicSection,
    showNoOptionsFallback,
  } = resolveSalesMode(purchaseOptions);

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

      {/* Tariffs Section */}
      {showTariffsSection && (
        <div
          className="relative overflow-hidden rounded-3xl"
          style={{
            background: g.cardBg,
            border: `1px solid ${g.cardBorder}`,
            boxShadow: g.shadow,
            padding: '24px 28px',
          }}
        >
          {/* Блок «Выберите тариф для продолжения» (`subscription.trialUpgrade`)
              убран: он занимал верх экрана, повторяя то, что и так очевидно из
              списка тарифов ниже. Апстримный блок стоял ровно здесь — см.
              оригинал `src/pages/SubscriptionPurchase.tsx`.

              ⚠️ Обоснование переехало сюда из комментария в самом апстримном
              файле: правка форка откачена к апстриму в этом же MR (решение
              оркестратора по задаче #29), и экспертный режим блок себе вернул.
              Предупреждения об истёкшей и legacy-подписке остаются — они несут
              информацию. */}

          {/* Expired subscription notice */}
          {purchaseOptions &&
            'subscription_is_expired' in purchaseOptions &&
            purchaseOptions.subscription_is_expired && (
              <div
                className="mb-6 rounded-[14px] p-4"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,59,92,0.08), rgba(255,184,0,0.06))',
                  border: '1px solid rgba(255,59,92,0.15)',
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
                    style={{
                      background: 'rgba(255,59,92,0.12)',
                      color: 'rgb(var(--color-critical-500))',
                    }}
                  >
                    <ExclamationIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <div
                      className="text-sm font-semibold"
                      style={{ color: 'rgb(var(--color-critical-500))' }}
                    >
                      {t('subscription.expiredBanner.title')}
                    </div>
                    <div className="mt-1 text-[12px] text-dark-50/40">
                      {t('subscription.expiredBanner.selectTariff')}
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* Legacy subscription notice */}
          {subscription && !subscription.is_trial && !subscription.tariff_id && (
            <div className="mb-6 rounded-xl border border-accent-500/30 bg-accent-500/10 p-4">
              <div className="mb-2 font-medium text-accent-400">
                {t('subscription.legacy.selectTariffTitle')}
              </div>
              <div className="text-sm text-dark-300">
                {t('subscription.legacy.selectTariffDescription')}
              </div>
              <div className="mt-2 text-xs text-dark-500">
                {t('subscription.legacy.currentSubContinues')}
              </div>
            </div>
          )}

          {/* Switch Tariff Preview Modal */}
          <SwitchTariffSheet
            open={switchTariffId !== null}
            tariffId={switchTariffId}
            subscriptionId={subscriptionId}
            tariffs={tariffs}
            onClose={() => setSwitchTariffId(null)}
            onExpiredFallback={(tariff) => {
              setSelectedTariff(tariff);
              setShowTariffPurchase(true);
            }}
          />

          {!showTariffPurchase ? (
            <TariffPickerGrid
              tariffs={tariffs}
              subscription={subscription}
              purchaseOptions={purchaseOptions}
              isTariffsMode={isTariffsMode}
              isMultiTariff={isMultiTariff}
              onSelectTariff={(tariff) => {
                setSelectedTariff(tariff);
                setShowTariffPurchase(true);
              }}
              onSwitchTariff={(tariffId) => setSwitchTariffId(tariffId)}
            />
          ) : (
            selectedTariff && (
              <TariffPurchaseForm
                key={selectedTariff.id}
                tariff={selectedTariff}
                subscriptionId={subscriptionId}
                balanceKopeks={purchaseOptions?.balance_kopeks}
                sbpPurchaseEnabled={
                  isTariffsMode &&
                  purchaseOptions !== undefined &&
                  'platega_recurrent_enabled' in purchaseOptions &&
                  purchaseOptions.platega_recurrent_enabled === true
                }
                lavaPurchaseEnabled={
                  isTariffsMode &&
                  purchaseOptions !== undefined &&
                  'lava_recurrent_enabled' in purchaseOptions &&
                  purchaseOptions.lava_recurrent_enabled === true
                }
                onBack={() => {
                  setShowTariffPurchase(false);
                  setSelectedTariff(null);
                }}
              />
            )
          )}
        </div>
      )}

      {/* Purchase/Extend Section - Classic Mode */}
      {showClassicSection && classicOptions && (
        <ClassicPurchaseWizard
          classicOptions={classicOptions}
          subscription={subscription}
          subscriptionId={subscriptionId}
        />
      )}

      {/* No options available fallback */}
      {showNoOptionsFallback && (
        <div
          className="rounded-3xl p-6 text-center"
          style={{
            background: g.cardBg,
            border: `1px solid ${g.cardBorder}`,
          }}
        >
          <p className="mb-4 text-dark-300">
            {t('subscription.noOptionsAvailable', 'Нет доступных вариантов подписки')}
          </p>
          <button
            onClick={() => refetchOptions()}
            className="rounded-xl bg-accent-500 px-6 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-600"
          >
            {t('common.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
