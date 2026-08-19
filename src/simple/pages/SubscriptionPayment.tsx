import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';

import { subscriptionApi } from '@/api/subscription';
import { useCurrency } from '@/hooks/useCurrency';
import { usePromoDiscount } from '@/hooks/usePromoDiscount';
import { useTheme } from '@/hooks/useTheme';
import { useHaptic } from '@/platform';
import { getGlassColors } from '@/utils/glassTheme';
import { getMonthlyPriceKopeks } from '@/utils/pricing';
import { BalanceWidget, useBalanceQuery } from '../components/BalanceWidget';
import InsufficientBalancePrompt from '../components/InsufficientBalancePrompt';
import { WebBackButton } from '../components/WebBackButton';
import { TariffCatalogSection } from '../components/subscription/purchase/TariffCatalogSection';
import { resolvePaymentPlan, resolvePaymentTitleKey, resolvePeriodPrice } from './paymentState';
import {
  resolveMissingAmountKopeks,
  resolveRenewBalance,
  resolveRenewOptionState,
  resolveRenewSubscriptionId,
} from './renewState';
import { resolvePurchaseScreen, resolveSalesMode } from './subscriptionPurchaseState';

/**
 * ЕДИНЫЙ экран оплаты подписки простого режима (задача #69).
 *
 * ⚠️ До #69 оплата жила на двух разных экранах: продление — здесь, покупка
 * тарифа — в витрине. Владелец забраковал это дословно: «для пользователя без
 * разницы, продлевает он истёкшую или докупает действующую, интерфейс должен
 * быть одинаковым». Поэтому вид у экрана ОДИН — список сроков и кнопка оплаты,
 * — а операцию выбирает состояние подписки, а не адрес, с которого пришли.
 *
 * ⚠️ Новых маршрутов задача не заводит: адрес остался апстримным
 * (`/subscriptions/:subscriptionId/renew`), изменилось только то, что на нём
 * рисует простой режим. Сюда ведут ОБА входа — «Продлить подписку» у активной
 * и кнопка оплаты у непродлеваемой (`expiredAction.ts`, ветка `openPurchase`).
 *
 * ⚠️ Всё ветвление — в `./paymentState`, страница поверх него тонкая. Иначе его
 * нечем проверить: состояние «тариф отвалился» на стенде не воспроизвести, и
 * глазами эту ветку не увидит никто.
 *
 * ⚠️ Ловушка двух источников баланса закрыта ещё в #29 и остаётся закрытой:
 * виджет и расчёт доступности получают ОДНО число из одного вызова
 * `resolveRenewBalance`. Запрос `purchase-options` на экране теперь есть, но он
 * здесь ради каталога тарифов; `balance_kopeks` из него страница не читает —
 * его читает только форма покупки внутри секции каталога.
 */
export function SimpleSubscriptionPayment() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>();
  const subId = resolveRenewSubscriptionId(subscriptionId);

  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const g = getGlassColors(isDark);
  const { formatAmount, currencySymbol } = useCurrency();
  const { applyPromoDiscount } = usePromoDiscount();
  const { impact } = useHaptic();

  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Подписка — источник статуса и тарифа, по которым выбирается операция.
  const { data: subscriptionResponse, isLoading: isSubscriptionLoading } = useQuery({
    queryKey: ['subscription', subId],
    queryFn: () => subscriptionApi.getSubscription(subId),
    enabled: !!subId,
    staleTime: 30_000,
  });
  const subscription = subscriptionResponse?.subscription ?? null;

  // Цены продления. Для непродлеваемых статусов бэкенд отдаёт пустой список —
  // разбирается это в `resolvePaymentPlan`, а не здесь.
  const { data: renewalOptions } = useQuery({
    queryKey: ['renewal-options', subId],
    queryFn: () => subscriptionApi.getRenewalOptions(subId),
    enabled: !!subId,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Каталог тарифов — второй источник цен и сетка выбора при отвалившемся тарифе.
  const {
    data: purchaseOptions,
    isLoading: isOptionsLoading,
    isError: isOptionsError,
    refetch: refetchOptions,
  } = useQuery({
    queryKey: ['purchase-options', subId],
    queryFn: () => subscriptionApi.getPurchaseOptions(subId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: multiSubData } = useQuery({
    queryKey: ['subscriptions-list'],
    queryFn: () => subscriptionApi.getSubscriptions(),
    staleTime: 60_000,
  });
  const isMultiTariff = multiSubData?.multi_tariff_enabled ?? false;

  // ⚠️ Баланс — ТОТ ЖЕ запрос, который читает виджет (`['balance']`), и то же
  // самое число: показ и расчёт доступности расходятся здесь дороже всего.
  const { data: balanceData } = useBalanceQuery();
  const renewBalance = resolveRenewBalance(balanceData);

  const { isTariffsMode, tariffs } = resolveSalesMode(purchaseOptions);

  const screen = resolvePurchaseScreen({
    isSubscriptionLoading,
    isOptionsLoading,
    isOptionsError,
    purchaseOptions,
  });

  const plan = resolvePaymentPlan({
    subscription: isSubscriptionLoading ? undefined : subscription,
    renewalOptions,
    tariffs: purchaseOptions === undefined ? undefined : tariffs,
    isTariffsMode,
  });

  // ⚠️ Мутация ОДНА на обе операции. Две кнопки с разными обработчиками и были
  // тем самым «двумя экранами», от которых уходит задача: разойтись им негде,
  // только если оплата у них одна.
  // ⚠️ Результат мутации намеренно `unknown`: два эндпоинта отвечают разными
  // телами, а экрану ни одно из них не нужно — он перечитывает подписку.
  // Общий тип ответа заставил бы выбрать один из двух и соврать про другой.
  const payMutation = useMutation<unknown, unknown, number>({
    mutationFn: (periodDays: number): Promise<unknown> => {
      if (plan.screen === 'periods' && plan.operation === 'purchaseTariff') {
        // ⚠️ `subId` в запросе обязателен: без него бэкенд ищет строку по
        // `(user_id, tariff_id)` и проигрывает гонку с вебхуками панели —
        // это всплывало как «Тариф уже активен» плюс возврат средств.
        return subscriptionApi.purchaseTariff(plan.tariffId, periodDays, undefined, subId);
      }

      return subscriptionApi.renewSubscription(periodDays, subId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription', subId] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['renewal-options', subId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      navigate(`/subscriptions/${subId}`, { replace: true });
    },
    onError: (err: unknown) => {
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? ((err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail ?? null)
          : null;

      if (detail && typeof detail === 'object' && 'code' in (detail as Record<string, unknown>)) {
        const typed = detail as { code: string; missing_amount?: number };
        if (typed.code === 'insufficient_funds' && typed.missing_amount) {
          setError(`insufficient:${typed.missing_amount}`);
          return;
        }
      }
      setError(typeof detail === 'string' ? detail : t('common.error'));
    },
  });

  const handlePay = (periodDays: number) => {
    impact('medium');
    setError(null);
    payMutation.mutate(periodDays);
  };

  if (!subId) {
    return <Navigate to="/subscriptions" replace />;
  }

  if (screen === 'loading' || plan.screen === 'pending') {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      </div>
    );
  }

  if (screen === 'error') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold" style={{ color: g.text }}>
          {t('subscription.extend')}
        </h1>
        <div
          className="rounded-3xl p-6 text-center"
          style={{ background: g.cardBg, border: `1px solid ${g.cardBorder}` }}
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

  const missingAmount = resolveMissingAmountKopeks(error);

  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="flex items-center gap-3">
        <WebBackButton to={`/subscriptions/${subId}`} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: g.text }}>
            {t(resolvePaymentTitleKey(plan))}
          </h1>
          {subscription?.tariff_name && (
            <p className="mt-1 text-sm" style={{ color: g.textSecondary }}>
              {subscription.tariff_name}
            </p>
          )}
        </div>
      </div>

      {/* Баланс — общий виджет. Число ему передаётся, а не запрашивается им
          самим: то же самое значение считает доступность периодов ниже. */}
      <BalanceWidget balanceRubles={renewBalance.rubles} />

      {/* Платить нечем: тариф подписки отвалился либо цен не пришло ни из
          одного источника. Показываем ту же сетку выбора, что и «Оформить
          подписку», и баннер над ней — решение принимает `resolvePaymentPlan`,
          своего условия у разметки нет. */}
      {plan.screen === 'pickTariff' ? (
        <TariffCatalogSection
          subscription={subscription}
          subscriptionId={subId}
          purchaseOptions={purchaseOptions}
          isMultiTariff={isMultiTariff}
          onRetry={() => refetchOptions()}
          unsupportedTariffBanner={plan.unsupportedTariffBanner}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {plan.periods.map((period) => {
            const isSelected = selectedPeriod === period.periodDays;
            // ⚠️ Промо-скидка применяется ТОЛЬКО к ценам каталога: в ценах
            // продления бэкенд её уже учёл, и второй раз она стоила бы
            // расхождения показанной суммы со списанной.
            const price = resolvePeriodPrice(
              period,
              plan.promoDiscountable
                ? applyPromoDiscount(period.priceKopeks, period.originalPriceKopeks)
                : null,
            );
            const { canAfford, missingKopeks } = resolveRenewOptionState(
              renewBalance.kopeks,
              price.priceKopeks,
            );
            const perMonth = getMonthlyPriceKopeks(price.priceKopeks, period.periodDays);

            return (
              <button
                key={period.periodDays}
                onClick={() => {
                  impact('light');
                  setSelectedPeriod(period.periodDays);
                  setError(null);
                }}
                className="w-full rounded-2xl border p-4 text-left transition-all duration-200"
                style={{
                  background: isSelected
                    ? isDark
                      ? 'rgba(var(--color-accent-400), 0.08)'
                      : 'rgba(var(--color-accent-400), 0.05)'
                    : g.cardBg,
                  borderColor: isSelected ? 'rgb(var(--color-accent-400))' : g.cardBorder,
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-base font-semibold" style={{ color: g.text }}>
                      {period.periodDays} {t('subscription.days', 'дней')}
                    </span>
                    {price.discountPercent > 0 && (
                      <span className="ml-2 rounded-full bg-success-400/15 px-2 py-0.5 text-[10px] font-semibold text-success-400">
                        -{price.discountPercent}%
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold" style={{ color: g.text }}>
                      {price.priceKopeks === 0
                        ? t('subscription.free', 'Бесплатно')
                        : `${formatAmount(price.priceKopeks / 100)} ${currencySymbol}`}
                    </div>
                    {perMonth !== null && (
                      <div className="text-[11px]" style={{ color: g.textSecondary }}>
                        {formatAmount(perMonth / 100)} {currencySymbol}/
                        {t('subscription.month', 'мес')}
                      </div>
                    )}
                    {price.originalPriceKopeks && (
                      <div className="text-[11px] line-through" style={{ color: g.textSecondary }}>
                        {formatAmount(price.originalPriceKopeks / 100)} {currencySymbol}
                      </div>
                    )}
                  </div>
                </div>
                {!canAfford && (
                  <div className="mt-1 text-[11px] text-error-400">
                    {t(
                      'subscription.insufficientBalanceAmount',
                      'Недостаточно средств. Не хватает {{missing}}',
                      {
                        missing: `${formatAmount(missingKopeks / 100)} ${currencySymbol}`,
                      },
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Insufficient balance prompt */}
      {missingAmount && <InsufficientBalancePrompt missingAmountKopeks={missingAmount} compact />}

      {/* Error */}
      {error && !missingAmount && (
        <div className="rounded-xl bg-error-400/10 p-3 text-center text-sm text-error-400">
          {error}
        </div>
      )}

      {/* Оплата. Кнопка ОДНА на обе операции — разница только в том, какой
          эндпоинт зовёт `payMutation`. */}
      {plan.screen === 'periods' && selectedPeriod && (
        <button
          onClick={() => handlePay(selectedPeriod)}
          disabled={payMutation.isPending}
          className="w-full rounded-2xl bg-accent-500 py-3.5 text-base font-semibold text-on-accent transition-colors hover:bg-accent-600 disabled:opacity-50"
        >
          {payMutation.isPending
            ? t('common.processing', 'Обработка...')
            : t('subscription.extend', 'Продлить подписку')}
        </button>
      )}
    </div>
  );
}
