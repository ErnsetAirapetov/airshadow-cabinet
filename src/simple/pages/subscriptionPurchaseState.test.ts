import { describe, expect, it } from 'vitest';
import type { PurchaseOptions, Subscription } from '@/types';
import {
  resolvePurchaseBackTarget,
  resolvePurchaseScreen,
  resolvePurchaseSubscriptionId,
  resolvePurchaseTitleKey,
  resolveSalesMode,
} from './subscriptionPurchaseState';

/**
 * Правила простого экрана покупки (задача #29).
 *
 * ⚠️ Самое дорогое здесь — ВЫБОР РЕЖИМА ПРОДАЖ. Их два, и на стенде виден
 * только тарифный: ошибка в классической ветке даёт пустой экран на другой
 * инсталляции, и ни сборка, ни глазами-на-стенде это не поймают.
 *
 * Данные собираются минимальными объектами с приведением типа: чистой функции
 * важны считанные поля, а полный `Tariff` в тесте был бы тридцатью строками шума
 * и ломался бы от каждого нового поля апстрима.
 */

const tariffsOptions = (extra: Record<string, unknown> = {}) =>
  ({ sales_mode: 'tariffs', tariffs: [{ id: 1 }], balance_kopeks: 0, ...extra }) as PurchaseOptions;

const classicOptions = (extra: Record<string, unknown> = {}) =>
  ({
    sales_mode: 'classic',
    periods: [{ days: 30 }],
    balance_kopeks: 0,
    ...extra,
  }) as unknown as PurchaseOptions;

describe('состояние экрана покупки', () => {
  const base = {
    isSubscriptionLoading: false,
    isOptionsLoading: false,
    isOptionsError: false,
    purchaseOptions: tariffsOptions(),
  };

  it('пока грузится любой из двух запросов — спиннер', () => {
    expect(resolvePurchaseScreen({ ...base, isSubscriptionLoading: true })).toBe('loading');
    expect(resolvePurchaseScreen({ ...base, isOptionsLoading: true })).toBe('loading');
  });

  it('запрос вариантов упал — экран ошибки с повтором', () => {
    expect(resolvePurchaseScreen({ ...base, isOptionsError: true })).toBe('error');
  });

  it('запрос завершился без данных — тоже ошибка, а не пустое содержимое', () => {
    // ⚠️ Не тавтология проверки загрузки: запрос МОЖЕТ завершиться без данных.
    // Без этой ветки экран рисовал бы содержимое по `undefined`.
    expect(resolvePurchaseScreen({ ...base, purchaseOptions: undefined })).toBe('error');
  });

  it('загрузка важнее ошибки — иначе мелькнёт «не удалось» на ровном месте', () => {
    expect(
      resolvePurchaseScreen({ ...base, isOptionsLoading: true, purchaseOptions: undefined }),
    ).toBe('loading');
  });

  it('данные пришли — содержимое', () => {
    expect(resolvePurchaseScreen(base)).toBe('content');
  });
});

describe('режим продаж: обе ветки живы (задача #29)', () => {
  it('тарифный режим отдаёт витрину тарифов', () => {
    const mode = resolveSalesMode(tariffsOptions());

    expect(mode.isTariffsMode).toBe(true);
    expect(mode.tariffs).toHaveLength(1);
    expect(mode.classicOptions).toBeNull();
    expect(mode.showTariffsSection).toBe(true);
    expect(mode.showClassicSection).toBe(false);
  });

  it('классический режим отдаёт мастер покупки', () => {
    // ⚠️ Ветка, которой не видно на стенде. Потеряй её — на инсталляции без
    // тарифов простой экран покупки окажется пустым.
    const mode = resolveSalesMode(classicOptions());

    expect(mode.isTariffsMode).toBe(false);
    expect(mode.classicOptions).not.toBeNull();
    expect(mode.showClassicSection).toBe(true);
    expect(mode.showTariffsSection).toBe(false);
  });

  it('признак режима — только sales_mode, а не наличие поля tariffs', () => {
    // Ответ классического режима с пустым `tariffs` не должен превращаться в
    // тарифный: решает бэкенд, а не форма объекта.
    const mode = resolveSalesMode(classicOptions({ tariffs: [{ id: 7 }] }));

    expect(mode.isTariffsMode).toBe(false);
    expect(mode.tariffs).toEqual([]);
  });

  it('тарифный режим с пустой витриной не показывает секцию', () => {
    const mode = resolveSalesMode(tariffsOptions({ tariffs: [] }));

    expect(mode.showTariffsSection).toBe(false);
    expect(mode.showNoOptionsFallback).toBe(true);
  });

  it('классический режим без периодов не показывает мастер', () => {
    const mode = resolveSalesMode(classicOptions({ periods: [] }));

    expect(mode.showClassicSection).toBe(false);
    expect(mode.showNoOptionsFallback).toBe(true);
  });

  it('обе ветки пусты — показываем «вариантов нет», а не белый экран', () => {
    expect(resolveSalesMode(tariffsOptions({ tariffs: [] })).showNoOptionsFallback).toBe(true);
  });

  it('данных ещё нет — «вариантов нет» не показываем', () => {
    // Иначе на кадре до ответа человек читал бы «нет доступных вариантов»,
    // хотя запрос ещё летит.
    const mode = resolveSalesMode(undefined);

    expect(mode.showNoOptionsFallback).toBe(false);
    expect(mode.showTariffsSection).toBe(false);
    expect(mode.showClassicSection).toBe(false);
    expect(mode.classicOptions).toBeNull();
  });
});

describe('заголовок экрана', () => {
  const sub = (extra: Partial<Subscription> = {}) =>
    ({ is_trial: false, is_daily: false, tariff_id: 5, ...extra }) as Subscription;

  it('мультитариф без конкретной подписки — «Новый тариф»', () => {
    expect(
      resolvePurchaseTitleKey({
        isMultiTariff: true,
        subscriptionId: undefined,
        subscription: sub(),
      }),
    ).toBe('subscription.newTariff');
  });

  it('мультитариф с указанной подпиской — уже продление, а не новый тариф', () => {
    // Порядок лестницы: `?subscriptionId=N` означает «продлить именно эту».
    expect(
      resolvePurchaseTitleKey({ isMultiTariff: true, subscriptionId: 7, subscription: sub() }),
    ).toBe('subscription.extend');
  });

  it('посуточная не-триальная подписка — «Сменить тариф»', () => {
    expect(
      resolvePurchaseTitleKey({
        isMultiTariff: false,
        subscriptionId: undefined,
        subscription: sub({ is_daily: true }),
      }),
    ).toBe('subscription.switchTariff.title');
  });

  it('посуточный триал сменой тарифа не считается', () => {
    expect(
      resolvePurchaseTitleKey({
        isMultiTariff: false,
        subscriptionId: undefined,
        subscription: sub({ is_daily: true, is_trial: true }),
      }),
    ).toBe('subscription.getSubscription');
  });

  it('обычная подписка — «Продлить»', () => {
    expect(
      resolvePurchaseTitleKey({
        isMultiTariff: false,
        subscriptionId: undefined,
        subscription: sub(),
      }),
    ).toBe('subscription.extend');
  });

  it('подписки нет — «Получить подписку»', () => {
    expect(
      resolvePurchaseTitleKey({
        isMultiTariff: false,
        subscriptionId: undefined,
        subscription: null,
      }),
    ).toBe('subscription.getSubscription');
  });
});

describe('кнопка назад', () => {
  it('пришли из своей подписки — возвращаемся в неё', () => {
    expect(resolvePurchaseBackTarget(7)).toBe('/subscriptions/7');
  });

  it('пришли со списка — возвращаемся в список', () => {
    expect(resolvePurchaseBackTarget(undefined)).toBe('/subscriptions');
  });
});

describe('subscriptionId из адреса', () => {
  const params = (value: string | null) => ({ get: () => value });

  it('число разбирается', () => {
    expect(resolvePurchaseSubscriptionId(params('42'))).toBe(42);
  });

  it('параметра нет — undefined', () => {
    expect(resolvePurchaseSubscriptionId(params(null))).toBeUndefined();
    expect(resolvePurchaseSubscriptionId(params(''))).toBeUndefined();
  });

  it('мусор не превращается в NaN — иначе он уехал бы в ключ запроса', () => {
    // Апстрим здесь отдаёт NaN и шлёт его на бэкенд параметром запроса.
    expect(resolvePurchaseSubscriptionId(params('abc'))).toBeUndefined();
  });
});
