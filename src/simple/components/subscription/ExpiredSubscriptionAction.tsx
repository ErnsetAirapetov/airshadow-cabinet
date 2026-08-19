import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { subscriptionApi } from '@/api/subscription';
import { PlusIcon, SubscriptionIcon } from '@/components/icons';
import { useHapticFeedback } from '@/platform/hooks/useHaptic';
import { getInsufficientBalanceError } from '@/utils/subscriptionHelpers';
import type { Subscription } from '@/types';
import { resolveExpiredCardAction } from '../../pages/dashboardState';
import { PURCHASE_ROUTE } from './purchaseCta';
import {
  DEFAULT_RENEW_LABEL_KEY,
  hasBalanceForRenew,
  resolveExpiredActionButton,
  resolveExpiredActionLabelKey,
  resolveExpiredRenewOperation,
} from './expiredAction';

/**
 * Единственное действие истёкшей платной подписки: «Продлить подписку», если
 * денег хватает, и «Пополнить баланс», если нет (задача #65).
 *
 * ⚠️ Компонент ОДИН на два экрана: карточка главной
 * (`dashboard/SubscriptionCardExpired`) и страница подписки
 * (`pages/Subscription.tsx`). До #65 блок жил только на главной, и владелец
 * потребовал ровно его же на странице подписки — «механизм и кнопки можно взять
 * оттуда, логику тоже». Взять означало скопировать, и это прямой урок #61: там
 * кнопка подключения существовала двумя копиями, они разошлись молча при
 * зелёной сборке, и владелец увидел это на стенде. Поэтому блок сведён в один
 * компонент сразу, второй копии нет.
 *
 * ⚠️ Различия мест вызова — ПРОПАМИ: внешний отступ, подпись продления и флаг
 * «баланс ещё грузится». Ветка «на главной / на странице» внутри — та же
 * развилка, из-за которой копии и расходятся, поэтому её здесь нет: блок не
 * знает, кто его позвал, он знает только значения пропов.
 *
 * ⚠️ Подпись продления разведена решением владельца от 19.08.2026: на главной
 * кнопка стоит в тесной плитке и остаётся короткой («Продлить»), на странице
 * подписки идёт во всю ширину и называется «Продлить подписку». Ключи — в
 * `expiredAction.ts` (`DEFAULT_RENEW_LABEL_KEY`, `PAGE_RENEW_LABEL_KEY`).
 *
 * ⚠️ Ветвление вынесено в чистые модули, потому что компонентных тестов в
 * проекте не бывает (docs/architecture/two-modes.md, раздел «Тесты»): порог
 * баланса и выбор операции — `expiredAction.ts`, решение «продлить или
 * пополнить» — `resolveExpiredCardAction` из `pages/dashboardState.ts`. Второй
 * записи этих правил нет ни здесь, ни на экранах.
 *
 * ⚠️ Кого здесь НЕТ: истёкшего триала (продлевать нечем — баланс пробный период
 * не покрывает, он уходит в витрину), состояния `limited` (трафик исчерпан,
 * подписка жива) и случая «подписки нет вовсе» (продлевать нечего, там
 * «Оформить подписку» от `PurchaseCTAButton`). Кому показывать блок, решает
 * место вызова: на главной — карточка, на странице — `resolveSubscriptionCardActions`.
 */

export interface ExpiredSubscriptionActionProps {
  subscription: Subscription;
  /** Баланс в копейках — из запроса `['balance']`, общего для обоих экранов. */
  balanceKopeks: number;
  /**
   * Запрос баланса ещё идёт.
   *
   * ⚠️ Без этого первые 200–400 мс единственной кнопкой экрана будет «Пополнить
   * баланс»: баланс равен нулю, пока не пришёл. По умолчанию `false` — на
   * главной сумма баланса стоит рядом с кнопкой, и карточка флаг не передаёт.
   */
  isBalanceLoading?: boolean;
  /**
   * Ключ подписи продления — различие мест вызова, а не ветка внутри блока: на
   * главной короткое «Продлить» (тесная плитка), на странице подписки «Продлить
   * подписку» (кнопка во всю ширину). Решение владельца от 19.08.2026.
   */
  renewLabelKey?: string;
  /** Внешний отступ места вызова — единственное, чем экраны отличаются. */
  className?: string;
}

/**
 * Критический акцент истёкшей подписки. Второй конец градиента — литерал:
 * переменной под этот оранжевый в палитре нет, а заводить её значило бы править
 * общий с экспертным режимом `globals.css` (то же решение, что в #62).
 */
const ACCENT_GRADIENT = 'linear-gradient(135deg, #FF3B5C, #FF6B35)';
const ACCENT_SHADOW = '0 4px 20px rgba(var(--color-critical-500), 0.2)';

/**
 * Форма единственной кнопки — одна на все три её состояния (заглушка на время
 * загрузки баланса, продление, пополнение).
 *
 * ⚠️ Классы записаны ЛИТЕРАЛОМ и собраны в константу, а не скопированы трижды:
 * сборщик сканирует исходники текстом (литерал он видит), а три копии разъехались
 * бы при первой правке — кнопка «прыгала» бы при смене состояния.
 */
const ACTION_BUTTON_CLASS =
  'flex flex-1 items-center justify-center gap-2 rounded-[14px] py-3.5 text-[15px] font-semibold tracking-tight text-white transition-all duration-300';

export function ExpiredSubscriptionAction({
  subscription,
  balanceKopeks,
  isBalanceLoading = false,
  renewLabelKey = DEFAULT_RENEW_LABEL_KEY,
  className = '',
}: ExpiredSubscriptionActionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const haptic = useHapticFeedback();

  const [isRenewing, setIsRenewing] = useState(false);
  const [renewError, setRenewError] = useState<string | null>(null);
  // ⚠️ Реальный отказ по нехватке средств. `hasBalanceForRenew` — проверка
  // грубая, цены продления она не знает, поэтому отказ обязан перебивать её
  // результат: иначе на экране осталась бы кнопка «Продлить» и ни одного
  // рабочего действия (см. `resolveExpiredCardAction`).
  const [renewFailedInsufficientBalance, setRenewFailedInsufficientBalance] = useState(false);

  const operation = resolveExpiredRenewOperation(subscription);
  const hasBalance = hasBalanceForRenew({ subscription, balanceKopeks });
  const action = resolveExpiredCardAction({ hasBalance, renewFailedInsufficientBalance });
  // ⚠️ Что рисует кнопка на самом деле. Решение выше принято по нулевому
  // балансу, пока запрос в полёте, поэтому показывать его результат нельзя, а у
  // непродлеваемого статуса баланс не спрашивают вовсе: см.
  // `resolveExpiredActionButton`.
  const button = resolveExpiredActionButton({ operation, action, isBalanceLoading });
  // Подпись считается ОДИН раз: её правило одно на все ветки кнопки, и вторая
  // запись разъехалась бы с первой молча.
  const labelKey = resolveExpiredActionLabelKey(operation, renewLabelKey);

  const handleRenew = async () => {
    setIsRenewing(true);
    setRenewError(null);
    setRenewFailedInsufficientBalance(false);
    haptic.buttonPressHeavy();

    try {
      switch (operation.kind) {
        case 'resumeDaily':
          // Суточный тариф с остановленными списаниями возвращают с паузы;
          // покупка тарифа поверх дала бы «Тариф уже активен» и возврат средств.
          await subscriptionApi.togglePause(subscription.id);
          break;
        case 'purchaseDailyTariff':
          // ⚠️ `subscription.id` в запросе обязателен: без него бэкенд ищет
          // строку по `(user_id, tariff_id)` и проигрывает гонку с вебхуками
          // панели — это всплывало как «Тариф уже активен» плюс возврат.
          await subscriptionApi.purchaseTariff(
            operation.tariffId,
            operation.days,
            undefined,
            subscription.id,
          );
          break;
        case 'renewSubscription':
          await subscriptionApi.renewSubscription(operation.days, subscription.id);
          break;
      }

      haptic.success();
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
      });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
    } catch (err: unknown) {
      haptic.error();
      const insufficientData = getInsufficientBalanceError(err);
      if (insufficientData) {
        setRenewError(t('dashboard.expired.insufficientFunds'));
        setRenewFailedInsufficientBalance(true);
      } else if (err instanceof AxiosError) {
        const detail = err.response?.data?.detail;
        if (typeof detail === 'string') {
          setRenewError(detail);
        } else {
          setRenewError(t('dashboard.expired.renewError'));
        }
      } else {
        setRenewError(t('dashboard.expired.renewError'));
      }
    } finally {
      setIsRenewing(false);
    }
  };

  const handleTopUp = () => {
    haptic.buttonPress();
    const params = new URLSearchParams();
    // Возврат туда, откуда пришли: блок стоит на двух экранах, и адрес берётся
    // из маршрута, а не пишется литералом place-of-call.
    params.set('returnTo', location.pathname);
    navigate(`/balance/top-up?${params.toString()}`);
  };

  return (
    <div className={className}>
      {renewError && (
        <div
          className="mb-4 rounded-xl border border-error-500/30 bg-error-500/10 p-3 text-center text-sm text-error-400"
          role="alert"
        >
          {renewError}
        </div>
      )}

      <div className="flex gap-2.5">
        {button === 'purchase' ? (
          // ⚠️ Продление этой подписке запретил бэкенд (#67): статус входит в
          // `NON_RENEWABLE_STATUSES`, и эндпоинт продления отвечает на неё 400.
          // Поэтому здесь ПЕРЕХОД, а не мутация — витрина для такого статуса
          // работает, и до #65 страница подписки вела ровно туда. Кнопки
          // «Пополнить баланс» у этой ветки нет намеренно: продлить с пополненного
          // счёта всё равно нельзя, это тупик.
          <Link
            to={PURCHASE_ROUTE}
            className={ACTION_BUTTON_CLASS}
            style={{ background: ACCENT_GRADIENT, boxShadow: ACCENT_SHADOW }}
          >
            <SubscriptionIcon className="h-4 w-4" />
            {t(labelKey)}
          </Link>
        ) : button === 'pending' ? (
          // ⚠️ Баланс ещё в полёте. Кнопка та же по форме и месту, но без
          // подписи-обещания и без действия: показать здесь «Пополнить баланс»
          // (решение по нулевому балансу) значило бы подсунуть платящему
          // человеку не то действие на первые 200–400 мс.
          <button
            type="button"
            disabled
            aria-busy="true"
            className={`${ACTION_BUTTON_CLASS} disabled:opacity-50`}
            style={{ background: ACCENT_GRADIENT, boxShadow: ACCENT_SHADOW }}
          >
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
              aria-hidden="true"
            />
            {t('common.loading')}
          </button>
        ) : button === 'renew' ? (
          <button
            type="button"
            onClick={handleRenew}
            disabled={isRenewing}
            className={`${ACTION_BUTTON_CLASS} disabled:opacity-50`}
            style={{ background: ACCENT_GRADIENT, boxShadow: ACCENT_SHADOW }}
          >
            {isRenewing ? (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                aria-hidden="true"
              />
            ) : (
              <SubscriptionIcon className="h-4 w-4" />
            )}
            {isRenewing ? t('common.loading') : t(labelKey)}
          </button>
        ) : (
          // Денег не хватает — той же кнопкой заменяется и продление до попытки
          // (`hasBalance = false`), и продление, отказавшее по нехватке средств.
          // Кнопка одна и та же, развилки на экране нет.
          <button
            type="button"
            onClick={handleTopUp}
            className={ACTION_BUTTON_CLASS}
            style={{ background: ACCENT_GRADIENT, boxShadow: ACCENT_SHADOW }}
          >
            <PlusIcon className="h-4 w-4" />
            {t('dashboard.expired.topUp')}
          </button>
        )}
      </div>
    </div>
  );
}

export default ExpiredSubscriptionAction;
