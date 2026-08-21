import { forwardRef, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Минимальная копия апстримной `src/components/data-display/Card/Card.tsx`
 * (задача #63).
 *
 * Гейт границ не пускает простой режим в `src/components/data-display/**`, а
 * страница поддержки собрана из карточек. Копируем по канону («Заимствование
 * логики», правило «копируем минимум») ровно то, чем страница пользуется:
 * карточку в размере `lg` — апстримный дефолт — с пробросом className и
 * motion-пропов.
 *
 * ⚠️ Чего в копии НЕТ и почему это не потеря: апстримные `interactive`, `glow`,
 * `asChild`, `size`, `variant` и подкомпоненты (`CardHeader`, `CardTitle`,
 * `CardDescription`, `CardContent`, `CardFooter`). Интерактивная ветка оригинала
 * анимирует hover/tap через `buttonHover`/`buttonTap`/`springTransition`, то
 * есть тянет из `transitions.ts` ещё три переменные сверх двух, которые нужны
 * самой странице. Скопировать проп без его анимации значило бы завести молчаливое
 * расхождение: карточка приняла бы `interactive` и ничем на это не ответила.
 * Отсутствующий проп — ошибка типов, то есть отказ громкий. Понадобится
 * интерактивная карточка — копируются и она, и её три переменные, осознанно.
 *
 * ⚠️ Классы скопированы литералами и сторожатся сверкой с апстримом в
 * `src/simple/components/supportCopies.test.ts`: перекрасит апстрим рамку или
 * радиус — сторож покраснеет, а не промолчит.
 */

/** Базовые классы карточки — первый аргумент апстримного `cva(...)`. */
const CARD_BASE = [
  'relative overflow-hidden',
  'border border-dark-700/40 bg-dark-900/70',
  'rounded-[var(--bento-radius)]',
  'transition-[border-color,background-color,box-shadow,transform,opacity] duration-200',
  // Glass border inset
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]',
];

/** Размер `lg` — апстримный `defaultVariants.size`, страница его не меняет. */
const CARD_SIZE = 'p-5 sm:p-6';

export interface CardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, ...props }, ref) => (
    <motion.div ref={ref} className={cn(CARD_BASE, CARD_SIZE, className)} {...props}>
      {children}
    </motion.div>
  ),
);

Card.displayName = 'Card';
