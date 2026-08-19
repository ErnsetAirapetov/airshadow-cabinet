import { describe, expect, it } from 'vitest';
import type { PaymentMethod } from '@/types';
import { resolveAccentedMethodId, topUpHref } from './paymentMethodsState';

/**
 * Правила блока способов оплаты — акцент и адрес карточки (задачи #52, #55).
 *
 * ⚠️ Тесты приехали из `src/simple/pages/balanceState.test.ts` вместе с самими
 * функциями (#58): их единственный потребитель — компонент `PaymentMethodsGrid`,
 * а лежали они в модуле, названном по одной из двух его страниц. Проверки
 * перенесены дословно, поведение не менялось ни на строку.
 *
 * Логика живёт в чистом модуле, потому что отрисовку сетки в тесте не собрать:
 * граф `PaymentMethodsGrid` дотягивается до alias `@/` (`useCurrency`), а он в
 * тестах не резолвится. Границу приёма см. в docs/architecture/two-modes.md,
 * раздел «Тесты».
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

  it('все способы недоступны — акцент всё равно у первого', () => {
    // ⚠️ Инверсия прежнего ожидания (было «акцента нет ни у кого»). Решение
    // владельца 17.08.2026: исключение по доступности убрано целиком, акцент
    // ставится буквально первому элементу списка.
    expect(
      resolveAccentedMethodId([
        method({ id: 'a', is_available: false }),
        method({ id: 'b', is_available: false }),
      ]),
    ).toBe('a');
  });

  it('первый доступен — акцент на нём', () => {
    expect(
      resolveAccentedMethodId([method({ id: 'a' }), method({ id: 'b', is_available: false })]),
    ).toBe('a');
  });

  it('первый недоступен — акцент ВСЁ РАВНО на нём, а не на первом доступном', () => {
    // ⚠️ Эта ветка раньше охраняла прямо противоположное — «акцент перескакивает
    // на первый доступный». Поведение удалено решением владельца 17.08.2026, и
    // тест обязан утверждать обратное, а не молча исчезнуть.
    //
    // Порядок задаёт бэкенд админским `sort_order` — единственный сигнал
    // приоритета в контракте (полей `order`/`priority`/`is_recommended` нет).
    // «Первый» = нулевой элемент этого порядка, доступность не участвует.
    //
    // Принятая цена решения: первым недоступным способом акцент окажется на
    // приглушённой некликабельной карточке. Взамен исчезает дыра в сетке —
    // растянутая карточка всегда первый элемент сетки. Возвращать исключение
    // обратно нельзя.
    expect(
      resolveAccentedMethodId([
        method({ id: 'a', is_available: false }),
        method({ id: 'b' }),
        method({ id: 'c' }),
      ]),
    ).toBe('a');
  });
});

describe('topUpHref', () => {
  it('адрес экрана суммы собирается из id способа', () => {
    expect(topUpHref('platega')).toBe('/balance/top-up/platega');
  });

  it('хвост query доезжает до экрана суммы (задача #55)', () => {
    // ⚠️ Единственная причина, по которой экран выбора способа существует:
    // `amount` и `returnTo` приходят на него от `InsufficientBalancePrompt` и
    // обязаны доехать дальше. Потеря хвоста стоит предзаполнения недостающей
    // суммы и возврата к прерванной покупке.
    expect(topUpHref('platega', '?amount=150&returnTo=%2Fsubscription')).toBe(
      '/balance/top-up/platega?amount=150&returnTo=%2Fsubscription',
    );
  });

  it('без хвоста адрес остаётся прежним — баланс зовёт именно так', () => {
    expect(topUpHref('platega', '')).toBe('/balance/top-up/platega');
  });
});
