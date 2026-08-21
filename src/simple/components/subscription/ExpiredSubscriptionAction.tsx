import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { subscriptionApi } from '@/api/subscription';
import { SubscriptionIcon } from '@/components/icons';
import { useHapticFeedback } from '@/platform/hooks/useHaptic';
import { getInsufficientBalanceError } from '@/utils/subscriptionHelpers';
import type { Subscription } from '@/types';
import {
  DEFAULT_RENEW_LABEL_KEY,
  resolveExpiredActionLabelKey,
  resolveExpiredRenewOperation,
} from './expiredAction';

/**
 * Единственное действие истёкшей платной подписки: переход на экран оплаты, а у
 * приостановленного суточного тарифа — возобновление списаний (задачи #65, #70).
 *
 * ⚠️ ЧТО ИЗМЕНИЛА задача #70 и почему. Прежде блок платил сам и выбирал между
 * «Продлить» и «Пополнить баланс» по грубому порогу «есть ли хоть рубль». Цену
 * продления порог не знал и знать не мог — она приходит из `renewal-options`
 * либо из каталога тарифа и зависит от выбранного срока. Владелец увидел на
 * стенде обе половины вранья: при 100 ₽ кнопка обещала продление, а получал
 * человек «Недостаточно средств на балансе» без единой цифры; при нуле она
 * требовала пополнения, тоже не называя суммы.
 *
 * Поэтому решение отсюда УБРАНО целиком, а не переписано: кнопка ведёт на
 * единый экран оплаты (`pages/SubscriptionPayment.tsx`), где цены известны и
 * уже работает нужный механизм — отказ `insufficient_funds` с полем
 * `missing_amount` печатается `InsufficientBalancePrompt` вместе со ссылкой на
 * пополнение с подставленной суммой. Переход БЕЗУСЛОВЕН: со случаем «тариф
 * больше не поддерживается» экран оплаты разбирается сам (сетка выбора с
 * баннером, #69), и второе такое условие здесь разъехалось бы с первым молча.
 *
 * ⚠️ Ветка «суточная на паузе» — граница задачи, её #70 не трогает: там
 * `togglePause`, то есть возврат остановленных списаний, а не покупка срока.
 * Это единственная мутация, оставшаяся в блоке.
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
 * ⚠️ Различия мест вызова — ПРОПАМИ: внешний отступ и подпись продления. Ветка
 * «на главной / на странице» внутри — та же развилка, из-за которой копии и
 * расходятся, поэтому её здесь нет: блок не знает, кто его позвал, он знает
 * только значения пропов.
 *
 * ⚠️ Ветвление вынесено в чистый модуль `expiredAction.ts`, потому что
 * компонентных тестов в проекте не бывает (docs/architecture/two-modes.md,
 * раздел «Тесты»). Разметка — тонкая оболочка: она читает вид операции и адрес,
 * своих правил не заводит.
 *
 * ⚠️ Кого здесь НЕТ: истёкшего триала (продлевать нечем — баланс пробный период
 * не покрывает, он уходит в витрину), состояния `limited` (трафик исчерпан,
 * подписка жива) и случая «подписки нет вовсе» (продлевать нечего, там
 * «Оформить подписку» от `PurchaseCTAButton`). Кому показывать блок, решает
 * место вызова: на главной — карточка, на странице — `resolveSubscriptionCardActions`.
 */

export interface ExpiredSubscriptionActionProps {
  subscription: Subscription;
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
 * Форма единственной кнопки — одна на оба её вида (ссылка и возобновление).
 *
 * ⚠️ Классы записаны ЛИТЕРАЛОМ и собраны в константу, а не скопированы дважды:
 * сборщик сканирует исходники текстом (литерал он видит), а две копии
 * разъехались бы при первой правке — кнопка «прыгала» бы при смене состояния.
 */
const ACTION_BUTTON_CLASS =
  'flex flex-1 items-center justify-center gap-2 rounded-[14px] py-3.5 text-[15px] font-semibold tracking-tight text-white transition-all duration-300';

export function ExpiredSubscriptionAction({
  subscription,
  renewLabelKey = DEFAULT_RENEW_LABEL_KEY,
  className = '',
}: ExpiredSubscriptionActionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const haptic = useHapticFeedback();

  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const operation = resolveExpiredRenewOperation(subscription);
  // Подпись считается ОДИН раз: её правило одно на оба вида кнопки, и вторая
  // запись разъехалась бы с первой молча.
  const labelKey = resolveExpiredActionLabelKey(operation, renewLabelKey);

  /**
   * Возобновление суточной подписки — единственная мутация блока.
   *
   * Покупка тарифа поверх дала бы «Тариф уже активен» и возврат средств,
   * поэтому приостановленный тариф снимают с паузы, а не покупают заново.
   */
  const handleResume = async () => {
    setIsResuming(true);
    setResumeError(null);
    haptic.buttonPressHeavy();

    try {
      await subscriptionApi.togglePause(subscription.id);

      haptic.success();
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
      });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      // Возобновление списывает суточную цену — иначе виджет баланса остался бы
      // со старой суммой.
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
    } catch (err: unknown) {
      haptic.error();
      const insufficientData = getInsufficientBalanceError(err);
      if (insufficientData) {
        setResumeError(t('dashboard.expired.insufficientFunds'));
      } else if (err instanceof AxiosError) {
        const detail = err.response?.data?.detail;
        if (typeof detail === 'string') {
          setResumeError(detail);
        } else {
          setResumeError(t('dashboard.expired.renewError'));
        }
      } else {
        setResumeError(t('dashboard.expired.renewError'));
      }
    } finally {
      setIsResuming(false);
    }
  };

  return (
    <div className={className}>
      {resumeError && (
        <div
          className="mb-4 rounded-xl border border-error-500/30 bg-error-500/10 p-3 text-center text-sm text-error-400"
          role="alert"
        >
          {resumeError}
        </div>
      )}

      <div className="flex gap-2.5">
        {operation.kind === 'resumeDaily' ? (
          <button
            type="button"
            onClick={handleResume}
            disabled={isResuming}
            className={`${ACTION_BUTTON_CLASS} disabled:opacity-50`}
            style={{ background: ACCENT_GRADIENT, boxShadow: ACCENT_SHADOW }}
          >
            {isResuming ? (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                aria-hidden="true"
              />
            ) : (
              <SubscriptionIcon className="h-4 w-4" />
            )}
            {isResuming ? t('common.loading') : t(labelKey)}
          </button>
        ) : (
          // ⚠️ ПЕРЕХОД, а не оплата (#70). Сколько именно денег не хватает,
          // человек узнаёт на экране оплаты, где цены известны; здесь их нет и
          // быть не может. Адрес приходит ИЗ ОПЕРАЦИИ — тот же единый экран, что
          // у кнопки продления активной подписки (#69). Своего литерала у
          // разметки нет: он разъехался бы молча.
          <Link
            to={operation.to}
            className={ACTION_BUTTON_CLASS}
            style={{ background: ACCENT_GRADIENT, boxShadow: ACCENT_SHADOW }}
          >
            <SubscriptionIcon className="h-4 w-4" />
            {t(labelKey)}
          </Link>
        )}
      </div>
    </div>
  );
}

export default ExpiredSubscriptionAction;
