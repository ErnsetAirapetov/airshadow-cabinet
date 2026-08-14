/**
 * Иконки простого режима.
 *
 * Свои, а не апстримные из `src/components/icons`: туда простому режиму хода нет
 * по границе (docs/architecture/two-modes.md). Набор намеренно крошечный —
 * ровно пункты меню, ничего про запас.
 *
 * Все принимают `className` и красятся `currentColor`.
 */
type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const HomeIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </svg>
);

export const SubscriptionIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12 3l7 3v5.5c0 4.2-2.9 8-7 9.5-4.1-1.5-7-5.3-7-9.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const WalletIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2" />
    <path d="M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5.5" />
    <circle cx="16.5" cy="13.5" r="1.25" />
  </svg>
);

export const SupportIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M21 12a9 9 0 1 0-3.6 7.2L21 21z" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3" />
    <path d="M12 16.5h.01" />
  </svg>
);

export const MenuIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </svg>
);

export const UserIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
  </svg>
);

export const InfoIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </svg>
);

export const ExpandIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4" />
    <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
    <path d="M15 4h4a1 1 0 0 1 1 1v4" />
    <path d="M9 20H5a1 1 0 0 1-1-1v-4" />
  </svg>
);
