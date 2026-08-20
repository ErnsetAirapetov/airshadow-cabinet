import { useTranslation } from 'react-i18next';

import { useCurrency } from '@/hooks/useCurrency';
import { useTheme } from '@/hooks/useTheme';
import { getGlassColors } from '@/utils/glassTheme';
import { getMonthlyPriceKopeks } from '@/utils/pricing';
import { formatPeriodLabel } from './periodLabel';

/**
 * ЕДИНСТВЕННАЯ разметка списка сроков простого режима (задача #71).
 *
 * ⚠️ Зачем компонент. До #71 список сроков был написан ДВАЖДЫ: на едином экране
 * оплаты (`SubscriptionPayment.tsx`) и в форме покупки тарифа
 * (`TariffPurchaseForm.tsx`). Владелец увидел на стенде результат: выбрал тариф
 * — и попал «на другой по виду экран», где сроки нарисованы сеткой вместо
 * списка, а подписаны «1 месяц» вместо «30 дней». Данные при этом были одни и
 * те же — разошлись именно две копии вёрстки, молча и при зелёной сборке. Это
 * ровно урок #61, повторённый второй раз.
 *
 * ⚠️ За основу взята разметка ЭКРАНА ОПЛАТЫ — так велит задача: к нему задачей
 * #69 сводился весь платёжный путь, и он же остался тем экраном, который
 * владелец принимал на стенде.
 *
 * ⚠️ Компонент ничего не решает и никуда не ходит: ни цен, ни промо-скидок, ни
 * баланса он не считает. Всё это приходит уже посчитанным
 * (`PeriodOptionView`), потому что правила у двух вызывающих РАЗНЫЕ — на экране
 * оплаты промо-скидку разрешает план (`plan.promoDiscountable`), в форме
 * покупки она применяется всегда. Затащи компонент эти правила внутрь — вернулась
 * бы ветка «а на каком мы экране», от которой уходила #69.
 */

export interface PeriodOptionView {
  /** Длина срока в днях. Она же ключ выбора и то, что уходит в оплату. */
  days: number;
  /** Итоговая цена — уже со всеми скидками, которые разрешил вызывающий. */
  priceKopeks: number;
  /** Цена до скидки. `null` — зачёркивать нечего. */
  originalPriceKopeks: number | null;
  /** Процент скидки для плашки. `0` — плашки нет. */
  discountPercent: number;
  /**
   * Сколько копеек не хватает на балансе.
   *
   * `null` — либо денег хватает, либо экран баланс не проверяет вовсе (так
   * приходит форма покупки: там нехватку показывает уже сама оплата,
   * `InsufficientBalancePrompt` по ответу бэкенда).
   */
  missingKopeks: number | null;
}

export interface PeriodOptionListProps {
  options: PeriodOptionView[];
  /** Выбранный срок в днях. `null` — не выбрано ничего. */
  selectedDays: number | null;
  onSelect: (days: number) => void;
}

export function PeriodOptionList({ options, selectedDays, onSelect }: PeriodOptionListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const g = getGlassColors(isDark);
  const { formatAmount, currencySymbol } = useCurrency();

  const periodLabel = (days: number) => formatPeriodLabel(days, (key, params) => t(key, params));

  const formatPrice = (kopeks: number) =>
    kopeks === 0
      ? t('subscription.free', 'Бесплатно')
      : `${formatAmount(kopeks / 100)} ${currencySymbol}`;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const isSelected = selectedDays === option.days;
        const perMonth = getMonthlyPriceKopeks(option.priceKopeks, option.days);

        return (
          <button
            key={option.days}
            type="button"
            onClick={() => onSelect(option.days)}
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
                  {periodLabel(option.days)}
                </span>
                {option.discountPercent > 0 && (
                  <span className="ml-2 rounded-full bg-success-400/15 px-2 py-0.5 text-[10px] font-semibold text-success-400">
                    -{option.discountPercent}%
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="text-base font-semibold" style={{ color: g.text }}>
                  {formatPrice(option.priceKopeks)}
                </div>
                {perMonth !== null && (
                  <div className="text-[11px]" style={{ color: g.textSecondary }}>
                    {formatAmount(perMonth / 100)} {currencySymbol}/{t('subscription.month', 'мес')}
                  </div>
                )}
                {option.originalPriceKopeks !== null &&
                  option.originalPriceKopeks > option.priceKopeks && (
                    <div className="text-[11px] line-through" style={{ color: g.textSecondary }}>
                      {formatAmount(option.originalPriceKopeks / 100)} {currencySymbol}
                    </div>
                  )}
              </div>
            </div>
            {option.missingKopeks !== null && (
              <div className="mt-1 text-[11px] text-error-400">
                {t(
                  'subscription.insufficientBalanceAmount',
                  'Недостаточно средств. Не хватает {{missing}}',
                  {
                    missing: `${formatAmount(option.missingKopeks / 100)} ${currencySymbol}`,
                  },
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
