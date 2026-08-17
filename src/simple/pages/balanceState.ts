import type { PaymentMethod } from '@/types';
// ⚠️ ОТНОСИТЕЛЬНЫЙ путь, а не alias `@/utils/paymentStatus`, хотя апстримный
// `Balance.tsx` пишет так же относительно себя. Alias `@/` объявлен в
// `vite.config.ts`, а vitest читает свой конфиг — импорт через alias уронил бы
// тест этого модуля на разрешении модулей. Тип ниже алиасом импортировать можно:
// `import type` стирается при трансформации. Сам `utils/paymentStatus` не
// импортирует ничего вообще, так что относительный путь не тянет за собой граф.
import { isFailedStatus, isPaidStatus } from '../../utils/paymentStatus';

/**
 * Состояние простого баланса.
 *
 * Вынесено в чистый модуль намеренно: компонентных тестов в репе не бывает
 * (`vitest.config.ts` — `environment: 'node'`, ни jsdom, ни testing-library), и
 * без такого модуля ветки «какой способ акцентный», «во что превратился код
 * ошибки промокода», «куда уводит возврат от шлюза» остались бы непроверенными
 * вообще.
 *
 * Правила статусов платежа не переписываем своими словами: `isPaidStatus` и
 * `isFailedStatus` — общий фундамент (`src/utils/**`, не `pages/` и не
 * `components/`), границы режимов такой импорт пропускают. Свой список статусов
 * стал бы вторым источником истины и разъехался бы с апстримным молча.
 */

/**
 * id способа оплаты, чья карточка рисуется акцентной.
 *
 * ⚠️ Акцент идёт первому ДОСТУПНОМУ способу, а не нулевому элементу массива.
 * Недоступный способ приглушён (`opacity-50`) и некликабелен — акцентная рамка со
 * свечением на нём читалась бы как сломанная кнопка: вид зовёт нажать, нажатие
 * ничего не делает.
 *
 * Порядок списка задаёт бэкенд админским `sort_order`, и это единственный сигнал
 * приоритета в контракте: полей `order`, `priority` и `is_recommended` в
 * `PaymentMethod` нет. Значит «первый» здесь — первый по порядку бэкенда.
 *
 * Ни одного доступного способа — `null`: акцента нет ни у кого, сетка рисуется
 * как обычно.
 */
export function resolveAccentedMethodId(methods: PaymentMethod[] | undefined): string | null {
  return methods?.find((method) => method.is_available)?.id ?? null;
}

/**
 * Белый список машинных кодов ошибки промокода — копия апстримного набора из
 * `src/pages/Balance.tsx`.
 *
 * Список нужен, чтобы у ключа сообщения гарантированно был перевод: неизвестный
 * код иначе доехал бы до интерфейса сырым. Прежний апстримный контракт сравнивал
 * английскую прозу подстрокой и молча сводил каждый неучтённый код к «ошибке
 * сервера» — отсюда и белый список по стабильному коду.
 */
export const PROMOCODE_ERROR_KEYS = [
  'not_found',
  'expired',
  'inactive',
  'not_yet_valid',
  'used',
  'already_used_by_user',
  'active_discount_exists',
  'no_subscription_for_days',
  'subscription_not_found',
  'not_first_purchase',
  'daily_limit',
  'trial_subscription_exists',
  'trial_provisioning_failed',
  'user_not_found',
  'server_error',
] as const;

const FALLBACK_PROMOCODE_ERROR_KEY = 'server_error';

/**
 * Ключ сообщения по `detail` из ответа бэкенда.
 *
 * `detail` приходит либо объектом `{ code, message }`, либо строкой — читать
 * `.code` у строки нельзя, поэтому тип проверяется явно.
 */
export function resolvePromocodeErrorKey(
  detail: { code?: string } | string | undefined | null,
): string {
  const code = typeof detail === 'object' && detail ? detail.code : undefined;

  return code && (PROMOCODE_ERROR_KEYS as readonly string[]).includes(code)
    ? code
    : FALLBACK_PROMOCODE_ERROR_KEY;
}

/** Бэкенд отдаёт тип операции и в верхнем, и в нижнем регистре. */
function normalizeType(type: string): string {
  return type?.toUpperCase?.() ?? type;
}

const TRANSACTION_BADGES: Record<string, string> = {
  DEPOSIT: 'badge-success',
  SUBSCRIPTION_PAYMENT: 'badge-info',
  REFERRAL_REWARD: 'badge-warning',
  WITHDRAWAL: 'badge-error',
};

const TRANSACTION_LABEL_KEYS: Record<string, string> = {
  DEPOSIT: 'balance.deposit',
  SUBSCRIPTION_PAYMENT: 'balance.subscriptionPayment',
  REFERRAL_REWARD: 'balance.referralReward',
  WITHDRAWAL: 'balance.withdrawal',
};

/** Класс бейджа типа операции; незнакомый тип — нейтральный. */
export function resolveTransactionBadge(type: string): string {
  return TRANSACTION_BADGES[normalizeType(type)] ?? 'badge-neutral';
}

/**
 * Ключ подписи типа операции или `null`, если перевода нет.
 *
 * `null` означает «показывай сырой тип» — так же поступает апстрим: новый тип
 * операции с бэкенда лучше показать машинным именем, чем спрятать.
 */
export function resolveTransactionLabelKey(type: string): string | null {
  return TRANSACTION_LABEL_KEYS[normalizeType(type)] ?? null;
}

export interface TransactionAmountDisplay {
  sign: '' | '+' | '-';
  /** Значение по модулю: знак несёт `sign`, чтобы не было «-−99». */
  value: number;
  colorClass: string;
}

/** Знак, модуль и цвет суммы операции. Нуль — не приход и не расход. */
export function resolveTransactionAmount(amountRubles: number): TransactionAmountDisplay {
  if (amountRubles === 0) {
    return { sign: '', value: 0, colorClass: 'text-dark-400' };
  }
  if (amountRubles > 0) {
    return { sign: '+', value: amountRubles, colorClass: 'text-success-400' };
  }
  return { sign: '-', value: Math.abs(amountRubles), colorClass: 'text-error-400' };
}

/** Экран суммы пополнения — апстримный маршрут `/balance/top-up/:methodId`. */
export function topUpHref(methodId: string): string {
  return `/balance/top-up/${methodId}`;
}

/**
 * Куда уводит возврат от платёжного шлюза, или `null`, если это обычный вход на
 * страницу.
 *
 * ⚠️ Обязательный побочный эффект страницы, а не украшение: провайдер возвращает
 * человека на `/balance` с параметрами результата, и без перехвата он видит
 * баланс и не понимает, прошла оплата или нет.
 *
 * Ветка `success=true` отдельная, потому что часть провайдеров возвращает только
 * этот флаг, без статуса.
 */
export function resolvePaymentReturnRedirect(searchParams: URLSearchParams): string | null {
  const paymentStatus = searchParams.get('payment') || searchParams.get('status');
  const normalised = paymentStatus?.toLowerCase() ?? '';

  if (isPaidStatus(normalised) || searchParams.get('success') === 'true') {
    return '/balance/top-up/result?status=success';
  }
  if (isFailedStatus(normalised)) {
    return '/balance/top-up/result?status=failed';
  }
  return null;
}
