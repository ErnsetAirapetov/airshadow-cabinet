import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import simpleRu from '../../locales/ru.json';
import {
  DEFAULT_RENEW_LABEL_KEY,
  MIN_RENEW_BALANCE_KOPEKS,
  NON_RENEWABLE_STATUSES,
  PAGE_RENEW_LABEL_KEY,
  PURCHASE_LABEL_KEY,
  RENEW_PERIOD_DAYS,
  hasBalanceForRenew,
  isNonRenewableStatus,
  isPausedDailySubscription,
  resolveExpiredActionButton,
  resolveExpiredActionLabelKey,
  resolveExpiredRenewOperation,
} from './expiredAction';
import { PURCHASE_ROUTE, paymentRoute } from './purchaseCta';
import type { Subscription } from '@/types';

/**
 * Чистая логика единственной кнопки истёкшей платной подписки (задача #65).
 *
 * ⚠️ Правило было записано разметкой карточки главной, то есть проверить его
 * было нечем: компонентных тестов в проекте не бывает (`environment: 'node'`,
 * alias `@/` в тестах не разрешается — docs/architecture/two-modes.md, раздел
 * «Тесты»). С #65 блок действия стал общим для двух экранов, и ветвление
 * переехало сюда — теперь оно проверяется вызовом функции.
 *
 * Модуль импортируется НАПРЯМУЮ: из `@/types` он берёт только типы, а `import
 * type` стирается при трансформации, так что alias ему не нужен.
 */

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 7,
    status: 'active',
    is_trial: false,
    start_date: '2026-08-01T00:00:00',
    end_date: '2026-09-01T00:00:00',
    days_left: 0,
    hours_left: 0,
    minutes_left: 0,
    time_left_display: '0 дней',
    traffic_limit_gb: 100,
    traffic_used_gb: 1,
    traffic_used_percent: 1,
    device_limit: 3,
    connected_squads: [],
    servers: [],
    autopay_enabled: false,
    autopay_days_before: 3,
    subscription_url: null,
    hide_subscription_link: false,
    is_active: false,
    is_expired: true,
    is_limited: false,
    ...overrides,
  };
}

describe('hasBalanceForRenew: порог «денег хватает»', () => {
  it('обычная подписка — хотя бы рубль', () => {
    // ⚠️ Проверка ГРУБАЯ и цены продления не знает: она отвечает только на
    // «есть ли на балансе хоть что-то». Отсюда и второе слагаемое правила —
    // реальный отказ API перебивает её (см. `resolveExpiredCardAction`).
    expect(hasBalanceForRenew({ subscription: sub(), balanceKopeks: 100 })).toBe(true);
    expect(hasBalanceForRenew({ subscription: sub(), balanceKopeks: 99 })).toBe(false);
    expect(hasBalanceForRenew({ subscription: sub(), balanceKopeks: 0 })).toBe(false);
  });

  it('порог рубля записан константой, а не литералом в двух местах', () => {
    expect(MIN_RENEW_BALANCE_KOPEKS).toBe(100);
  });

  it('суточный тариф — баланс не меньше суточной цены', () => {
    const daily = sub({ is_daily: true, daily_price_kopeks: 1500 });

    expect(hasBalanceForRenew({ subscription: daily, balanceKopeks: 1500 })).toBe(true);
    expect(hasBalanceForRenew({ subscription: daily, balanceKopeks: 1499 })).toBe(false);
  });

  it('суточный тариф без цены — денег не хватает ни при каком балансе', () => {
    // ⚠️ Нулевая цена означает «цену не отдали», а не «продление бесплатно»:
    // с `>= 0` кнопка продления показалась бы при пустом балансе и отказала бы
    // на первом же нажатии. Мутация «убрать `dailyPrice > 0`» красит этот тест.
    const noPrice = sub({ is_daily: true, daily_price_kopeks: 0 });

    expect(hasBalanceForRenew({ subscription: noPrice, balanceKopeks: 100_000 })).toBe(false);
    expect(hasBalanceForRenew({ subscription: noPrice, balanceKopeks: 0 })).toBe(false);
  });

  it('суточный тариф без поля цены считается как без цены', () => {
    const undefinedPrice = sub({ is_daily: true });

    expect(hasBalanceForRenew({ subscription: undefinedPrice, balanceKopeks: 100_000 })).toBe(
      false,
    );
  });

  it('порог суточного не применяется к обычной подписке', () => {
    // Мутация «считать порогом суточную цену всегда» красит здесь: у обычной
    // подписки поле цены тоже бывает заполнено.
    const withDailyPrice = sub({ is_daily: false, daily_price_kopeks: 100_000 });

    expect(hasBalanceForRenew({ subscription: withDailyPrice, balanceKopeks: 100 })).toBe(true);
  });
});

describe('isPausedDailySubscription: приостановленный суточный тариф', () => {
  it('суточный тариф со статусом disabled', () => {
    expect(isPausedDailySubscription(sub({ is_daily: true, status: 'disabled' }))).toBe(true);
  });

  it('обычная подписка со статусом disabled — не приостановленный суточный', () => {
    // ⚠️ Снятие с паузы — механизм суточного тарифа: у обычной подписки
    // `togglePause` не при чём.
    expect(isPausedDailySubscription(sub({ status: 'disabled' }))).toBe(false);
  });

  it('истёкший суточный тариф — не приостановленный', () => {
    expect(isPausedDailySubscription(sub({ is_daily: true, status: 'expired' }))).toBe(false);
  });
});

describe('NON_RENEWABLE_STATUSES: чего бэкенд не продлевает вовсе (#67)', () => {
  it('список ровно тот, что объявлен бэкендом', () => {
    // ⚠️ Не «disabled и на всякий случай что-то ещё»: это КОПИЯ множества
    // `_non_renewable` из `renewal.py:130-136`. Разъедется бэкенд — экран
    // получит 400 обратно, и сверять список придётся снова по тому же файлу,
    // ссылка на который стоит в докстринге константы.
    expect([...NON_RENEWABLE_STATUSES]).toEqual(['disabled', 'pending']);
  });

  it('предикат ловит оба статуса', () => {
    expect(isNonRenewableStatus(sub({ status: 'disabled' }))).toBe(true);
    // ⚠️ `pending` — вторая половина отказа. Условие «только про disabled»
    // краснеет здесь: `pending` сломался бы ровно так же, просто позже.
    expect(isNonRenewableStatus(sub({ status: 'pending' }))).toBe(true);
  });

  it('обычные статусы предикат не ловит', () => {
    // Мутация «считать непродлеваемым всё, кроме active» краснеет здесь:
    // истёкшая подписка продлевается, это её единственное действие.
    expect(isNonRenewableStatus(sub({ status: 'expired' }))).toBe(false);
    expect(isNonRenewableStatus(sub({ status: 'active' }))).toBe(false);
    expect(isNonRenewableStatus(sub({ status: 'trial' }))).toBe(false);
  });
});

describe('resolveExpiredRenewOperation: чем именно продлеваем', () => {
  it('приостановленный суточный тариф — снятие с паузы, а не покупка', () => {
    // `status === 'disabled'` у суточного означает «списания остановлены»;
    // покупка тарифа поверх дала бы «Тариф уже активен» и возврат средств.
    const paused = sub({ is_daily: true, status: 'disabled', tariff_id: 12 });

    expect(resolveExpiredRenewOperation(paused)).toEqual({ kind: 'resumeDaily' });
  });

  it('истёкший суточный тариф — покупка на один день', () => {
    const daily = sub({ is_daily: true, status: 'expired', tariff_id: 12 });

    expect(resolveExpiredRenewOperation(daily)).toEqual({
      kind: 'purchaseDailyTariff',
      tariffId: 12,
      days: 1,
    });
  });

  it('суточный тариф без идентификатора тарифа — обычное продление', () => {
    // Покупать нечего: без `tariff_id` запрос не собрать.
    const daily = sub({ is_daily: true, status: 'expired' });

    expect(resolveExpiredRenewOperation(daily)).toEqual({
      kind: 'renewSubscription',
      days: RENEW_PERIOD_DAYS,
    });
  });

  it('обычная истёкшая подписка — продление на период', () => {
    expect(resolveExpiredRenewOperation(sub())).toEqual({
      kind: 'renewSubscription',
      days: RENEW_PERIOD_DAYS,
    });
  });

  it('обычная подписка со статусом disabled — витрина, а не продление (#67)', () => {
    // ⚠️ Дефект, с которого заведена #67: бэкенд отвечал на продление
    // `Cannot renew subscription with status: disabled`, потому что этот статус
    // объявлен непродлеваемым (`renewal.py:130-136`). Снятие с паузы тут тоже
    // не годится — `togglePause` это механизм суточного тарифа.
    const disabled = sub({ status: 'disabled' });

    // ⚠️ С #69 переход ведёт не в витрину, а на ЕДИНЫЙ экран оплаты той же
    // подписки: `id` подписки здесь `7`, значит `/subscriptions/7/renew`.
    expect(resolveExpiredRenewOperation(disabled)).toEqual({
      kind: 'openPurchase',
      to: '/subscriptions/7/renew',
    });
  });

  it('статус pending закрыт тем же правилом', () => {
    // ⚠️ Второй статус из того же множества бэкенда. Условие, написанное только
    // под `disabled`, краснеет здесь.
    expect(resolveExpiredRenewOperation(sub({ status: 'pending' }))).toEqual({
      kind: 'openPurchase',
      to: '/subscriptions/7/renew',
    });
  });

  it('адрес перехода — ТОТ ЖЕ, что у кнопки продления активной подписки (#69)', () => {
    // ⚠️ Сердце #69 в этом модуле. Владелец забраковал ровно то, что оплата
    // открывалась на двух разных экранах; мутация «вернуть здесь витрину»
    // краснеет здесь, а не на стенде, где состояние `disabled` воспроизвести
    // нечем.
    const disabled = sub({ status: 'disabled' });
    const operation = resolveExpiredRenewOperation(disabled);

    expect(operation.kind).toBe('openPurchase');
    expect(operation).toHaveProperty('to', paymentRoute(disabled.id));
    expect(operation).not.toHaveProperty('to', PURCHASE_ROUTE);
  });

  it('без id подписки адрес оплаты собрать нечем — остаётся витрина (#69)', () => {
    // Страховка того же рода, что в `resolveAllSubscriptionActions`: `id`
    // приходит от API, и нулевой он означает «строки нет». Ссылка
    // `/subscriptions/0/renew` вела бы в никуда.
    const operation = resolveExpiredRenewOperation(sub({ status: 'pending', id: 0 }));

    expect(operation).toEqual({ kind: 'openPurchase', to: PURCHASE_ROUTE });
  });

  it('у навигационной операции нет ни дней, ни тарифа', () => {
    // ⚠️ Переход — это не мутация: полей, которыми разметка могла бы позвать
    // продление или покупку, у этого вида операции не существует. Адрес (#69) —
    // единственное, что к нему добавилось, и он тоже не мутация.
    expect(Object.keys(resolveExpiredRenewOperation(sub({ status: 'disabled' }))).sort()).toEqual([
      'kind',
      'to',
    ]);
  });

  it('приостановленный суточный тариф остаётся ВЫШЕ витрины', () => {
    // ⚠️ Порядок веток. У суточной на паузе статус тоже `disabled`, но для неё
    // `togglePause` бэкендом разрешён и проверен (#65). Мутация «поставить
    // ветку витрины первой» краснеет здесь: человек, остановивший списания,
    // вместо возобновления уезжал бы покупать тариф заново.
    const paused = sub({ is_daily: true, status: 'disabled', tariff_id: 12 });

    expect(resolveExpiredRenewOperation(paused)).toEqual({ kind: 'resumeDaily' });
  });

  it('период продления записан константой', () => {
    expect(RENEW_PERIOD_DAYS).toBe(30);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Перебор состояний: продление НЕ зовётся при непродлеваемом статусе (#67).
 *
 * Примеры выше показывают отдельные состояния, а правило должно держаться на
 * всех сразу: у подписки независимо крутятся суточный тариф, наличие
 * `tariff_id`, `is_expired` и статус, и именно на их сочетании дефект и жил —
 * не суточная подписка со статусом `disabled` проваливалась в последнюю ветку.
 * ══════════════════════════════════════════════════════════════════════════ */

const OPERATION_STATES: { name: string; subscription: Subscription }[] = [];

for (const isDaily of [true, false]) {
  for (const tariffId of [12, undefined]) {
    for (const status of ['active', 'expired', 'disabled', 'pending', 'trial']) {
      for (const isExpired of [true, false]) {
        for (const isDailyPaused of [true, false]) {
          OPERATION_STATES.push({
            name: `daily=${isDaily} tariff=${tariffId} status=${status} expired=${isExpired} paused=${isDailyPaused}`,
            subscription: sub({
              is_daily: isDaily,
              tariff_id: tariffId,
              status,
              is_expired: isExpired,
              is_daily_paused: isDailyPaused,
            }),
          });
        }
      }
    }
  }
}

describe('перебор: непродлеваемый статус не зовёт продление (#67)', () => {
  it('разбор удался — перебор собран и в нём есть обе стороны правила', () => {
    // Без этой пары пустой или однобокий перебор давал бы вечно зелёное правило.
    expect(OPERATION_STATES.length).toBeGreaterThan(50);
    expect(OPERATION_STATES.some(({ subscription }) => isNonRenewableStatus(subscription))).toBe(
      true,
    );
    expect(OPERATION_STATES.some(({ subscription }) => !isNonRenewableStatus(subscription))).toBe(
      true,
    );
  });

  it('разбор удался — продление в переборе вообще встречается', () => {
    // Иначе запрет ниже проходил бы потому, что `renewSubscription` не выдаётся
    // никому и никогда.
    expect(
      OPERATION_STATES.some(
        ({ subscription }) =>
          resolveExpiredRenewOperation(subscription).kind === 'renewSubscription',
      ),
    ).toBe(true);
  });

  it('НИ ОДНО состояние с непродлеваемым статусом не уходит в renewSubscription', () => {
    // ⚠️ Сердце задачи. Мутация «убрать ветку витрины» краснеет здесь на всех
    // состояниях сразу, а не на одном примере: бэкенд отвечает на такое
    // продление 400 (`renewal.py:130-136`).
    for (const { name, subscription } of OPERATION_STATES.filter(({ subscription }) =>
      isNonRenewableStatus(subscription),
    )) {
      expect(`${name}: ${resolveExpiredRenewOperation(subscription).kind}`).not.toBe(
        `${name}: renewSubscription`,
      );
    }
  });

  it('не суточная подписка с таким статусом уходит именно в витрину', () => {
    const states = OPERATION_STATES.filter(
      ({ subscription }) => isNonRenewableStatus(subscription) && !subscription.is_daily,
    );

    expect(states.length).toBeGreaterThan(0);

    for (const { name, subscription } of states) {
      expect(`${name}: ${resolveExpiredRenewOperation(subscription).kind}`).toBe(
        `${name}: openPurchase`,
      );
    }
  });

  it('суточная на паузе по-прежнему возобновляется, а не уезжает в витрину', () => {
    const paused = OPERATION_STATES.filter(({ subscription }) =>
      isPausedDailySubscription(subscription),
    );

    expect(paused.length).toBeGreaterThan(0);

    for (const { name, subscription } of paused) {
      expect(`${name}: ${resolveExpiredRenewOperation(subscription).kind}`).toBe(
        `${name}: resumeDaily`,
      );
    }
  });

  it('состояния с обычными статусами ветку витрины не получают', () => {
    // Обратная сторона правила: истёкшая подписка обязана остаться продлеваемой,
    // иначе задача чинила бы 400 ценой потери единственного рабочего действия.
    const renewable = OPERATION_STATES.filter(
      ({ subscription }) => !isNonRenewableStatus(subscription),
    );

    expect(renewable.length).toBeGreaterThan(0);

    for (const { name, subscription } of renewable) {
      expect(`${name}: ${resolveExpiredRenewOperation(subscription).kind}`).not.toBe(
        `${name}: openPurchase`,
      );
    }
  });
});

describe('resolveExpiredActionLabelKey: подпись кнопки продления', () => {
  it('снятие с паузы подписано «Возобновить», остальное — «Продлить»', () => {
    expect(resolveExpiredActionLabelKey({ kind: 'resumeDaily' })).toBe(
      'dashboard.suspended.resume',
    );
    expect(
      resolveExpiredActionLabelKey({ kind: 'purchaseDailyTariff', tariffId: 12, days: 1 }),
    ).toBe('dashboard.expired.quickRenew');
    expect(resolveExpiredActionLabelKey({ kind: 'renewSubscription', days: 30 })).toBe(
      'dashboard.expired.quickRenew',
    );
  });

  it('по умолчанию подпись короткая — та, что на главной', () => {
    // Решение владельца от 19.08.2026: на главной кнопка стоит в тесной плитке,
    // и там остаётся короткое «Продлить». Дефолт — именно этот ключ, чтобы
    // карточка главной не передавала ничего.
    expect(DEFAULT_RENEW_LABEL_KEY).toBe('dashboard.expired.quickRenew');
    expect(resolveExpiredActionLabelKey({ kind: 'renewSubscription', days: 30 })).toBe(
      DEFAULT_RENEW_LABEL_KEY,
    );
  });

  it('страница подписки просит длинную подпись — «Продлить подписку»', () => {
    // ⚠️ Различие мест вызова — АРГУМЕНТОМ, а не веткой «на главной / на
    // странице» внутри общего блока: ветка внутри и есть та развилка, из-за
    // которой копии расходятся (урок #61).
    expect(PAGE_RENEW_LABEL_KEY).toBe('simple:subscription.expiredRenewAction');
    expect(
      resolveExpiredActionLabelKey({ kind: 'renewSubscription', days: 30 }, PAGE_RENEW_LABEL_KEY),
    ).toBe(PAGE_RENEW_LABEL_KEY);
    expect(
      resolveExpiredActionLabelKey(
        { kind: 'purchaseDailyTariff', tariffId: 12, days: 1 },
        PAGE_RENEW_LABEL_KEY,
      ),
    ).toBe(PAGE_RENEW_LABEL_KEY);
  });

  it('переход в витрину подписан «Оформить подписку» (#67)', () => {
    // ⚠️ Ключ апстримный и ровно тот, что стоял на этой кнопке до #65
    // (`resolveAllSubscriptionActions`, ветка истёкшей подписки). Своей строки
    // задача не заводит: формулировка уже согласована владельцем и переведена.
    expect(PURCHASE_LABEL_KEY).toBe('subscription.getSubscription');
    expect(
      resolveExpiredActionLabelKey({ kind: 'openPurchase', to: '/subscriptions/7/renew' }),
    ).toBe(PURCHASE_LABEL_KEY);
  });

  it('подпись витрины подменой ключа не перебивается', () => {
    // ⚠️ Та же причина, что у «Возобновить»: продлением этот переход не
    // является. «Продлить подписку» на кнопке, ведущей в витрину, обещало бы
    // продление, которое бэкенд этой подписке запретил.
    expect(
      resolveExpiredActionLabelKey(
        { kind: 'openPurchase', to: '/subscriptions/7/renew' },
        PAGE_RENEW_LABEL_KEY,
      ),
    ).toBe(PURCHASE_LABEL_KEY);
    expect(
      resolveExpiredActionLabelKey(
        { kind: 'openPurchase', to: '/subscriptions/7/renew' },
        DEFAULT_RENEW_LABEL_KEY,
      ),
    ).toBe(PURCHASE_LABEL_KEY);
  });

  it('подпись «Возобновить» подменой не перебивается', () => {
    // ⚠️ Мутация «отдавать переданный ключ всегда» краснеет здесь: снятие с
    // паузы — не продление, и «Продлить подписку» на этой кнопке было бы врать
    // про списания, которые всего лишь остановлены.
    expect(resolveExpiredActionLabelKey({ kind: 'resumeDaily' }, PAGE_RENEW_LABEL_KEY)).toBe(
      'dashboard.suspended.resume',
    );
  });
});

describe('resolveExpiredActionButton: что рисует единственная кнопка', () => {
  /** Обычное продление — операция, при которой баланс и решает. */
  const RENEW_OPERATION = { kind: 'renewSubscription', days: RENEW_PERIOD_DAYS } as const;

  it('баланс загружен — продление или пополнение, как решил resolveExpiredCardAction', () => {
    expect(
      resolveExpiredActionButton({
        operation: RENEW_OPERATION,
        action: 'renew',
        isBalanceLoading: false,
      }),
    ).toBe('renew');
    expect(
      resolveExpiredActionButton({
        operation: RENEW_OPERATION,
        action: 'topUp',
        isBalanceLoading: false,
      }),
    ).toBe('topUp');
  });

  it('баланс ещё в полёте — заглушка, а НЕ пополнение', () => {
    // ⚠️ Сердце пункта. Пока запрос идёт, баланс равен нулю, «денег хватает»
    // отвечает «нет», и единственная кнопка экрана 200–400 мс предлагает
    // пополнение — человеку с деньгами, который успевает её нажать. На главной
    // рядом стоит сумма баланса, на странице подписки её нет вовсе. Мутация
    // «выкинуть загрузку из правила» краснеет здесь.
    expect(
      resolveExpiredActionButton({
        operation: RENEW_OPERATION,
        action: 'topUp',
        isBalanceLoading: true,
      }),
    ).toBe('pending');
    expect(
      resolveExpiredActionButton({
        operation: RENEW_OPERATION,
        action: 'renew',
        isBalanceLoading: true,
      }),
    ).toBe('pending');
  });

  it('витрина не зависит НИ от баланса, ни от его загрузки (#67)', () => {
    // ⚠️ Второе требование задачи. «Пополнить баланс» у непродлеваемой подписки
    // — тупик: продлить оттуда всё равно нельзя, деньги просто уедут на счёт.
    // Заглушка на время запроса баланса здесь тоже не нужна: решение про эту
    // кнопку баланса не спрашивает вовсе. Мутация «сначала смотреть на баланс»
    // краснеет здесь трижды.
    const operation = { kind: 'openPurchase', to: '/subscriptions/7/renew' } as const;

    expect(
      resolveExpiredActionButton({ operation, action: 'topUp', isBalanceLoading: false }),
    ).toBe('purchase');
    expect(resolveExpiredActionButton({ operation, action: 'topUp', isBalanceLoading: true })).toBe(
      'purchase',
    );
    expect(resolveExpiredActionButton({ operation, action: 'renew', isBalanceLoading: true })).toBe(
      'purchase',
    );
  });

  it('витрина остаётся единственной кнопкой такого состояния', () => {
    // Обратная сторона: перебор состояний с непродлеваемым статусом не даёт ни
    // одной кнопки, кроме перехода, — ни продления, ни пополнения.
    const states = OPERATION_STATES.filter(
      ({ subscription }) => isNonRenewableStatus(subscription) && !subscription.is_daily,
    );

    expect(states.length).toBeGreaterThan(0);

    for (const { name, subscription } of states) {
      const operation = resolveExpiredRenewOperation(subscription);

      for (const action of ['renew', 'topUp'] as const) {
        for (const isBalanceLoading of [true, false]) {
          expect(
            `${name}: ${resolveExpiredActionButton({ operation, action, isBalanceLoading })}`,
          ).toBe(`${name}: purchase`);
        }
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Резолв обеих подписей настоящим i18next.
 *
 * ⚠️ Ключ страницы живёт в НАШЕМ неймспейсе (`src/simple/locales/*.json`), а
 * ключ главной — в апстримном, и блок зовёт `t()` одного инстанса для обоих.
 * Держится это на префиксе `simple:` и на том, что `nsSeparator` у i18next
 * дефолтный. Проверка текстом здесь ничего не значила бы: неверный префикс
 * печатает на кнопке сам ключ, молча и при зелёной сборке. Поэтому — исполнение,
 * тем же приёмом, что в `locales/locales.test.ts`.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('обе подписи резолвятся в текст, а не в имя ключа', () => {
  /**
   * Апстримная локаль читается ТЕКСТОМ, а не импортом: `src/locales/*` — чужой
   * слой, и граница простого режима импорты оттуда не одобряет (канон, раздел
   * «Границы»). Своя локаль импортируется как обычно.
   */
  const upstreamRu = JSON.parse(readFileSync('src/locales/ru.json', 'utf8')) as Record<
    string,
    unknown
  >;

  /** Инстанс с двумя неймспейсами: апстримным `translation` и нашим `simple`. */
  function instance() {
    const i18n = createInstance();
    i18n.init({
      lng: 'ru',
      fallbackLng: 'ru',
      initImmediate: false,
      interpolation: { escapeValue: false },
    });
    i18n.addResourceBundle('ru', 'translation', upstreamRu, true, true);
    i18n.addResourceBundle('ru', 'simple', simpleRu, true, true);
    return i18n;
  }

  it('разбор удался — локали прочитаны, а не пусты', () => {
    expect(Object.keys(upstreamRu).length).toBeGreaterThan(0);
    expect(Object.keys(simpleRu).length).toBeGreaterThan(0);
  });

  it('короткая подпись главной — «Продлить»', () => {
    expect(instance().t(DEFAULT_RENEW_LABEL_KEY)).toBe('Продлить');
  });

  it('длинная подпись страницы — «Продлить подписку», и это НАШ ключ', () => {
    // ⚠️ Мутация «убрать префикс `simple:`» краснеет здесь: без неймспейса
    // i18next ищет ключ в апстримном бандле, не находит и печатает его текстом.
    expect(instance().t(PAGE_RENEW_LABEL_KEY)).toBe('Продлить подписку');
    expect(instance().t('subscription.expiredRenewAction')).toBe('subscription.expiredRenewAction');
  });

  it('подписи разные — иначе весь пункт был бы холостым', () => {
    expect(instance().t(PAGE_RENEW_LABEL_KEY)).not.toBe(instance().t(DEFAULT_RENEW_LABEL_KEY));
  });

  it('подпись «Возобновить» тоже резолвится', () => {
    expect(instance().t(resolveExpiredActionLabelKey({ kind: 'resumeDaily' }))).toBe('Возобновить');
  });

  it('подпись витрины резолвится в «Оформить подписку»', () => {
    // ⚠️ Ключ апстримный, без префикса `simple:` — и он обязан находиться. Без
    // этой проверки опечатка в ключе напечатала бы на кнопке сам ключ, молча и
    // при зелёной сборке.
    expect(
      instance().t(
        resolveExpiredActionLabelKey({ kind: 'openPurchase', to: '/subscriptions/7/renew' }),
      ),
    ).toBe('Оформить подписку');
  });
});
