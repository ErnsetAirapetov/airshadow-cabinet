import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ExclamationIcon } from '@/components/icons';
import { useTheme } from '@/hooks/useTheme';
import { useCloseOnSuccessNotification } from '@/store/successNotification';
import type { PurchaseOptions, Subscription, Tariff } from '@/types';
import { getGlassColors } from '@/utils/glassTheme';
import { SIMPLE_NS } from '../../../i18n';
import { resolveSalesMode } from '../../../pages/subscriptionPurchaseState';
import { resolveCatalogBanners } from './catalogBanners';
import { SwitchTariffSheet } from '../sheets/SwitchTariffSheet';
import { ClassicPurchaseWizard } from './ClassicPurchaseWizard';
import { TariffPickerGrid } from './TariffPickerGrid';
import { TariffPurchaseForm } from './TariffPurchaseForm';

/**
 * Каталог подписок простого режима: сетка тарифов → форма покупки (задача #69).
 *
 * ⚠️ Секция ОДНА на два экрана — витрину `/subscription/purchase` и единый
 * экран оплаты `/subscriptions/:id/renew`, куда она попадает в состоянии
 * «тариф отвалился». До #69 весь этот блок жил разметкой страницы покупки, и
 * второму экрану пришлось бы его повторить. Урок #61 здесь дословный: две
 * копии одного блока разошлись молча при зелёной сборке, и владелец увидел это
 * на стенде.
 *
 * ⚠️ Переход «сразу к форме, минуя сетку» тоже ОДИН и живёт здесь: и обычный
 * выбор тарифа (`onSelectTariff`), и возврат из листа смены тарифа
 * (`onExpiredFallback`) кладут выбранный тариф в одно и то же состояние.
 * Второй реализации этого перехода задача заводить запрещает.
 *
 * ⚠️ Различия мест вызова — ПРОПАМИ, ветки «на витрине / на экране оплаты»
 * внутри нет. Единственное различие сегодня — баннер `unsupportedTariffBanner`.
 *
 * ⚠️ Какие предупреждения показать — считает `resolveCatalogBanners` (#71), а не
 * разметка. До #71 у двух баннеров были два независимых условия, и у подписки со
 * снятым тарифом срабатывали ОБА: человек читал подряд «ваш тариф больше не
 * поддерживается, выберите другой» и «подписка истекла, выберите тариф ниже».
 */

export interface TariffCatalogSectionProps {
  subscription: Subscription | null;
  subscriptionId: number | undefined;
  purchaseOptions: PurchaseOptions | undefined;
  isMultiTariff: boolean;
  /** Повторить запрос вариантов — кнопка пустого состояния. */
  onRetry: () => void;
  /**
   * Баннер «ваш тариф больше не поддерживается» (#69).
   *
   * ⚠️ Решение о показе принимает ВЫЗЫВАЮЩИЙ экран (`resolvePaymentPlan`), а не
   * секция: человеку без подписки вовсе это сообщение — ложь, и своего условия
   * у разметки быть не должно, оно разъехалось бы с правилом молча.
   */
  unsupportedTariffBanner?: boolean;
}

export function TariffCatalogSection({
  subscription,
  subscriptionId,
  purchaseOptions,
  isMultiTariff,
  onRetry,
  unsupportedTariffBanner = false,
}: TariffCatalogSectionProps) {
  const { t } = useTranslation();
  const { t: tSimple } = useTranslation(SIMPLE_NS);
  const { isDark } = useTheme();
  const g = getGlassColors(isDark);

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

  const banners = resolveCatalogBanners({
    unsupportedTariff: unsupportedTariffBanner,
    subscriptionExpired:
      purchaseOptions !== undefined &&
      'subscription_is_expired' in purchaseOptions &&
      purchaseOptions.subscription_is_expired === true,
    tariffSelected: showTariffPurchase,
  });

  const {
    isTariffsMode,
    tariffs,
    classicOptions,
    showTariffsSection,
    showClassicSection,
    showNoOptionsFallback,
  } = resolveSalesMode(purchaseOptions);

  return (
    <>
      {/* Баннер «тариф больше не поддерживается» (#69).
          ⚠️ Стоит НАД карточкой, а не внутри неё: при пустом каталоге или
          классическом режиме карточки тарифов не будет вовсе, и баннер,
          вложенный в неё, пропал бы вместе с ней — то есть ровно в том
          состоянии, ради которого заведён.
          ⚠️ Скрывается, когда человек уже выбрал тариф: на форме оплаты речь
          идёт про новый тариф, и напоминание про старый там лишнее — это и
          считает `resolveCatalogBanners`, своего условия у разметки нет. */}
      {banners.unsupportedTariff && (
        <div
          className="rounded-[14px] p-4"
          role="status"
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
                {tSimple('subscription.unsupportedTariff.title')}
              </div>
              <div className="mt-1 text-[12px]" style={{ color: g.textSecondary }}>
                {tSimple('subscription.unsupportedTariff.hint')}
              </div>
            </div>
          </div>
        </div>
      )}

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
              файле: правка форка откачена к апстриму (решение оркестратора по
              задаче #29), и экспертный режим блок себе вернул. Предупреждения
              об истёкшей и legacy-подписке остаются — они несут информацию. */}

          {/* Апстримный блок «подписка истекла».
              ⚠️ Молчит, когда сказать есть что точнее: у подписки со снятым
              тарифом баннер выше говорит ровно то же самое («выберите тариф»),
              но называет причину. Решение — в `resolveCatalogBanners` (#71). */}
          {banners.expired && (
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
            onClick={onRetry}
            className="rounded-xl bg-accent-500 px-6 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-600"
          >
            {t('common.retry')}
          </button>
        </div>
      )}
    </>
  );
}
