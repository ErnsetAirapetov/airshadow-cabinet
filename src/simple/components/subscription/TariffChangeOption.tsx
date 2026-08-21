import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRightIcon } from '@/components/icons';
import { SIMPLE_NS } from '../../i18n';
import type { SubscriptionCtaAction } from './purchaseCta';

/**
 * Пункт «Сменить тариф» в блоке «Дополнительные опции» (задача #61).
 *
 * ⚠️ Раньше это была второстепенная кнопка под продлением, и владелец забраковал
 * её вид. Пункт обязан выглядеть ТЕМИ ЖЕ элементами, что соседи по блоку, —
 * триггеры шторок (образец: `sheets/DeviceTopupSheet.tsx`). Классы и ветки темы
 * повторены дословно; сторож в `tariffChangeOption.test.ts` сверяет их с
 * образцом, а не глазами: разъехавшись, они не уронили бы ни сборку, ни тесты.
 *
 * ⚠️ Соседи открывают шторку, этот пункт — ведёт на страницу смены тарифа.
 * Отсюда `Link`, а не `button`. Адрес приходит готовым из `purchaseCta`
 * (`action.to`): второе правило адреса разъехалось бы с первым молча.
 *
 * ⚠️ Переводчика два, как и в `PurchaseCTAButton` (#33): заголовок — апстримный
 * ключ и апстримный `t`, подпись — наша строка из `src/simple/locales/` и
 * `tSimple`. Разбор — в докстринге соседа, там же причина.
 */

export interface TariffChangeOptionProps {
  action: SubscriptionCtaAction;
  isDark: boolean;
}

export function TariffChangeOption({ action, isDark }: TariffChangeOptionProps) {
  const { t } = useTranslation();
  const { t: tSimple } = useTranslation(SIMPLE_NS);

  return (
    <Link
      to={action.to}
      className={`block w-full rounded-xl border p-4 text-left transition-colors ${isDark ? 'border-dark-700/50 bg-dark-800/50 hover:border-dark-600' : 'border-champagne-300/60 bg-champagne-200/40 hover:border-champagne-400'}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-dark-100">{t(action.labelKey)}</div>
          <div className="mt-1 text-sm text-dark-400">{tSimple(action.hintKey)}</div>
        </div>
        <ChevronRightIcon className="text-dark-400" />
      </div>
    </Link>
  );
}

export default TariffChangeOption;
