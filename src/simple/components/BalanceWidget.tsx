import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { balanceApi } from '@/api/balance';
import { API } from '@/config/constants';
import { useCurrency } from '@/hooks/useCurrency';
import {
  ACCENT_FOREGROUND,
  ACCENT_FOREGROUND_MUTED,
  ACCENT_SHADOW,
  accentFill,
} from './accentSurface';
import { resolveBalanceValueClass } from './balanceValueScale';

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
 * Виджет текущего баланса — вес несёт крупная цифра.
 *
 * Один компонент на три экрана: простой баланс (`/balance`), простой экран суммы
 * пополнения (`/balance/top-up/:methodId`, задача #53) и главная (задача #72). До
 * #53 блок жил инлайном в `src/simple/pages/Balance.tsx`; вторая копия
 * разъехалась бы с первой при первой же правке.
 *
 * ⚠️ На главной виджет ПЕРЕИСПОЛЬЗУЕТСЯ, а не копируется (#72): баланс там —
 * главный акцент экрана, но это тот же баланс и тот же запрос. Отличие ровно
 * одно и оно пропом — тон поверхности; см. `tone` ниже.
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
  /**
   * Тон поверхности (задача #72).
   *
   * ⚠️ Проп НЕОБЯЗАТЕЛЬНЫЙ и по умолчанию `flat` — это ровно нынешний плоский
   * вид, до пикселя. Так и задумано: акцент включает только главная, а `/balance`
   * и экран суммы пополнения остаются прежними — там акцент принадлежит кнопке
   * оплаты, и второй громкий элемент отобрал бы у неё внимание (решение
   * владельца по #72).
   *
   * `accent` — та же поверхность, что у кнопки «Подключить устройство»: сплошная
   * акцентная заливка из общего модуля `accentSurface`. Копию значений здесь
   * заводить нельзя — см. докстринг того модуля.
   */
  tone?: 'flat' | 'accent';
}

export function BalanceWidget({ balanceRubles, tone = 'flat' }: BalanceWidgetProps = {}) {
  const { t } = useTranslation();
  const { formatAmount, currencySymbol } = useCurrency();
  const { data: balanceData } = useBalanceQuery();

  // ⚠️ `??`, а не `||`: нулевой баланс — законное значение пропа, и `||` подменял
  // бы его собственным запросом виджета.
  const shownRubles = balanceRubles ?? balanceData?.balance_rubles ?? 0;
  const formatted = formatAmount(shownRubles);

  // ⚠️ Ветка ОДНА, а тон меняет только классы и стиль. Разметка в двух ветках
  // разъехалась бы при первой же правке — ровно так этот форк уже терял кнопку
  // подключения (#59 → #61), — да и подпись `balance.currentBalance` сторож
  // считает по одному вхождению на файл.
  const isAccent = tone === 'accent';
  const accentStyle = {
    background: accentFill(),
    // ⚠️ Заменяет собой, а не дополняет стеклянную подсветку `.bento-card`
    // (`inset 0 1px 0 0 …`) — и так и надо: подсветка рассчитана на полупрозрачный
    // фон карточки, на сплошной акцентной заливке она читается царапиной. Взамен
    // акцент несёт собственную тень глубины, ту же, что у кнопки подключения.
    boxShadow: ACCENT_SHADOW,
    // Рамка `.bento-card` считается от фона карточки (в светлой теме — бежевая
    // `champagne-300/50`) и вокруг акцентной заливки читалась бы ободком.
    // Прозрачная — заливка продолжается под рамкой.
    borderColor: 'transparent',
  };

  return (
    // ⚠️ `h-full` только у акцентного тона: на главной виджет стоит в сетке рядом
    // с плиткой рефералов, и без него карточки в строке разной высоты. На двух
    // других экранах виджет стоит в потоке, и класса там нет вовсе.
    <div
      className={isAccent ? 'bento-card h-full' : 'bento-card'}
      style={isAccent ? accentStyle : undefined}
    >
      <div
        className={isAccent ? 'mb-2 text-sm' : 'mb-2 text-sm text-dark-400'}
        style={isAccent ? { color: ACCENT_FOREGROUND_MUTED } : undefined}
      >
        {t('balance.currentBalance')}
      </div>
      {/* ⚠️ В акцентном тоне кегль считает `resolveBalanceValueClass`, а не
          литерал: `text-5xl` на семизначной сумме не влезает в колонку
          360-пиксельного экрана, а `.bento-card` идёт с `overflow: hidden` —
          лишнее не выпирает, а обрезается. Правило и его цена — в докстринге
          модуля. Плоский тон остаётся с прежней парой `text-4xl sm:text-5xl`. */}
      <div
        className={
          isAccent
            ? `${resolveBalanceValueClass(formatted)} whitespace-nowrap font-bold`
            : 'text-4xl font-bold text-dark-50 sm:text-5xl'
        }
        style={isAccent ? { color: ACCENT_FOREGROUND } : undefined}
      >
        {formatted}
        <span
          className={isAccent ? 'ml-2 text-2xl' : 'ml-2 text-2xl text-dark-400'}
          style={isAccent ? { color: ACCENT_FOREGROUND_MUTED } : undefined}
        >
          {currencySymbol}
        </span>
      </div>
    </div>
  );
}
