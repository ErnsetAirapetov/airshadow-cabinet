import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import simpleRu from '../../locales/ru.json';
import {
  DEFAULT_RENEW_LABEL_KEY,
  MIN_RENEW_BALANCE_KOPEKS,
  PAGE_RENEW_LABEL_KEY,
  RENEW_PERIOD_DAYS,
  hasBalanceForRenew,
  isPausedDailySubscription,
  resolveExpiredActionButton,
  resolveExpiredActionLabelKey,
  resolveExpiredRenewOperation,
} from './expiredAction';
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

  it('приостановка без суточного тарифа продлевается как обычная', () => {
    // ⚠️ Снятие с паузы — механизм суточного тарифа. Мутация «смотреть только
    // на статус» красит здесь: обычная подписка ушла бы в `togglePause`.
    const disabled = sub({ status: 'disabled' });

    expect(resolveExpiredRenewOperation(disabled)).toEqual({
      kind: 'renewSubscription',
      days: RENEW_PERIOD_DAYS,
    });
  });

  it('период продления записан константой', () => {
    expect(RENEW_PERIOD_DAYS).toBe(30);
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
  it('баланс загружен — продление или пополнение, как решил resolveExpiredCardAction', () => {
    expect(resolveExpiredActionButton({ action: 'renew', isBalanceLoading: false })).toBe('renew');
    expect(resolveExpiredActionButton({ action: 'topUp', isBalanceLoading: false })).toBe('topUp');
  });

  it('баланс ещё в полёте — заглушка, а НЕ пополнение', () => {
    // ⚠️ Сердце пункта. Пока запрос идёт, баланс равен нулю, «денег хватает»
    // отвечает «нет», и единственная кнопка экрана 200–400 мс предлагает
    // пополнение — человеку с деньгами, который успевает её нажать. На главной
    // рядом стоит сумма баланса, на странице подписки её нет вовсе. Мутация
    // «выкинуть загрузку из правила» краснеет здесь.
    expect(resolveExpiredActionButton({ action: 'topUp', isBalanceLoading: true })).toBe('pending');
    expect(resolveExpiredActionButton({ action: 'renew', isBalanceLoading: true })).toBe('pending');
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
});
