import { describe, expect, it } from 'vitest';
import {
  resolveMissingAmountKopeks,
  resolveRenewBalance,
  resolveRenewOptionState,
  resolveRenewSubscriptionId,
} from './renewState';

/**
 * Правила простого экрана продления (задача #29).
 *
 * Главное здесь — ловушка двух источников баланса. Виджет показывает одно число,
 * страница считает «хватает ли» по другому, и человек видит достаточную сумму
 * рядом с надписью «не хватает». Сторож ниже проверяет не текст условия, а
 * поведение: показываемое и расчётное число обязаны совпадать по построению.
 */

describe('баланс экрана продления — одно число (задача #29)', () => {
  it('копейки получаются ИЗ показываемых рублей', () => {
    const balance = resolveRenewBalance({ balance_rubles: 254.15, balance_kopeks: 25415 });

    expect(balance.rubles).toBe(254.15);
    expect(balance.kopeks).toBe(25415);
  });

  it('расходящееся поле ответа НЕ побеждает показанное число', () => {
    // ⚠️ Сердце проверки. `balance_rubles` и `balance_kopeks` заполняет бэкенд
    // независимо; возьми функция копейки из соседнего поля — экран показывал бы
    // 1 ₽ и разрешал покупку на 9 999 ₽. Мутация: заменить тело на
    // `balance.balance_kopeks ?? 0` — этот тест краснеет, остальные нет.
    const balance = resolveRenewBalance({ balance_rubles: 1, balance_kopeks: 999_999 });

    expect(balance.rubles).toBe(1);
    expect(balance.kopeks).toBe(100);
  });

  it('копейки — ровно показанные рубли, округлённые до целой копейки', () => {
    // Свойство, а не пример: сверяем инвариант на разбросе значений, включая
    // плавающую точку, где `254.15 * 100` даёт 25414.999999999996.
    for (const rubles of [0, 0.01, 1, 12.34, 254.15, 999.99, 100_000.5]) {
      const balance = resolveRenewBalance({ balance_rubles: rubles, balance_kopeks: 0 });

      expect(balance.kopeks).toBe(Math.round(balance.rubles * 100));
    }
  });

  it('ответа ещё нет — ноль, а не «хватает»', () => {
    // До ответа человек видит «не хватает», а не ложное «хватает»: так у
    // апстрима (`purchaseOptions?.balance_kopeks ?? 0`).
    expect(resolveRenewBalance(undefined)).toEqual({ rubles: 0, kopeks: 0 });
    expect(resolveRenewBalance(null)).toEqual({ rubles: 0, kopeks: 0 });
  });
});

describe('доступность периода продления', () => {
  it('ровно хватает — покупка разрешена', () => {
    // Граница `>=`, а не `>`: суммой в точности равной цене платить можно.
    expect(resolveRenewOptionState(30_000, 30_000)).toEqual({ canAfford: true, missingKopeks: 0 });
  });

  it('не хватает — считаем недостачу', () => {
    expect(resolveRenewOptionState(10_000, 30_000)).toEqual({
      canAfford: false,
      missingKopeks: 20_000,
    });
  });

  it('когда хватает, недостача ноль, а не отрицательная', () => {
    expect(resolveRenewOptionState(50_000, 30_000).missingKopeks).toBe(0);
  });

  it('бесплатный период доступен и при нулевом балансе', () => {
    expect(resolveRenewOptionState(0, 0)).toEqual({ canAfford: true, missingKopeks: 0 });
  });

  it('расчёт идёт от того же числа, что показывает виджет', () => {
    // ⚠️ Связка двух функций — то, ради чего задача заведена. Виджету уходит
    // `rubles`, доступности — `kopeks`, и оба выходят из одного вызова.
    const balance = resolveRenewBalance({ balance_rubles: 299, balance_kopeks: 1 });

    expect(balance.rubles).toBe(299);
    expect(resolveRenewOptionState(balance.kopeks, 29_900).canAfford).toBe(true);
    expect(resolveRenewOptionState(balance.kopeks, 29_901).canAfford).toBe(false);
  });
});

describe('недостающая сумма из ошибки мутации', () => {
  it('разбирает апстримный формат insufficient:<копейки>', () => {
    expect(resolveMissingAmountKopeks('insufficient:12345')).toBe(12345);
  });

  it('обычная ошибка суммой не притворяется', () => {
    expect(resolveMissingAmountKopeks('Что-то пошло не так')).toBeNull();
    expect(resolveMissingAmountKopeks(null)).toBeNull();
  });

  it('якоря обязательны — иначе сумма выуживалась бы из любого текста', () => {
    // Без `^…$` строка «Ошибка: insufficient:100» дала бы число, и экран показал
    // бы плашку «не хватает 1 ₽» поверх настоящей ошибки.
    expect(resolveMissingAmountKopeks('Ошибка: insufficient:100')).toBeNull();
    expect(resolveMissingAmountKopeks('insufficient:100 ₽')).toBeNull();
  });
});

describe('идентификатор подписки из адреса', () => {
  it('число разбирается', () => {
    expect(resolveRenewSubscriptionId('42')).toBe(42);
  });

  it('пусто и мусор дают undefined — экран уводит на список', () => {
    expect(resolveRenewSubscriptionId(undefined)).toBeUndefined();
    expect(resolveRenewSubscriptionId('')).toBeUndefined();
    expect(resolveRenewSubscriptionId('abc')).toBeUndefined();
  });
});
