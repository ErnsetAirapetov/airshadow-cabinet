import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRightIcon } from '@/components/icons';
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
 */

export interface TariffChangeOptionProps {
  action: SubscriptionCtaAction;
  isDark: boolean;
}

export function TariffChangeOption({ action, isDark }: TariffChangeOptionProps) {
  const { t } = useTranslation();

  return (
    <Link
      to={action.to}
      className={`block w-full rounded-xl border p-4 text-left transition-colors ${isDark ? 'border-dark-700/50 bg-dark-800/50 hover:border-dark-600' : 'border-champagne-300/60 bg-champagne-200/40 hover:border-champagne-400'}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-dark-100">{t(action.labelKey)}</div>
          <div className="mt-1 text-sm text-dark-400">{t(action.hintKey)}</div>
        </div>
        <ChevronRightIcon className="text-dark-400" />
      </div>
    </Link>
  );
}

export default TariffChangeOption;
