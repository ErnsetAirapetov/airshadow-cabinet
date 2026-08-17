import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router';

import { balanceApi } from '@/api/balance';
import { ChevronDownIcon, WalletIcon } from '@/components/icons';
import { Button } from '@/components/primitives/Button';
import { useCurrency } from '@/hooks/useCurrency';
import { useAuthStore } from '@/store/auth';
import type { PaginatedResponse, Transaction } from '@/types';
import { uiLocale } from '@/utils/uiLocale';
import { BalanceWidget, useBalanceQuery } from '../components/BalanceWidget';
import { PaymentMethodsGrid } from '../components/PaymentMethodsGrid';
import { SIMPLE_NS } from '../i18n';
import {
  resolvePaymentReturnRedirect,
  resolvePromocodeErrorKey,
  resolveTransactionAmount,
  resolveTransactionBadge,
  resolveTransactionLabelKey,
} from './balanceState';

/**
 * Баланс и пополнение в простом режиме.
 *
 * ⚠️ Это НЕ новый интерфейс, а копия апстримного `src/pages/Balance.tsx` с
 * перекомпоновкой блоков по спеке владельца (задача #30). Оригинал остаётся
 * экспертному режиму нетронутым.
 *
 * Порядок блоков: баланс → способы пополнения → промокод → история. Относительно
 * апстрима промокод и способы пополнения поменялись местами: пополняют баланс
 * несравнимо чаще, чем вводят промокод.
 *
 * Выкинут блок навигации к сохранённым картам вместе с запросом `['saved-cards']`:
 * канон относит сохранённые карты к экспертному режиму
 * (docs/architecture/two-modes.md, «Состав простого режима»), а лишний запрос на
 * странице тоже не нужен.
 *
 * Экран суммы пополнения (`/balance/top-up/:methodId`) с задачи #53 тоже простой —
 * `src/simple/pages/TopUpAmount.tsx`, и блок баланса у них общий
 * (`src/simple/components/BalanceWidget.tsx`). Выбор способа (`/balance/top-up`) с
 * задачи #55 тоже наш — `src/simple/pages/TopUpMethodSelect.tsx`, и карточки
 * способов у них общие (`src/simple/components/PaymentMethodsGrid.tsx`). Апстримным
 * остаётся только результат оплаты (`/balance/top-up/result*`): спеки на него нет.
 *
 * ⚠️ Хром блоков страницы — глобальные классы `bento-card` / `bento-card-hover` из
 * `src/styles/globals.css`, а не апстримный `Card` из `components/data-display`:
 * он за границей режимов и тянет за собой `components/motion/transitions`, `cva`
 * и radix-slot. Классы повторяют вид апстримного `Card` (та же база
 * `border-dark-700/40 bg-dark-900/70`, тот же `--bento-radius`, тот же inset-блик,
 * а `-hover` — то же поведение варианта `interactive`), и на них же собрана
 * простая главная.
 */
export function SimpleBalance() {
  const { t } = useTranslation();
  // Строки, унаследованные от апстримной страницы, продолжают читаться из общего
  // словаря; в нашем неймспейсе живут только НАШИ ключи.
  const { t: tSimple } = useTranslation(SIMPLE_NS);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const queryClient = useQueryClient();
  const { formatAmount, currencySymbol } = useCurrency();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const paymentHandledRef = useRef(false);

  // Данные баланса читает виджет; странице нужен только `refetch` после
  // активации промокода. Параметры запроса объявлены в одном месте — рядом с
  // виджетом, — поэтому два наблюдателя одного ключа не разъедутся.
  const { refetch: refetchBalance } = useBalanceQuery();

  // Обновляем пользователя на маунте, чтобы баланс в стору совпал с экраном.
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // ⚠️ Перехват возврата от платёжного шлюза. Обязателен: провайдер возвращает
  // человека на `/balance` с параметрами результата, и без этого он видит баланс,
  // не понимая, прошла оплата или нет. `paymentHandledRef` защищает от повторной
  // обработки, `replace` не оставляет платёжный возврат в истории.
  useEffect(() => {
    if (paymentHandledRef.current) return;

    const redirect = resolvePaymentReturnRedirect(searchParams);
    if (redirect) {
      paymentHandledRef.current = true;
      navigate(redirect, { replace: true });
    }
  }, [searchParams, navigate]);

  const [promocode, setPromocode] = useState('');
  const [promocodeLoading, setPromocodeLoading] = useState(false);
  const [promocodeError, setPromocodeError] = useState<string | null>(null);
  const [promocodeSuccess, setPromocodeSuccess] = useState<{
    message: string;
    amount: number;
  } | null>(null);
  const [promoSelectSubs, setPromoSelectSubs] = useState<Array<{
    id: number;
    tariff_name: string;
    days_left: number;
    status?: string;
  }> | null>(null);
  const [promoSelectCode, setPromoSelectCode] = useState<string | null>(null);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const { data: transactions, isLoading } = useQuery<PaginatedResponse<Transaction>>({
    queryKey: ['transactions', transactionsPage],
    queryFn: () => balanceApi.getTransactions({ per_page: 20, page: transactionsPage }),
    placeholderData: (previousData) => previousData,
  });

  // Тот же ключ используют апстримные экраны пополнения, поэтому запрос между
  // страницами дедуплицируется.
  const { data: paymentMethods } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: balanceApi.getPaymentMethods,
  });

  const handlePromocodeActivate = async (subscriptionId?: number) => {
    const code = subscriptionId ? promoSelectCode || '' : promocode.trim();
    if (!code) return;

    setPromocodeLoading(true);
    setPromocodeError(null);
    setPromocodeSuccess(null);

    try {
      const result = await balanceApi.activatePromocode(code, subscriptionId);

      // ⚠️ Ветку выбора подписки сохраняем: ветвление приходит от API, а не от
      // нашего интерфейса, и без неё человек упрётся в ошибку без выхода.
      if (result.error === 'select_subscription' && result.eligible_subscriptions) {
        setPromoSelectSubs(result.eligible_subscriptions);
        setPromoSelectCode(result.code || code);
        return;
      }

      if (result.success) {
        const bonusAmount = (result.balance_after || 0) - (result.balance_before || 0);
        setPromocodeSuccess({
          message: result.bonus_description || t('balance.promocode.success'),
          amount: bonusAmount,
        });
        setTransactionsPage(1);
        setPromocode('');
        setPromoSelectSubs(null);
        setPromoSelectCode(null);
        await refetchBalance();
        await refreshUser();
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      }
    } catch (error: unknown) {
      const axiosError = error as {
        response?: { data?: { detail?: { code?: string } | string } };
      };
      const errorKey = resolvePromocodeErrorKey(axiosError.response?.data?.detail);
      setPromocodeError(t(`balance.promocode.errors.${errorKey}`));
      setPromoSelectSubs(null);
      setPromoSelectCode(null);
    } finally {
      setPromocodeLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">{t('balance.title')}</h1>

      {/* Баланс — общий виджет: тот же блок стоит на экране суммы пополнения. */}
      <BalanceWidget />

      {/* Способы пополнения — сразу под балансом: главное действие экрана.
          Карточки рисует общий компонент: тот же блок стоит на экране выбора
          способа (`/balance/top-up`, задача #55). Пустой список здесь скрывает
          блок целиком — объяснять пустоту на балансе нечем и не нужно, этим
          занимается экран выбора способа. */}
      {paymentMethods && paymentMethods.length > 0 && (
        <div className="bento-card">
          <h2 className="mb-4 text-lg font-semibold text-dark-100">{t('balance.topUpBalance')}</h2>
          <PaymentMethodsGrid methods={paymentMethods} />
        </div>
      )}

      {/* Промокод — ниже способов пополнения: вводят его редко. */}
      <div className="bento-card">
        <h2 className="mb-4 text-lg font-semibold text-dark-100">{t('balance.promocode.title')}</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={promocode}
            onChange={(e) => setPromocode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePromocodeActivate()}
            placeholder={t('balance.promocode.placeholder')}
            className="input flex-1"
            disabled={promocodeLoading}
          />
          <Button
            onClick={() => handlePromocodeActivate()}
            disabled={!promocode.trim()}
            loading={promocodeLoading}
          >
            {t('balance.promocode.activate')}
          </Button>
        </div>
        <AnimatePresence mode="wait">
          {promocodeError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-3 rounded-linear border border-error-500/30 bg-error-500/10 p-3 text-sm text-error-400"
            >
              {promocodeError}
            </motion.div>
          )}
          {promocodeSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-3 rounded-linear border border-success-500/30 bg-success-500/10 p-3 text-sm text-success-400"
            >
              <div className="font-medium">{promocodeSuccess.message}</div>
              {promocodeSuccess.amount > 0 && (
                <div className="mt-1">
                  {t('balance.promocode.balanceAdded', {
                    amount: promocodeSuccess.amount.toFixed(2),
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {promoSelectSubs && promoSelectSubs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 space-y-2 rounded-linear border border-accent-500/30 bg-accent-500/10 p-3"
          >
            <div className="text-sm font-medium text-dark-200">
              {t('balance.promocode.selectSubscription', 'К какой подписке применить промокод?')}
            </div>
            {promoSelectSubs.map((sub) => (
              <button
                key={sub.id}
                onClick={() => handlePromocodeActivate(sub.id)}
                disabled={promocodeLoading}
                className="flex w-full min-w-0 items-center justify-between gap-3 rounded-linear border border-dark-600 bg-dark-700 px-3 py-2 text-sm text-dark-200 transition-colors hover:border-accent-500/50 hover:bg-dark-600"
              >
                <span className="truncate">{sub.tariff_name}</span>
                {/* ⚠️ Подписи «Истекла» / «Отключена» — НАШИ строки, и живут они в
                    нашем неймспейсе: в апстримных `src/locales/*` этих ключей нет,
                    они попали туда нашим патчем, который откатывает задача #33.
                    Без различения статусов истёкшая подписка показывала бы «0 дн.»
                    и читалась бы как живая. */}
                <span className="shrink-0 text-dark-400">
                  {sub.status === 'expired'
                    ? tSimple('balance.promocode.expiredLabel')
                    : sub.status === 'disabled'
                      ? tSimple('balance.promocode.disabledLabel')
                      : t('balance.promocode.daysLeft', '{{count}} дн.', {
                          count: sub.days_left,
                        })}
                </span>
              </button>
            ))}
            <button
              onClick={() => {
                setPromoSelectSubs(null);
                setPromoSelectCode(null);
              }}
              className="text-xs text-dark-400 hover:text-dark-200"
            >
              {t('common.cancel', 'Отмена')}
            </button>
          </motion.div>
        )}
      </div>

      {/* История — в самом низу, аккордеоном и по умолчанию закрытая. */}
      <div className="bento-card overflow-hidden">
        <button
          onClick={() => setIsHistoryOpen(!isHistoryOpen)}
          className="flex w-full items-center justify-between text-left"
        >
          <h2 className="text-lg font-semibold text-dark-100">{t('balance.transactionHistory')}</h2>
          <ChevronDownIcon
            className={`h-5 w-5 text-dark-400 transition-transform duration-200 ${isHistoryOpen ? 'rotate-180' : ''}`}
          />
        </button>

        <AnimatePresence>
          {isHistoryOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-4">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
                  </div>
                ) : transactions?.items && transactions.items.length > 0 ? (
                  <div className="space-y-3">
                    {transactions.items.map((tx) => {
                      const amount = resolveTransactionAmount(tx.amount_rubles);
                      const labelKey = resolveTransactionLabelKey(tx.type);

                      return (
                        <div
                          key={tx.id}
                          className="flex items-center justify-between rounded-linear border border-dark-700/30 bg-dark-800/30 p-4"
                        >
                          <div className="flex-1">
                            <div className="mb-1 flex items-center gap-3">
                              <span className={resolveTransactionBadge(tx.type)}>
                                {labelKey ? t(labelKey) : tx.type}
                              </span>
                              <span className="text-xs text-dark-500">
                                {new Date(tx.created_at).toLocaleDateString(uiLocale())}
                              </span>
                            </div>
                            {tx.description && (
                              <div className="text-sm text-dark-400">{tx.description}</div>
                            )}
                          </div>
                          <div className={`text-lg font-semibold ${amount.colorClass}`}>
                            {amount.sign}
                            {formatAmount(amount.value)} {currencySymbol}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-linear-lg bg-dark-800">
                      <WalletIcon className="h-8 w-8 text-dark-500" />
                    </div>
                    <div className="text-dark-400">{t('balance.noTransactions')}</div>
                  </div>
                )}

                {transactions && transactions.pages > 1 && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-dark-500">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setTransactionsPage((prev) => Math.max(1, prev - 1))}
                      disabled={transactions.page <= 1}
                      className="min-w-[120px] flex-1 sm:flex-none"
                    >
                      {t('common.back')}
                    </Button>
                    <div className="flex-1 text-center">
                      {t('balance.page', {
                        current: transactions.page,
                        total: transactions.pages,
                      })}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setTransactionsPage((prev) =>
                          transactions.pages ? Math.min(transactions.pages, prev + 1) : prev + 1,
                        )
                      }
                      disabled={transactions.page >= transactions.pages}
                      className="min-w-[120px] flex-1 sm:flex-none"
                    >
                      {t('common.next')}
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
