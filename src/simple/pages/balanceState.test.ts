import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PaymentMethod } from '@/types';
import {
  PROMOCODE_ERROR_KEYS,
  resolveAccentedMethodId,
  resolvePaymentReturnRedirect,
  resolvePromocodeErrorKey,
  resolveTransactionAmount,
  resolveTransactionBadge,
  resolveTransactionLabelKey,
  topUpHref,
} from './balanceState';

/**
 * Вся ветвящаяся логика простого баланса живёт в чистом модуле именно ради этих
 * тестов: компонентных тестов в репе не бывает (`vitest.config.ts` —
 * `environment: 'node'`, ни jsdom, ни testing-library). Значит либо логика
 * вынесена и проверена, либо не проверена вовсе.
 */

function method(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: 'platega',
    name: 'Платега',
    description: null,
    min_amount_kopeks: 10_000,
    max_amount_kopeks: 5_000_000,
    is_available: true,
    ...overrides,
  };
}

describe('resolveAccentedMethodId', () => {
  it('пустой список — акцента нет ни у кого', () => {
    // Сетка рисуется как обычно, а не «первая карточка отсутствует».
    expect(resolveAccentedMethodId([])).toBeNull();
  });

  it('данных ещё нет — акцента нет', () => {
    expect(resolveAccentedMethodId(undefined)).toBeNull();
  });

  it('все способы недоступны — акцента нет ни у кого', () => {
    // ⚠️ Ключевая ветка. Приглушённая (`opacity-50`) и некликабельная карточка с
    // акцентной рамкой и свечением читалась бы как сломанная: вид зовёт нажать,
    // нажатие ничего не делает.
    expect(
      resolveAccentedMethodId([
        method({ id: 'a', is_available: false }),
        method({ id: 'b', is_available: false }),
      ]),
    ).toBeNull();
  });

  it('первый доступен — акцент на нём', () => {
    expect(
      resolveAccentedMethodId([method({ id: 'a' }), method({ id: 'b', is_available: false })]),
    ).toBe('a');
  });

  it('первый недоступен — акцент на первом ДОСТУПНОМ, а не на нулевом элементе', () => {
    // Порядок задаёт бэкенд админским `sort_order` — это единственный сигнал
    // приоритета в контракте (полей `order`/`priority`/`is_recommended` нет).
    // Значит акцент идёт первому доступному по этому порядку.
    expect(
      resolveAccentedMethodId([
        method({ id: 'a', is_available: false }),
        method({ id: 'b' }),
        method({ id: 'c' }),
      ]),
    ).toBe('b');
  });
});

describe('resolvePromocodeErrorKey', () => {
  it('код из белого списка проходит как есть', () => {
    expect(resolvePromocodeErrorKey({ code: 'daily_limit' })).toBe('daily_limit');
    expect(resolvePromocodeErrorKey({ code: 'not_found' })).toBe('not_found');
  });

  it('незнакомый код сводится к server_error', () => {
    // Белый список нужен именно для этого: у ключа сообщения должен быть
    // перевод, иначе пользователь увидит сырой машинный код.
    expect(resolvePromocodeErrorKey({ code: 'teapot' })).toBe('server_error');
  });

  it('detail строкой — server_error, а не падение', () => {
    // Бэкенд иногда отдаёт `detail` строкой; читать `.code` у строки нельзя.
    expect(resolvePromocodeErrorKey('что-то пошло не так')).toBe('server_error');
  });

  it('detail отсутствует — server_error', () => {
    expect(resolvePromocodeErrorKey(undefined)).toBe('server_error');
  });

  it('белый список — те же 15 кодов, что у апстрима', () => {
    expect(PROMOCODE_ERROR_KEYS).toHaveLength(15);
  });
});

describe('resolveTransactionBadge и resolveTransactionLabelKey', () => {
  it('пополнение', () => {
    expect(resolveTransactionBadge('DEPOSIT')).toBe('badge-success');
    expect(resolveTransactionLabelKey('DEPOSIT')).toBe('balance.deposit');
  });

  it('оплата подписки', () => {
    expect(resolveTransactionBadge('SUBSCRIPTION_PAYMENT')).toBe('badge-info');
    expect(resolveTransactionLabelKey('SUBSCRIPTION_PAYMENT')).toBe('balance.subscriptionPayment');
  });

  it('реферальная выплата', () => {
    expect(resolveTransactionBadge('REFERRAL_REWARD')).toBe('badge-warning');
    expect(resolveTransactionLabelKey('REFERRAL_REWARD')).toBe('balance.referralReward');
  });

  it('списание', () => {
    expect(resolveTransactionBadge('WITHDRAWAL')).toBe('badge-error');
    expect(resolveTransactionLabelKey('WITHDRAWAL')).toBe('balance.withdrawal');
  });

  it('нижний регистр от бэкенда нормализуется', () => {
    // Апстрим приводит тип к верхнему регистру перед сравнением — бэкенд отдаёт
    // и `deposit`, и `DEPOSIT`.
    expect(resolveTransactionBadge('deposit')).toBe('badge-success');
    expect(resolveTransactionLabelKey('deposit')).toBe('balance.deposit');
  });

  it('незнакомый тип — нейтральный бейдж, подписью служит сам тип', () => {
    expect(resolveTransactionBadge('MOON_TAX')).toBe('badge-neutral');
    // `null` означает «перевода нет, показывай сырой тип» — так делает апстрим.
    expect(resolveTransactionLabelKey('MOON_TAX')).toBeNull();
  });
});

describe('resolveTransactionAmount', () => {
  it('приход — плюс и зелёный', () => {
    expect(resolveTransactionAmount(120.5)).toEqual({
      sign: '+',
      value: 120.5,
      colorClass: 'text-success-400',
    });
  });

  it('расход — минус, значение по модулю и красный', () => {
    expect(resolveTransactionAmount(-99)).toEqual({
      sign: '-',
      value: 99,
      colorClass: 'text-error-400',
    });
  });

  it('нуль — без знака и без цвета', () => {
    // Нулевая операция (например, промокод-скидка) не приход и не расход.
    expect(resolveTransactionAmount(0)).toEqual({
      sign: '',
      value: 0,
      colorClass: 'text-dark-400',
    });
  });
});

describe('resolvePaymentReturnRedirect', () => {
  const params = (entries: Record<string, string>) => new URLSearchParams(entries);

  it('без параметров возврата никуда не уводим', () => {
    expect(resolvePaymentReturnRedirect(params({}))).toBeNull();
  });

  it('успех по параметру payment', () => {
    expect(resolvePaymentReturnRedirect(params({ payment: 'succeeded' }))).toBe(
      '/balance/top-up/result?status=success',
    );
  });

  it('успех по параметру status, регистр не важен', () => {
    expect(resolvePaymentReturnRedirect(params({ status: 'PAID' }))).toBe(
      '/balance/top-up/result?status=success',
    );
  });

  it('успех по параметру success=true даже без статуса', () => {
    // Отдельная ветка апстрима: часть провайдеров возвращает только этот флаг.
    expect(resolvePaymentReturnRedirect(params({ success: 'true' }))).toBe(
      '/balance/top-up/result?status=success',
    );
  });

  it('отказ провайдера ведёт на экран неудачи', () => {
    expect(resolvePaymentReturnRedirect(params({ status: 'declined' }))).toBe(
      '/balance/top-up/result?status=failed',
    );
  });

  it('незнакомый статус не уводит никуда', () => {
    expect(resolvePaymentReturnRedirect(params({ status: 'pending' }))).toBeNull();
  });

  it('success=false со статусом отказа — всё равно отказ', () => {
    expect(resolvePaymentReturnRedirect(params({ success: 'false', payment: 'error' }))).toBe(
      '/balance/top-up/result?status=failed',
    );
  });
});

describe('topUpHref', () => {
  it('адрес экрана суммы собирается из id способа', () => {
    expect(topUpHref('platega')).toBe('/balance/top-up/platega');
  });
});

/**
 * Сторож апстримного адреса пополнения.
 *
 * Карточки способов ведут на `/balance/top-up/{id}` — маршрут апстримный, экраны
 * `/balance/top-up/*` в простом режиме не копируются (спеки на них нет). Апстрим
 * может переименовать маршрут при синке, и тогда карточки молча начнут вести в
 * никуда при зелёной сборке: `navigate` на несуществующий путь исключения не
 * бросает.
 *
 * Файл читается ТЕКСТОМ по той же причине, что реестр в `routes.test.tsx`: импорт
 * `App.tsx` потянул бы весь граф приложения через alias `@/`, которого нет в
 * `vitest.config.ts` (конфиг апстримный, править его нельзя).
 */
describe('маршрут пополнения в App.tsx не переименован', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const declaredPaths = [...appSource.matchAll(/path="([^"]+)"/g)].map((match) => match[1]);

  it('разбор App.tsx удался — иначе сторож сверял бы пустоту', () => {
    // Без этой пары сломанная регулярка дала бы пустой список, и проверки ниже
    // проходили бы всегда, ничего не охраняя.
    expect(declaredPaths.length).toBeGreaterThan(20);
    expect(declaredPaths).toContain('/balance');
  });

  it('экран суммы объявлен по тому адресу, на который ведут карточки способов', () => {
    expect(declaredPaths).toContain('/balance/top-up/:methodId');
  });

  it('экран результата платежа объявлен — на него уводит возврат от шлюза', () => {
    expect(declaredPaths).toContain('/balance/top-up/result');
  });
});
