import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { balanceApi } from '@/api/balance';
import { API } from '@/config/constants';
import { useCurrency } from '@/hooks/useCurrency';

/**
 * Запрос баланса простого режима.
 *
 * Вынесен рядом с виджетом, чтобы параметры запроса были объявлены ОДИН раз:
 * страница баланса дёргает `refetch` после активации промокода, а виджет читает
 * данные, и разъехавшиеся `staleTime` дали бы двум наблюдателям одного ключа
 * разное поведение молча.
 *
 * Ключ `['balance']` общий с простой главной и простым балансом — запрос между
 * ними дедуплицируется, лишнего обращения к API виджет не добавляет.
 */
export function useBalanceQuery() {
  return useQuery({
    queryKey: ['balance'],
    queryFn: balanceApi.getBalance,
    staleTime: API.BALANCE_STALE_TIME_MS,
    refetchOnMount: 'always',
  });
}

/**
 * Виджет текущего баланса — плоская поверхность, вес несёт крупная цифра.
 *
 * Один компонент на два экрана: простой баланс (`/balance`) и простой экран суммы
 * пополнения (`/balance/top-up/:methodId`, задача #53). До #53 блок жил инлайном в
 * `src/simple/pages/Balance.tsx`; вторая копия разъехалась бы с первой при первой
 * же правке.
 *
 * ⚠️ Своей ширины виджет не задаёт: он обычный блок и занимает всю ширину той
 * колонки, в которую его поставили. Требование владельца «растянут на ширину
 * остальных элементов интерфейса» выполняется именно этим — `max-w-*` здесь
 * навешивать нельзя, иначе на одном из двух экранов он окажется уже остальных
 * блоков.
 */
export interface BalanceWidgetProps {
  /**
   * Показать это число вместо собственного запроса (задача #29).
   *
   * ⚠️ Проп нужен там, где страница не просто показывает баланс, а ПРИНИМАЕТ ПО
   * НЕМУ РЕШЕНИЯ: экран продления считает «хватает ли» и рисует недостачу. Пока
   * виджет читал баланс сам, у страницы было второе число — и человек мог видеть
   * достаточную сумму рядом с кнопкой «не хватает». Проп делает эти два числа
   * одним по построению, а не по договорённости.
   *
   * Не передан — виджет берёт баланс своим запросом, как на `/balance` и на
   * экране суммы пополнения.
   */
  balanceRubles?: number;
}

export function BalanceWidget({ balanceRubles }: BalanceWidgetProps = {}) {
  const { t } = useTranslation();
  const { formatAmount, currencySymbol } = useCurrency();
  const { data: balanceData } = useBalanceQuery();

  // ⚠️ `??`, а не `||`: нулевой баланс — законное значение пропа, и `||` подменял
  // бы его собственным запросом виджета.
  const shownRubles = balanceRubles ?? balanceData?.balance_rubles ?? 0;

  return (
    <div className="bento-card">
      <div className="mb-2 text-sm text-dark-400">{t('balance.currentBalance')}</div>
      <div className="text-4xl font-bold text-dark-50 sm:text-5xl">
        {formatAmount(shownRubles)}
        <span className="ml-2 text-2xl text-dark-400">{currencySymbol}</span>
      </div>
    </div>
  );
}
