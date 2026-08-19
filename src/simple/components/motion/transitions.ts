import type { Variants } from 'framer-motion';

/**
 * Выдержка из апстримного `src/components/motion/transitions.ts` (задача #63).
 *
 * Гейт границ не пускает простой режим в `src/components/motion/**`, а странице
 * поддержки нужна оркестрация появления блоков. Копируем не файл, а ровно две
 * переменные — канон, раздел «Заимствование логики из апстримных components/»,
 * правило «копируем минимум»: апстримный файл несёт больше двух десятков
 * переменных, и ни одна из остальных простому режиму сегодня не нужна.
 *
 * ⚠️ Копия живая, апстрим правит оригинал каждый синк. Расхождение сторожит
 * `src/simple/components/supportCopies.test.ts`: он сверяет тела обеих
 * переменных с апстримными и краснеет, если они разъехались. Снимать сторож
 * можно только вместе с копией.
 */

// Stagger container for lists
export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.02,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1,
    },
  },
};

// Stagger item (use with staggerContainer)
// Exit is instant to avoid visual glitches in Telegram Mini App
export const staggerItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0 } },
};
