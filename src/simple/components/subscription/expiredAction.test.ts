import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import simpleRu from '../../locales/ru.json';
import {
  DEFAULT_RENEW_LABEL_KEY,
  NON_RENEWABLE_STATUSES,
  PAGE_RENEW_LABEL_KEY,
  PURCHASE_LABEL_KEY,
  isNonRenewableStatus,
  isPausedDailySubscription,
  resolveExpiredActionLabelKey,
  resolveExpiredRenewOperation,
} from './expiredAction';
import { PURCHASE_ROUTE, paymentRoute } from './purchaseCta';
import type { Subscription } from '@/types';

/**
 * Чистая логика единственной кнопки истёкшей платной подписки (задачи #65, #70).
 *
 * ⚠️ Правило было записано разметкой карточки главной, то есть проверить его
 * было нечем: компонентных тестов в проекте не бывает (`environment: 'node'`,
 * alias `@/` в тестах не разрешается — docs/architecture/two-modes.md, раздел
 * «Тесты»). С #65 блок действия стал общим для двух экранов, и ветвление
 * переехало сюда — теперь оно проверяется вызовом функции.
 *
 * ⚠️ ЧТО ИЗМЕНИЛА #70. Раньше кнопка решала «хватает ли денег» грубым порогом
 * («есть ли хоть рубль») и сама платила. Цену продления порог не знал и знать не
 * мог, поэтому обе подписи врали: при 100 ₽ кнопка обещала продление, которого
 * не будет, при нуле — требовала пополнения, не называя суммы. Владелец решил:
 * действие истёкшей подписки — ПЕРЕХОД на единый экран оплаты, где цены известны
 * и уже работает механизм «не хватает столько-то, пополнить»
 * (`SubscriptionPayment.tsx` + `InsufficientBalancePrompt`).
 *
 * Поэтому баланса в этом модуле НЕТ ВОВСЕ — ни входом, ни порогом. Проверки
 * «денег хватает» здесь больше не существует, и вернуть её нечем: у
 * `resolveExpiredRenewOperation` просто нет такого аргумента.
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
    expect(isNonRenewableStatus(sub({ status: 'expired' }))).toBe(false);
    expect(isNonRenewableStatus(sub({ status: 'active' }))).toBe(false);
    expect(isNonRenewableStatus(sub({ status: 'trial' }))).toBe(false);
  });
});

describe('resolveExpiredRenewOperation: переход, а не оплата (#70)', () => {
  it('приостановленный суточный тариф — снятие с паузы, а не переход', () => {
    // ⚠️ Единственная ветка, оставшаяся мутацией, и задача #70 её не трогает:
    // там ВОЗОБНОВЛЕНИЕ списаний, а не покупка срока. `status === 'disabled'` у
    // суточного означает «списания остановлены»; отправь мы её на экран оплаты
    // — человек, всего лишь нажавший паузу, покупал бы тариф заново.
    const paused = sub({ is_daily: true, status: 'disabled', tariff_id: 12 });

    expect(resolveExpiredRenewOperation(paused)).toEqual({ kind: 'resumeDaily' });
  });

  it('обычная истёкшая подписка — переход на экран оплаты', () => {
    // ⚠️ Сердце #70. Раньше здесь была мутация `renewSubscription` и решение по
    // остатку баланса; мутация «вернуть продление на карточку» краснеет здесь.
    expect(resolveExpiredRenewOperation(sub())).toEqual({
      kind: 'openPayment',
      to: '/subscriptions/7/renew',
    });
  });

  it('истёкший суточный тариф — тоже переход, а не покупка дня (#70)', () => {
    // ⚠️ До #70 эта ветка платила `purchaseTariff` на один день. Покупка срока —
    // ровно то, что переехало на экран оплаты; на паузу это не распространяется
    // (проверка выше).
    const daily = sub({ is_daily: true, status: 'expired', tariff_id: 12 });

    expect(resolveExpiredRenewOperation(daily)).toEqual({
      kind: 'openPayment',
      to: '/subscriptions/7/renew',
    });
  });

  it('обычная подписка со статусом disabled — переход с подписью витрины (#67)', () => {
    // ⚠️ Дефект, с которого заведена #67: бэкенд отвечал на продление
    // `Cannot renew subscription with status: disabled`. Вид операции остаётся
    // отдельным НЕ ради адреса — адрес у обеих навигационных веток один и тот
    // же, — а ради подписи «Оформить подписку», согласованной владельцем в #67.
    const disabled = sub({ status: 'disabled' });

    expect(resolveExpiredRenewOperation(disabled)).toEqual({
      kind: 'openPurchase',
      to: '/subscriptions/7/renew',
    });
  });

  it('статус pending закрыт тем же правилом', () => {
    expect(resolveExpiredRenewOperation(sub({ status: 'pending' }))).toEqual({
      kind: 'openPurchase',
      to: '/subscriptions/7/renew',
    });
  });

  it('адрес перехода — ТОТ ЖЕ, что у кнопки продления активной подписки (#69)', () => {
    // ⚠️ Владелец забраковал ровно то, что оплата открывалась на двух разных
    // экранах; мутация «вернуть здесь витрину» краснеет здесь, а не на стенде,
    // где состояние `disabled` воспроизвести нечем.
    for (const status of ['disabled', 'expired']) {
      const subscription = sub({ status });
      const operation = resolveExpiredRenewOperation(subscription);

      expect(`${status}: ${'to' in operation ? operation.to : 'нет адреса'}`).toBe(
        `${status}: ${paymentRoute(subscription.id)}`,
      );
    }
  });

  it('без id подписки адрес оплаты собрать нечем — остаётся витрина', () => {
    // Страховка того же рода, что в `resolveAllSubscriptionActions`: `id`
    // приходит от API, и нулевой он означает «строки нет». Ссылка
    // `/subscriptions/0/renew` вела бы в никуда.
    expect(resolveExpiredRenewOperation(sub({ status: 'pending', id: 0 }))).toEqual({
      kind: 'openPurchase',
      to: PURCHASE_ROUTE,
    });
    expect(resolveExpiredRenewOperation(sub({ status: 'expired', id: 0 }))).toEqual({
      kind: 'openPayment',
      to: PURCHASE_ROUTE,
    });
  });

  it('у навигационной операции нет ни дней, ни тарифа', () => {
    // ⚠️ Переход — это не мутация: полей, которыми разметка могла бы позвать
    // продление или покупку, у этого вида операции не существует.
    for (const status of ['expired', 'disabled']) {
      expect(
        `${status}: ${Object.keys(resolveExpiredRenewOperation(sub({ status }))).sort()}`,
      ).toBe(`${status}: kind,to`);
    }
  });

  it('баланс на выбор операции не влияет — его тут нет вовсе (#70)', () => {
    // ⚠️ Сторож снятого требования наоборот: мутация «вернуть проверку остатка»
    // краснеет здесь, потому что второго аргумента у функции не существует.
    // Порог `hasBalanceForRenew` («есть ли хоть рубль») удалён вместе с
    // решением, которое он кормил: цену продления карточка не знает.
    expect(resolveExpiredRenewOperation.length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Перебор состояний: с карточки не мутирует НИЧТО, кроме снятия с паузы (#70).
 *
 * Примеры выше показывают отдельные состояния, а правило должно держаться на
 * всех сразу: у подписки независимо крутятся суточный тариф, наличие
 * `tariff_id`, `is_expired` и статус, и именно на их сочетании дефекты и жили.
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

describe('перебор: действие истёкшей подписки — переход (#70)', () => {
  it('разбор удался — перебор собран и в нём есть обе стороны правила', () => {
    // Без этой пары пустой или однобокий перебор давал бы вечно зелёное правило.
    expect(OPERATION_STATES.length).toBeGreaterThan(50);
    expect(OPERATION_STATES.some(({ subscription }) => isNonRenewableStatus(subscription))).toBe(
      true,
    );
    expect(OPERATION_STATES.some(({ subscription }) => !isNonRenewableStatus(subscription))).toBe(
      true,
    );
    expect(OPERATION_STATES.some(({ subscription }) => subscription.is_daily)).toBe(true);
  });

  it('разбор удался — переход в переборе вообще встречается', () => {
    // Иначе запрет ниже проходил бы потому, что навигация не выдаётся никому.
    expect(
      OPERATION_STATES.some(
        ({ subscription }) => resolveExpiredRenewOperation(subscription).kind === 'openPayment',
      ),
    ).toBe(true);
    expect(
      OPERATION_STATES.some(
        ({ subscription }) => resolveExpiredRenewOperation(subscription).kind === 'openPurchase',
      ),
    ).toBe(true);
  });

  it('НИ ОДНО состояние не зовёт мутацию продления или покупки срока', () => {
    // ⚠️ Сердце #70. Мутация «вернуть карточке продление» краснеет здесь на всех
    // состояниях сразу, а не на одном примере: цену продления карточка не знает,
    // и обещать её кнопкой она не вправе.
    for (const { name, subscription } of OPERATION_STATES) {
      const kind = resolveExpiredRenewOperation(subscription).kind;

      expect(`${name}: ${kind}`).not.toBe(`${name}: renewSubscription`);
      expect(`${name}: ${kind}`).not.toBe(`${name}: purchaseDailyTariff`);
    }
  });

  it('единственная мутация — снятие суточной с паузы, у остальных только адрес', () => {
    // ⚠️ Обратная сторона того же правила, записанная через поля операции: у
    // всего, что не `resumeDaily`, есть ровно `kind` и `to`, то есть позвать
    // оплату разметке нечем.
    for (const { name, subscription } of OPERATION_STATES) {
      const operation = resolveExpiredRenewOperation(subscription);

      if (operation.kind === 'resumeDaily') {
        expect(`${name}: ${isPausedDailySubscription(subscription)}`).toBe(`${name}: true`);
        continue;
      }

      expect(`${name}: ${Object.keys(operation).sort().join(',')}`).toBe(`${name}: kind,to`);
    }
  });

  it('суточная на паузе по-прежнему возобновляется', () => {
    // ⚠️ Граница #70: эту ветку задача не трогает. Мутация «отправить и её на
    // экран оплаты» краснеет здесь.
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

  it('переход строится ЕДИНСТВЕННОЙ функцией маршрута', () => {
    // ⚠️ Литерал адреса разъехался бы с `paymentRoute` молча. Здесь проверено
    // значением: у каждого состояния с id адрес совпадает с общей функцией, а
    // без id — с витриной.
    for (const { name, subscription } of OPERATION_STATES) {
      const operation = resolveExpiredRenewOperation(subscription);

      if (!('to' in operation)) continue;

      expect(`${name}: ${operation.to}`).toBe(`${name}: ${paymentRoute(subscription.id)}`);
    }
  });

  it('не суточная подписка с непродлеваемым статусом подписана витриной (#67)', () => {
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

  it('состояния с обычными статусами подпись витрины не получают', () => {
    // Обратная сторона правила: истёкшая подписка обязана остаться «Продлить»,
    // иначе задача поменяла бы согласованную формулировку всем подряд.
    const renewable = OPERATION_STATES.filter(
      ({ subscription }) =>
        !isNonRenewableStatus(subscription) && !isPausedDailySubscription(subscription),
    );

    expect(renewable.length).toBeGreaterThan(0);

    for (const { name, subscription } of renewable) {
      expect(`${name}: ${resolveExpiredRenewOperation(subscription).kind}`).toBe(
        `${name}: openPayment`,
      );
    }
  });
});

describe('resolveExpiredActionLabelKey: подпись кнопки', () => {
  const PAYMENT_OPERATION = { kind: 'openPayment', to: '/subscriptions/7/renew' } as const;
  const PURCHASE_OPERATION = { kind: 'openPurchase', to: '/subscriptions/7/renew' } as const;

  it('снятие с паузы подписано «Возобновить», переход на оплату — «Продлить»', () => {
    expect(resolveExpiredActionLabelKey({ kind: 'resumeDaily' })).toBe(
      'dashboard.suspended.resume',
    );
    expect(resolveExpiredActionLabelKey(PAYMENT_OPERATION)).toBe('dashboard.expired.quickRenew');
  });

  it('по умолчанию подпись короткая — та, что на главной', () => {
    // Решение владельца от 19.08.2026: на главной кнопка стоит в тесной плитке,
    // и там остаётся короткое «Продлить». Дефолт — именно этот ключ, чтобы
    // карточка главной не передавала ничего.
    expect(DEFAULT_RENEW_LABEL_KEY).toBe('dashboard.expired.quickRenew');
    expect(resolveExpiredActionLabelKey(PAYMENT_OPERATION)).toBe(DEFAULT_RENEW_LABEL_KEY);
  });

  it('страница подписки просит длинную подпись — «Продлить подписку»', () => {
    // ⚠️ Различие мест вызова — АРГУМЕНТОМ, а не веткой «на главной / на
    // странице» внутри общего блока: ветка внутри и есть та развилка, из-за
    // которой копии расходятся (урок #61).
    expect(PAGE_RENEW_LABEL_KEY).toBe('simple:subscription.expiredRenewAction');
    expect(resolveExpiredActionLabelKey(PAYMENT_OPERATION, PAGE_RENEW_LABEL_KEY)).toBe(
      PAGE_RENEW_LABEL_KEY,
    );
  });

  it('переход у непродлеваемого статуса подписан «Оформить подписку» (#67)', () => {
    // ⚠️ Ключ апстримный и ровно тот, что стоял на этой кнопке до #65. Своей
    // строки задача не заводит: формулировка согласована владельцем и
    // переведена на оба языка. #70 адрес обеих веток сравняла, а слово — нет.
    expect(PURCHASE_LABEL_KEY).toBe('subscription.getSubscription');
    expect(resolveExpiredActionLabelKey(PURCHASE_OPERATION)).toBe(PURCHASE_LABEL_KEY);
  });

  it('подпись витрины подменой ключа не перебивается', () => {
    // ⚠️ Та же причина, что у «Возобновить»: продлением этот переход не
    // является. «Продлить подписку» на такой кнопке обещало бы продление,
    // которое бэкенд этой подписке запретил.
    for (const key of [PAGE_RENEW_LABEL_KEY, DEFAULT_RENEW_LABEL_KEY]) {
      expect(resolveExpiredActionLabelKey(PURCHASE_OPERATION, key)).toBe(PURCHASE_LABEL_KEY);
    }
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
