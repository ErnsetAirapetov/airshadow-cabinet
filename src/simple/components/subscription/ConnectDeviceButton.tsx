import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { DevicesIcon } from '@/components/icons';
import { useHaptic } from '@/platform';
import type { Subscription } from '@/types';
import { resolveConnectButtonAccent } from './connectButtonAccent';

/**
 * Кнопка «Подключить устройство» — главное действие простого режима (задача #61).
 *
 * ⚠️ Компонент один на два экрана: главная (`SubscriptionCardActive`) и страница
 * подписки (`pages/Subscription.tsx`). До #61 копий было две, и после #59 они
 * разошлись — акцент достался только странице подписки. Спека #59 описывала
 * только её и про копию на главной не говорила; разводить их не предполагалось.
 * Копии расходятся молча, со сборкой зелёной, поэтому кнопка сведена в один
 * компонент, а не «приведена к одному виду».
 *
 * ⚠️ Различия мест вызова — ПРОПАМИ, а не ветками внутри. Их ровно два: внешний
 * отступ и атрибут онбординга, который есть только на главной. Ветка внутри —
 * та же развилка, из-за которой копии и разошлись.
 *
 * ⚠️ Ни одного цвета в этом файле нет: и заливка, и текст, и индикатор приходят
 * из `resolveConnectButtonAccent`, то есть из акцентной палитры оператора.
 * Инлайн-стилем, а не утилитами: утилиты в светлой теме подавляются правилами
 * карточек (#52, канон). Подробности приёма — в докстринге модуля акцента.
 */

export interface ConnectDeviceButtonProps {
  subscription: Subscription;
  /** Сколько устройств подключено сейчас. */
  connectedDevices: number;
  /** Внешний отступ места вызова — единственное, чем экраны отличаются. */
  className?: string;
  /** Значение `data-onboarding`; на странице подписки онбординга нет. */
  onboardingId?: string;
}

export function ConnectDeviceButton({
  subscription,
  connectedDevices,
  className = '',
  onboardingId,
}: ConnectDeviceButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const haptic = useHaptic();

  // Ссылки на подключение нет — кнопке некуда вести. Условие живёт здесь, а не
  // в двух местах вызова: иначе один экран показывал бы тупиковую кнопку.
  if (!subscription.subscription_url) return null;

  const isAtDeviceLimit =
    subscription.device_limit > 0 && connectedDevices >= subscription.device_limit;
  const accent = resolveConnectButtonAccent(isAtDeviceLimit);

  return (
    <button
      type="button"
      disabled={isAtDeviceLimit}
      onClick={() => {
        if (isAtDeviceLimit) {
          haptic.notification('error');
          return;
        }
        // Адрес считается от подписки, а не от параметра маршрута: страница
        // подписки открывается и без идентификатора (#60), а вести на выбор
        // подписки человека, у которого она одна, незачем.
        navigate(subscription.id ? `/connection?sub=${subscription.id}` : '/connection');
      }}
      className={`flex w-full items-center gap-3.5 rounded-[14px] p-3.5 text-left transition-shadow duration-300 ${isAtDeviceLimit ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
      data-onboarding={onboardingId}
      style={{
        fontFamily: 'inherit',
        background: accent.background,
        boxShadow: accent.boxShadow,
      }}
    >
      <div
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: accent.iconBackground, color: accent.foreground }}
      >
        <DevicesIcon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold tracking-tight" style={{ color: accent.foreground }}>
          {t('dashboard.connectDevice')}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: accent.foregroundMuted }}>
          {subscription.device_limit === 0
            ? t('dashboard.devicesConnectedUnlimited', { used: connectedDevices })
            : t('dashboard.devicesOfMax', {
                used: connectedDevices,
                max: subscription.device_limit,
              })}
        </div>
        {isAtDeviceLimit && (
          <div className="mt-1 text-[10px] font-medium" style={{ color: accent.limitNotice }}>
            {t('dashboard.deviceLimitReached')}
          </div>
        )}
      </div>

      {subscription.device_limit === 0 ? (
        <div
          className="flex flex-shrink-0 items-center text-lg"
          style={{ color: accent.foregroundMuted }}
          aria-hidden="true"
        >
          ∞
        </div>
      ) : subscription.device_limit <= 10 ? (
        <div className="flex flex-shrink-0 gap-1.5" aria-hidden="true">
          {Array.from({ length: subscription.device_limit }, (_, i) => (
            <div
              key={i}
              className="h-[7px] w-[7px] rounded-full transition-[background-color,box-shadow] duration-300"
              style={{
                background: i < connectedDevices ? accent.indicatorOn : accent.indicatorOff,
                boxShadow: i < connectedDevices ? accent.indicatorGlow : 'none',
              }}
            />
          ))}
        </div>
      ) : (
        <div className="flex w-16 flex-shrink-0 items-center" aria-hidden="true">
          <div
            className="h-[6px] w-full overflow-hidden rounded-full"
            style={{ background: accent.indicatorTrack }}
          >
            {/* scaleX (compositor) instead of width (layout-thrash).
                Track is 64px (w-16), so 0.0625 floor = 4px minimum. */}
            <div
              className="h-full w-full origin-left rounded-full transition-transform duration-500"
              style={{
                transform: `scaleX(${(() => {
                  const filled = connectedDevices / subscription.device_limit;
                  return connectedDevices > 0 ? Math.max(filled, 0.0625) : 0;
                })()})`,
                background: accent.indicatorOn,
                boxShadow: accent.indicatorGlow,
              }}
            />
          </div>
        </div>
      )}
    </button>
  );
}

export default ConnectDeviceButton;
