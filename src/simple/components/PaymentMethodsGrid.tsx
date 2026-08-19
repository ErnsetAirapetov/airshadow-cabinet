import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useCurrency } from '@/hooks/useCurrency';
import type { PaymentMethod } from '@/types';
import { resolveMethodCardSpans, spanClasses } from './paymentMethodsBento';
import { resolveAccentedMethodId, topUpHref } from './paymentMethodsState';

/**
 * Блок карточек способов пополнения — один компонент на два экрана (задача #55).
 *
 * Стоит на простом балансе (`/balance`) и на простом экране выбора способа
 * (`/balance/top-up`). До #55 блок жил инлайном в `src/simple/pages/Balance.tsx`;
 * вторая копия разъехалась бы с первой при первой же правке — ровно так же, как
 * это было с блоком баланса до #53.
 *
 * ⚠️ Иконок способов здесь нет и быть не должно. Требование владельца от
 * 17.08.2026: апстримные иконки ему не нравятся, и ни на одном из двух экранов их
 * не будет. Апстримный `PaymentMethodIcon` (501 строка) запрещено и копировать, и
 * импортировать.
 *
 * ⚠️ Раскладка — бенто «Баннер и полки» из `./paymentMethodsBento`: акцентная
 * карточка строкой во всю ширину, остальные полками так, чтобы каждая полка была
 * заполнена целиком. Пролёты считает ЧИСТАЯ функция, разметка только читает
 * результат — условий раскладки в JSX нет. Сама сетка объявлена ниже классом
 * `sm:grid-cols-6`, и сторож `paymentMethodsGrid.test.ts` сверяет это число с
 * `BENTO_COLUMNS`: разъехавшись, они молча сломали бы «во всю ширину строки».
 *
 * ⚠️ Хром карточек — глобальные классы `bento-card` / `bento-card-hover` из
 * `src/styles/globals.css`, а не апстримный `Card` из `components/data-display`:
 * он за границей режимов и тянет за собой `components/motion/transitions`, `cva`
 * и radix-slot. Классы повторяют вид апстримного `Card`, и на них же собраны
 * простая главная и простой баланс.
 */
export interface PaymentMethodsGridProps {
  methods: PaymentMethod[];
  /**
   * Query-хвост для ссылок карточек — `?amount=…&returnTo=…` или пусто.
   *
   * ⚠️ Единственная причина, по которой экран `/balance/top-up` вообще существует
   * (см. задачу #55): он переносит `amount` и `returnTo` на экран суммы. Потеря
   * хвоста стоит предзаполнения недостающей суммы и возврата к прерванной покупке.
   */
  search?: string;
}

export function PaymentMethodsGrid({ methods, search = '' }: PaymentMethodsGridProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatAmount, currencySymbol } = useCurrency();

  // ⚠️ Акцент — буквально первой карточке списка, независимо от доступности
  // (решение владельца 17.08.2026, #52). Решает чистая функция, а не условие в
  // разметке: её ветки (пусто / данных нет / все недоступны / недоступный первым)
  // покрыты `paymentMethodsState.test.ts` — там же, где лежит сама функция (#58).
  const accentedMethodId = resolveAccentedMethodId(methods);
  const spans = resolveMethodCardSpans(methods.length);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      {methods.map((method, index) => {
        const methodKey = method.id.toLowerCase().replace(/-/g, '_');
        const translatedName = t(`balance.paymentMethods.${methodKey}.name`, {
          defaultValue: '',
        });
        const translatedDesc = t(`balance.paymentMethods.${methodKey}.description`, {
          defaultValue: '',
        });
        const isAccented = method.id === accentedMethodId;

        return (
          <button
            key={method.id}
            type="button"
            disabled={!method.is_available}
            onClick={() => method.is_available && navigate(topUpHref(method.id, search))}
            className={[
              'text-left',
              // `bento-card-hover` включает в себя `bento-card` (@apply) и
              // добавляет ровно то, что делал вариант `interactive` у апстримного
              // `Card`: курсор, подсветку рамки и фона на hover, сжатие на нажатии.
              method.is_available ? 'bento-card-hover' : 'bento-card cursor-not-allowed opacity-50',
              // Пролёт в сетке — из чистой раскладки. Акцентной карточке
              // достаётся вся ширина строки, остальным — ширина полки.
              spanClasses(spans[index]),
              // Акцент в покое: рамка, градиентная подсветка и свечение. Условие
              // — только `isAccented`: акцент есть и у недоступной первой
              // карточки (#52).
              isAccented
                ? 'border-accent-500/40 bg-gradient-to-br from-accent-500/10 shadow-glow'
                : '',
              // ⚠️ Hover-варианты акцента — отдельной ветвью и ТОЛЬКО доступной
              // карточке (#52): на приглушённой некликабельной подсветка под
              // курсором зовёт нажать на то, что не нажимается.
              //
              // Доступной они обязательны, а не украшение:
              // `.bento-card-hover:hover` из `src/styles/globals.css` — это
              // специфичность 0,2,0, и она перебивает утилиты
              // `border-accent-500/40` и `shadow-glow` (0,1,0). Без них под
              // курсором акцентная карточка сереет и выглядит как все остальные.
              // Hover-варианты тоже 0,2,0, но живут в `@layer utilities` — ниже по
              // источнику, поэтому выигрывают.
              //
              // Недоступной карточке перебивать нечего: класса `bento-card-hover`
              // у неё нет, поэтому правила `.bento-card-hover:hover` по ней не
              // срабатывают. А вот utility-варианты `hover:` сработали бы и на
              // `disabled`: браузер шлёт `:hover` и по выключенной кнопке,
              // класс-гейта у утилит нет. Именно поэтому их недоступной карточке и
              // не выдают.
              isAccented && method.is_available
                ? 'hover:border-accent-500/60 hover:shadow-glow'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="font-semibold text-dark-100">{method.name || translatedName}</div>
            {(method.description || translatedDesc) && (
              <div className="mt-1 text-sm text-dark-500">
                {method.description || translatedDesc}
              </div>
            )}
            <div className="mt-3 text-xs text-dark-400">
              {formatAmount(method.min_amount_kopeks / 100, 0)} {t('common.rangeTo', 'to')}{' '}
              {formatAmount(method.max_amount_kopeks / 100, 0)} {currencySymbol}
            </div>
          </button>
        );
      })}
    </div>
  );
}
