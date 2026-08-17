import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { balanceApi } from '@/api/balance';
import { PaymentMethodsGrid } from '../components/PaymentMethodsGrid';
import { resolveTopUpSearch } from './topUpMethodSelectState';

/**
 * Выбор способа пополнения в простом режиме (задача #55).
 *
 * ⚠️ Это НЕ новый интерфейс, а копия апстримного `src/pages/TopUpMethodSelect.tsx`
 * с изменениями по спеке владельца. Оригинал остаётся экспертному режиму
 * нетронутым.
 *
 * Что изменено:
 *
 *   1. иконок способов нет — они владельцу не нравятся, и апстримный
 *      `PaymentMethodIcon` (501 строка) запрещено и копировать, и импортировать;
 *   2. карточки рисует общий компонент `PaymentMethodsGrid` — тот же блок стоит на
 *      простом балансе, и раскладка у него бенто («Баннер и полки»);
 *   3. вместо апстримного `Card` и `staggerContainer`/`staggerItem` из
 *      `@/components/motion/transitions` — глобальный класс `bento-card` и обычные
 *      `div`: и то, и другое за границей режимов (тот же приём, что в
 *      `src/simple/pages/Balance.tsx` и `TopUpAmount.tsx`).
 *
 * ⚠️ Почему экран вообще существует, хотя карточки способов уже есть на
 * `/balance`. Две причины, обе выяснены разведкой к задаче #55:
 *
 *   - **адрес — публичный контракт с ботом.** `miniapp_buttons.py` маппит на
 *     `/balance/top-up` и кнопку «Пополнить баланс», и кнопку рассылки; живые
 *     производители — клавиатура уведомления об автоплатеже, уведомления
 *     мониторинга, админские рассылки. Маршрут обязан оставаться живым;
 *   - **`amount` и `returnTo`.** Это единственная функция экрана, не покрытая
 *     блоком на балансе, и она обязательна: без неё человек, которому не хватило
 *     денег на подписку, теряет и предзаполнение недостающей суммы, и возврат к
 *     прерванной покупке. Правило хвоста — в `./topUpMethodSelectState`.
 *
 * ⚠️ Спиннер и пустое состояние сохранены сознательно: на балансе пустой список
 * способов скрывает блок целиком, а здесь пустой экран без объяснения был бы
 * тупиком. Это ровно то, чем экран лучше блока.
 */
export function SimpleTopUpMethodSelect() {
  // Строки, унаследованные от апстримной страницы, продолжают читаться из общего
  // словаря; в нашем неймспейсе живут только НАШИ ключи, а новых здесь нет.
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  // Тот же ключ используют баланс и экран суммы, поэтому запрос между страницами
  // дедуплицируется.
  const { data: paymentMethods, isLoading } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: balanceApi.getPaymentMethods,
  });

  const search = resolveTopUpSearch(searchParams);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">
        {t('balance.selectPaymentMethod')}
      </h1>

      <div className="bento-card">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
          </div>
        ) : !paymentMethods || paymentMethods.length === 0 ? (
          <div className="py-6 text-center text-sm text-dark-400">
            {t('balance.noPaymentMethods')}
          </div>
        ) : (
          <PaymentMethodsGrid methods={paymentMethods} search={search} />
        )}
      </div>
    </div>
  );
}
