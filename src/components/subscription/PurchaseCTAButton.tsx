import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { AdjustmentsIcon, ChevronRightIcon, SubscriptionIcon } from '@/components/icons';
import { resolveSubscriptionCta, type SubscriptionCtaAction } from './purchaseCta';
import type { Subscription } from '../../types';

interface PurchaseCTAButtonProps {
  subscription: Subscription | null;
}

/**
 * Кнопки действий под карточкой подписки. Что именно показать — решает
 * `resolveSubscriptionCta` (там же матрица состояний и тесты); здесь только
 * рендер: акцентное действие — карточкой с градиентной рамкой, второстепенное —
 * плоской строкой.
 */
export default function PurchaseCTAButton({ subscription }: PurchaseCTAButtonProps) {
  const actions = resolveSubscriptionCta(subscription);

  if (actions.length === 0) return null;

  return (
    <div className="space-y-3">
      {actions.map((action) =>
        action.tone === 'subtle' ? (
          <SecondaryAction key={action.kind} action={action} />
        ) : (
          <PrimaryAction key={action.kind} action={action} />
        ),
      )}
    </div>
  );
}

function PrimaryAction({ action }: { action: SubscriptionCtaAction }) {
  const { t } = useTranslation();
  const isCritical = action.tone === 'critical';
  const accentColor = isCritical
    ? 'rgb(var(--color-critical-500))'
    : 'rgb(var(--color-accent-400))';

  return (
    <Link to={action.to} className="block">
      <HoverBorderGradient
        accentColor={accentColor}
        duration={4}
        className="group relative w-full cursor-pointer overflow-hidden rounded-2xl"
      >
        <div
          className="relative flex items-center justify-between rounded-[14px] px-5 py-4 transition-colors duration-300"
          style={{
            background: isCritical
              ? 'linear-gradient(135deg, rgba(255,59,92,0.08), rgba(255,107,53,0.06))'
              : 'linear-gradient(135deg, rgba(var(--color-accent-400), 0.08), rgba(var(--color-accent-400), 0.06))',
          }}
        >
          {/* Left: icon + text */}
          <div className="flex items-center gap-3">
            {/* Sparkle icon */}
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
              style={{
                background: isCritical
                  ? 'rgba(255,59,92,0.12)'
                  : 'rgba(var(--color-accent-400), 0.12)',
                color: accentColor,
              }}
            >
              <SubscriptionIcon className="h-[18px] w-[18px]" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-dark-50">{t(action.labelKey)}</div>
              <div className="text-[12px] text-dark-50/40">{t(action.hintKey)}</div>
            </div>
          </div>

          {/* Right: chevron */}
          <ChevronRightIcon className="h-5 w-5 flex-shrink-0 text-dark-50/30 transition-transform duration-300 group-hover:translate-x-1" />
        </div>
      </HoverBorderGradient>
    </Link>
  );
}

function SecondaryAction({ action }: { action: SubscriptionCtaAction }) {
  const { t } = useTranslation();

  return (
    <Link to={action.to} className="block">
      <div className="group flex items-center justify-between rounded-2xl border border-dark-50/10 bg-dark-50/[0.03] px-5 py-3 transition-colors duration-300 hover:border-dark-50/20 hover:bg-dark-50/[0.06]">
        {/* Left: icon + text */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-dark-50/[0.06] text-dark-50/45">
            <AdjustmentsIcon className="h-[17px] w-[17px]" />
          </div>
          <div>
            <div className="text-[14px] font-medium text-dark-50/80">{t(action.labelKey)}</div>
            <div className="text-[12px] text-dark-50/35">{t(action.hintKey)}</div>
          </div>
        </div>

        {/* Right: chevron */}
        <ChevronRightIcon className="h-4 w-4 flex-shrink-0 text-dark-50/25 transition-transform duration-300 group-hover:translate-x-1" />
      </div>
    </Link>
  );
}
