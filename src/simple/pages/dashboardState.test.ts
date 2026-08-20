import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Subscription, SubscriptionStatusResponse } from '@/types';
import {
  resolveDashboardSubscription,
  resolveRenewHref,
  resolveSubscriptionPollMs,
  resolveTimeLeftDisplay,
  SUBSCRIPTION_POLL_MS,
} from './dashboardState';

/**
 * Вся ветвящаяся логика простой главной живёт в чистом модуле именно ради этих
 * тестов: страницу и её карточки в тесте не собрать — их граф импортов
 * дотягивается до alias `@/`, а он в тестах не разрешается. Значит либо логика
 * вынесена и проверена, либо не проверена вовсе.
 */

/**
 * Исходник без комментариев — для текстовых сторожей ниже.
 *
 * ⚠️ Они читают ТОЛЬКО его, и это несущее требование, а не аккуратность.
 * Докстринги простой главной и активной карточки сами пересказывают то, что
 * сторожится: `refetchInterval`, `resolveSubscriptionPollMs`, `SIMPLE_NS`,
 * `daysLeft`. На сыром тексте закомментированная строка проходила за код — замена
 * `refetchInterval:` на `// refetchInterval:` в `Dashboard.tsx` оставляла опрос
 * мёртвым при зелёных тестах, и то же с `import { SIMPLE_NS }` в карточке
 * (#58, доработка по ревью).
 *
 * ⚠️ Строчные комментарии режутся только там, где `//` НЕ стоит после двоеточия:
 * иначе `https://…` внутри строкового литерала обрезался бы посередине, унося
 * закрывающую кавычку. Тот же приём, что в `scripts/check-mode-boundaries.mjs`,
 * `i18nNamespace.test.tsx` и `topUpPage.test.ts`.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('разбор исходников: сторожа читают код, а не прозу (#58)', () => {
  it('комментарий с запрещённой конструкцией в код не попадает', () => {
    expect(code('const a = 1; // refetchInterval: 5\n')).not.toContain('refetchInterval');
    expect(code('/* useTranslation(SIMPLE_NS) */\nconst a = 1;\n')).not.toContain('SIMPLE_NS');
  });

  it('но и обратная сторона: код рядом с комментарием остаётся', () => {
    // Сторож, вырезающий вместе с прозой сам код, был бы зелёным всегда.
    expect(code('const a = 1; // прочее\n')).toContain('const a = 1;');
    // И `//` внутри URL не комментарий: иначе разбор скобок разъезжался бы.
    expect(code("const u = 'https://t.me/x';\n")).toContain('https://t.me/x');
  });
});

function status(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 7,
    status: 'active',
    is_trial: false,
    start_date: '2026-08-01T00:00:00',
    end_date: '2026-09-01T00:00:00',
    days_left: 18,
    hours_left: 0,
    minutes_left: 0,
    time_left_display: '18 дней',
    traffic_limit_gb: 100,
    traffic_used_gb: 1,
    traffic_used_percent: 1,
    device_limit: 3,
    connected_squads: [],
    servers: [],
    autopay_enabled: false,
    autopay_days_before: 3,
    subscription_url: 'https://sub.example/token',
    hide_subscription_link: false,
    is_active: true,
    is_expired: false,
    is_limited: false,
    ...overrides,
  };
}

const response = (subscription: Subscription | null): SubscriptionStatusResponse => ({
  has_subscription: subscription !== null,
  subscription,
});

const resolve = (overrides: Partial<Parameters<typeof resolveDashboardSubscription>[0]> = {}) =>
  resolveDashboardSubscription({
    status: response(status()),
    isLoading: false,
    isError: false,
    ...overrides,
  });

describe('resolveDashboardSubscription — данных ещё нет', () => {
  it('запрос идёт — скелет', () => {
    expect(resolve({ status: undefined, isLoading: true }).kind).toBe('loading');
  });

  it('ответа нет и ошибки нет — тоже скелет', () => {
    // Запрос может быть ещё не запущен (enabled), это не ошибка.
    expect(resolve({ status: undefined }).kind).toBe('loading');
  });
});

describe('resolveDashboardSubscription — ошибка запроса', () => {
  it('запрос упал и данных нет — состояние ошибки, а не вечный скелет', () => {
    // ⚠️ Ради этого состояние и заведено. У запроса `retry: false`, а
    // `refetchOnWindowFocus` выключен глобально: без отдельной ветки любая
    // сетевая осечка или 5xx вешала бы на экране покупки скелет навсегда —
    // ни текста, ни кнопки повтора.
    expect(resolve({ status: undefined, isError: true }).kind).toBe('error');
  });

  it('ошибка при уже загруженных данных не прячет подписку', () => {
    // Фоновое обновление упало, но данные с прошлого успешного ответа есть.
    // Стереть их ради экрана ошибки значит наказать человека за чужой сбой.
    expect(resolve({ isError: true }).kind).toBe('active');
  });

  it('ошибка приоритетнее флага загрузки, если данных так и нет', () => {
    expect(resolve({ status: undefined, isLoading: true, isError: true }).kind).toBe('error');
  });
});

describe('resolveDashboardSubscription — состояния подписки', () => {
  it('подписки нет', () => {
    expect(resolve({ status: response(null) }).kind).toBe('none');
  });

  it('has_subscription=false перевешивает непустое поле subscription', () => {
    // Бэкенд может отдать объект с флагом false; главная обязана верить флагу,
    // иначе покажет карточку подписки тому, у кого её нет.
    expect(resolve({ status: { has_subscription: false, subscription: status() } }).kind).toBe(
      'none',
    );
  });

  it('активная подписка отдаётся карточке как есть, без своего view-типа', () => {
    // Карточки простого режима — копии апстримных и принимают `Subscription`.
    // Промежуточный тип означал бы конвертацию туда-обратно на каждой карточке.
    expect(resolve()).toMatchObject({
      kind: 'active',
      subscription: { id: 7, end_date: '2026-09-01T00:00:00', days_left: 18 },
    });
  });

  it('истёкшая подписка', () => {
    const state = resolve({
      status: response(status({ status: 'expired', is_active: false, is_expired: true })),
    });

    expect(state.kind).toBe('expired');
  });

  it('отключённая подписка (disabled) — тоже истёкшая', () => {
    expect(
      resolve({ status: response(status({ status: 'disabled', is_active: false })) }).kind,
    ).toBe('expired');
  });

  it('приостановленная подписка (limited) — отдельное состояние', () => {
    // Отдельное от истечения: срок ещё идёт, дата остаётся правдой, а доступ
    // не работает. Апстримная карточка истёкшей подписки различает эти случаи
    // сама (ветка `isLimited`), поэтому состояние доезжает до неё отдельным.
    expect(
      resolve({
        status: response(status({ status: 'limited', is_active: false, is_limited: true })),
      }).kind,
    ).toBe('limited');
  });

  it('приостановка перебивает истечение — состояния не сливаем', () => {
    expect(
      resolve({
        status: response(
          status({ status: 'limited', is_active: false, is_limited: true, is_expired: true }),
        ),
      }).kind,
    ).toBe('limited');
  });

  it('подписка доезжает целиком — карточке нужны и трафик, и лимит устройств', () => {
    const state = resolve({ status: response(status({ subscription_url: null })) });

    expect(state.kind === 'active' && state.subscription).toMatchObject({
      subscription_url: null,
      traffic_limit_gb: 100,
      device_limit: 3,
    });
  });
});

describe('resolveTimeLeftDisplay', () => {
  const sub = status;

  it('больше суток осталось — дни', () => {
    expect(resolveTimeLeftDisplay(sub({ days_left: 5, hours_left: 10, minutes_left: 0 }))).toEqual({
      kind: 'unit',
      value: 5,
      unit: 'days',
    });
  });

  it('последние сутки — часы (#34)', () => {
    expect(resolveTimeLeftDisplay(sub({ days_left: 0, hours_left: 8, minutes_left: 40 }))).toEqual({
      kind: 'unit',
      value: 8,
      unit: 'hours',
    });
  });

  it('последний час — минуты, а не «0 ч.» (#38)', () => {
    // Бэкенд обнуляет hours_left в последний час так же, как обнулял days_left в
    // последние сутки (#34) — то же округление вниз. Плитка показывала бы «0 ч.»
    // живой подписке, которой осталось меньше часа.
    expect(resolveTimeLeftDisplay(sub({ days_left: 0, hours_left: 0, minutes_left: 45 }))).toEqual({
      kind: 'unit',
      value: 45,
      unit: 'minutes',
    });
  });

  it('последняя минута — терминальная формулировка вместо нуля (#50)', () => {
    // Третий этаж той же болезни (#34 — дни, #38 — часы): в последнюю минуту
    // бэкенд обнуляет и minutes_left, и плитка показывала живой подписке «0 м».
    // Спускаться дальше некуда — ниже минуты единицы нет, поэтому цифру
    // заменяет терминальная формулировка. Ноль как значение здесь запрещён.
    expect(resolveTimeLeftDisplay(sub({ days_left: 0, hours_left: 0, minutes_left: 0 }))).toEqual({
      kind: 'underMinute',
    });
  });

  it('отрицательный остаток у живой подписки — тоже терминальная формулировка', () => {
    // Класс дефекта, а не его этаж: любая неположительная цифра на плитке живой
    // подписки читается как «уже кончилась». Рассинхрон часов клиента и сервера
    // даёт отрицательные значения так же легко, как округление вниз даёт нули.
    expect(
      resolveTimeLeftDisplay(sub({ days_left: -1, hours_left: -2, minutes_left: -30 })),
    ).toEqual({ kind: 'underMinute' });
  });

  it('частично отрицательный остаток — берётся живая единица, а не терминальная строка', () => {
    // ⚠️ Спуск идёт по ПОЛОЖИТЕЛЬНЫМ единицам, а не по первой встреченной:
    // рассинхрон часов легко даёт `hours_left: -1` при живых 30 минутах. Условие
    // «ни одной положительной единицы» это переживает, а «первая неположительная
    // — терминальная» показало бы «Меньше минуты» подписке, которой полчаса.
    // Поведение описано в докстринге функции и до #58 не было приколочено.
    expect(resolveTimeLeftDisplay(sub({ days_left: 0, hours_left: -1, minutes_left: 30 }))).toEqual(
      {
        kind: 'unit',
        value: 30,
        unit: 'minutes',
      },
    );
  });

  it('истёкшая подписка ведёт себя как раньше — 0 минут, у неё своя карточка', () => {
    // ⚠️ Ветка НЕДОСТИЖИМА из единственного вызова (#58): истёкшую подписку до
    // плитки не пускает роутинг карточек в `Dashboard.tsx` — ей достаётся
    // `SubscriptionCardExpired`, где плитки остатка нет вообще. Проверка
    // оставлена осознанно: это оборона чистой функции от будущего потребителя,
    // а не описание живого экрана. Тот же смысл у теста ниже.
    //
    // Терминальная формулировка обещает «ещё чуть-чуть работает», поэтому
    // истёкшей она не достаётся.
    expect(
      resolveTimeLeftDisplay(
        sub({
          status: 'expired',
          is_active: false,
          is_expired: true,
          days_left: 0,
          hours_left: 0,
          minutes_left: 0,
        }),
      ),
    ).toEqual({ kind: 'unit', value: 0, unit: 'minutes' });
  });

  it('отключённая подписка (disabled) — тоже 0 минут, а не «меньше минуты»', () => {
    expect(
      resolveTimeLeftDisplay(
        sub({ status: 'disabled', is_active: false, days_left: 0, hours_left: 0, minutes_left: 0 }),
      ),
    ).toEqual({ kind: 'unit', value: 0, unit: 'minutes' });
  });
});

describe('resolveSubscriptionPollMs — остаток не залипает на открытой вкладке (#58)', () => {
  const sub = status;
  const poll = (overrides: Partial<Subscription> = {}) =>
    resolveSubscriptionPollMs(response(sub(overrides)));

  it('дни в запасе — редкий шаг, чтобы вкладка доехала до нижних ступеней', () => {
    // ⚠️ Не `false`. Возврат фокуса на вкладку не обновляет ничего
    // (`refetchOnWindowFocus` выключен глобально), а `refetchOnMount: 'always'`
    // ждёт нового монтажа — без дневного шага вкладка, открытая больше суток,
    // показывала бы «1 дн.» и после фактического истечения.
    expect(poll({ days_left: 18 })).toBe(SUBSCRIPTION_POLL_MS.days);
    expect(poll({ days_left: 1 })).toBe(SUBSCRIPTION_POLL_MS.days);
  });

  it('последние сутки — редкий опрос, чтобы попасть в минуты', () => {
    expect(poll({ days_left: 0, hours_left: 8, minutes_left: 40 })).toBe(
      SUBSCRIPTION_POLL_MS.hours,
    );
  });

  it('последний час — опрос под шаг цифры', () => {
    expect(poll({ days_left: 0, hours_left: 0, minutes_left: 45 })).toBe(
      SUBSCRIPTION_POLL_MS.minutes,
    );
  });

  it('терминальная формулировка при нулях — самый частый опрос', () => {
    // ⚠️ Ровно тот дефект, из-за которого функция появилась: «Меньше минуты»
    // корректна в момент отрисовки и лжёт через минуту, а без опроса висит до
    // перезагрузки вкладки. Нули означают, что развязка будет в пределах минуты.
    expect(poll({ days_left: 0, hours_left: 0, minutes_left: 0 })).toBe(
      SUBSCRIPTION_POLL_MS.underMinute,
    );
  });

  it('отрицательный остаток — минутный шаг, а не пятнадцатисекундный', () => {
    // ⚠️ Развязки может не быть вообще: при рассинхроне часов или отставшем
    // джобе бэкенд не перевернёт `is_expired`, подписка останется `active`, и
    // самый частый шаг долбил бы сервер, пока открыта вкладка. Торопиться тут
    // некуда — подписка по-прежнему считается живой.
    expect(poll({ days_left: -1, hours_left: -2, minutes_left: -30 })).toBe(
      SUBSCRIPTION_POLL_MS.minutes,
    );
    // Хватает одной отрицательной единицы: остальные могут быть нулями.
    expect(poll({ days_left: 0, hours_left: 0, minutes_left: -1 })).toBe(
      SUBSCRIPTION_POLL_MS.minutes,
    );
  });

  it('интервалы идут по возрастанию частоты, а не как попало', () => {
    expect(SUBSCRIPTION_POLL_MS.underMinute).toBeLessThan(SUBSCRIPTION_POLL_MS.minutes);
    expect(SUBSCRIPTION_POLL_MS.minutes).toBeLessThan(SUBSCRIPTION_POLL_MS.hours);
    expect(SUBSCRIPTION_POLL_MS.hours).toBeLessThan(SUBSCRIPTION_POLL_MS.days);
    // ⚠️ Шаг не крупнее единицы, которая стоит на плитке, — иначе цифра
    // отстаёт на целую единицу. Сторожится ОБЕ ступени, где единица есть:
    // раньше пара была только у минут, и `hours` можно было поднять до двух
    // часов при зелёных тестах, нарушив заявленное в докстринге правило.
    expect(SUBSCRIPTION_POLL_MS.minutes).toBeLessThanOrEqual(60_000);
    expect(SUBSCRIPTION_POLL_MS.hours).toBeLessThanOrEqual(3_600_000);
  });

  it('истёкшая и отключённая — догонять нечего', () => {
    // У них своя карточка, плитки остатка там нет вообще.
    expect(poll({ status: 'expired', is_active: false, is_expired: true, days_left: 0 })).toBe(
      false,
    );
    expect(poll({ status: 'disabled', is_active: false, days_left: 0 })).toBe(false);
  });

  it('приостановленная (limited) — не поллим: остаток там ни при чём', () => {
    expect(poll({ status: 'limited', is_active: false, is_limited: true, days_left: 0 })).toBe(
      false,
    );
  });

  it('ответа ещё нет и подписки нет — поллить нечего', () => {
    expect(resolveSubscriptionPollMs(undefined)).toBe(false);
    expect(resolveSubscriptionPollMs(response(null))).toBe(false);
  });
});

/**
 * Сторож подключения: правило опроса обязано стоять в запросе подписки (#58).
 *
 * Чистая функция без вызова — мёртвый код: остаток продолжал бы залипать при
 * зелёных тестах на саму функцию. Файл читается ТЕКСТОМ (см. канон, «Тесты») и
 * БЕЗ КОММЕНТАРИЕВ: докстринг запроса в `Dashboard.tsx` сам пересказывает правило
 * опроса и называет `refetchInterval` с `resolveSubscriptionPollMs`, поэтому на
 * сыром тексте замена строки на `// refetchInterval: …` оставляла все тесты
 * зелёными, а поллинг мёртвым. Это единственная правка задачи, меняющая поведение
 * в проде, — и сторож обязан краснеть на ней сам, а не полагаться на `tsc`, который
 * поймает мутацию лишь по осиротевшему импорту.
 */
describe('опрос подписки подключён к запросу главной (#58)', () => {
  const page = code(readFileSync('src/simple/pages/Dashboard.tsx', 'utf8'));

  it('разбор удался — иначе сторож сверял бы пустоту', () => {
    // Пара к вырезанию комментариев: код запроса на месте, а не выгрызен вместе
    // с прозой — иначе проверки ниже искали бы литералы в пустоте.
    expect(page).toContain("queryKey: ['subscription']");
    expect(page).toContain('useQuery({');
  });

  it('интервал опроса считает наша функция, а не литерал в странице', () => {
    expect(page).toContain('resolveSubscriptionPollMs');
    expect(page).toMatch(/refetchInterval:\s*\(query\)\s*=>\s*resolveSubscriptionPollMs\(/);
  });

  it('опрос стоит именно у запроса подписки, а не у соседнего', () => {
    // Между ключом запроса и `refetchInterval` не должно быть другого useQuery:
    // иначе поллился бы, например, баланс, а плитка осталась бы залипшей.
    const fromKey = page.slice(page.indexOf("queryKey: ['subscription']"));
    const interval = fromKey.indexOf('refetchInterval');
    const nextQuery = fromKey.indexOf('useQuery({');

    expect(interval).toBeGreaterThan(-1);
    expect(nextQuery === -1 || interval < nextQuery).toBe(true);
  });
});

describe('resolveRenewHref', () => {
  const sub = status;

  it('платная живая подписка ведёт на страницу продления', () => {
    expect(resolveRenewHref(sub())).toBe('/subscriptions/7/renew');
  });

  it('триал продлевать нечего — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ is_trial: true }))).toBe('/subscription/purchase');
  });

  it('суточный тариф списывается сам — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ is_daily: true }))).toBe('/subscription/purchase');
  });

  it('истёкшая подписка — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ is_active: false, is_expired: true }))).toBe(
      '/subscription/purchase',
    );
  });

  it('без id ссылку на продление не собрать — витрина тарифов', () => {
    expect(resolveRenewHref(sub({ id: 0 }))).toBe('/subscription/purchase');
  });

  it('истёкшая с исчерпанным трафиком — по-прежнему витрина', () => {
    expect(resolveRenewHref(sub({ is_limited: true, is_expired: true }))).toBe(
      '/subscription/purchase',
    );
  });
});

/**
 * Сторож карточки: терминальную ветку нельзя отрисовать цифрой (#50).
 *
 * Чистая функция отдаёт `{ kind: 'underMinute' }` без значения, и `timeLeft.value`
 * на объединении не компилируется — но `timeLeft.kind === 'unit' ? timeLeft.value : 0`
 * компилируется прекрасно, и дефект вернулся бы со зелёной сборкой. Плитку самой
 * карточки рендером не достать — она тянет `@/hooks` и `@/utils`, а alias `@/` в
 * тестах не разрешается, поэтому файл читается ТЕКСТОМ — тем же приёмом, что
 * сторожа шапки и страницы баланса.
 */
describe('плитка остатка не печатает цифру в терминальной ветке (#50)', () => {
  /**
   * ⚠️ Карточка читается БЕЗ КОММЕНТАРИЕВ целиком, а не в одном тесте (#58).
   * Её докстринги и пояснения внутри веток сами называют `SIMPLE_NS`, `tSimple` и
   * `daysLeft`: на сыром тексте `// import { SIMPLE_NS } …` проходил за живой
   * импорт, а запрет `daysLeft` краснел бы по собственной прозе.
   */
  const card = code(
    readFileSync('src/simple/components/dashboard/SubscriptionCardActive.tsx', 'utf8'),
  );
  const ru = JSON.parse(readFileSync('src/simple/locales/ru.json', 'utf8')) as {
    dashboard: Record<string, string>;
  };

  it('разбор удался — иначе сторож сверял бы пустоту', () => {
    expect(card).toContain('resolveTimeLeftDisplay(subscription)');
    // Пара к вырезанию комментариев: разметка плитки на месте, а не выгрызена.
    expect(card).toContain('{timeLeftLabel}');
  });

  it('в терминальной ветке цифры нет вообще', () => {
    expect(card).toMatch(/timeLeft\.kind === 'unit'\s*\?\s*timeLeft\.value\s*:\s*null/);
  });

  it('вместо цифры — наша строка из неймспейса простого режима', () => {
    expect(card).toContain("tSimple('dashboard.timeLeftUnderMinute')");

    // ⚠️ И `tSimple` привязан к НАШЕМУ неймспейсу (#58). Без этой пары строк
    // подмена `useTranslation(SIMPLE_NS)` на `useTranslation()` оставляла все
    // сторожа зелёными, а на плитке печатался сырой ключ
    // `dashboard.timeLeftUnderMinute`. Проверка по всему слою и доказательство
    // отрисовкой — в `src/simple/i18nNamespace.test.tsx`.
    expect(card).toContain("import { SIMPLE_NS } from '../../i18n'");
    expect(card).toContain('const { t: tSimple } = useTranslation(SIMPLE_NS)');
  });

  it('цвет терминальной строки безусловный — мёртвой развилки нет (#58)', () => {
    // В терминальную ветку попадают только нулевые и отрицательные дни, поэтому
    // `daysLeft <= 3 ? warning : ...` там всегда считался в warning. Выбор,
    // который не выбирает, читается как правило и врёт о нём.
    // ⚠️ Разбор по коду БЕЗ КОММЕНТАРИЕВ (это он же — `card` выше): объяснение
    // починки стоит прямо в этой ветке и само называет `daysLeft`, на сыром тексте
    // сторож падал бы по прозе.
    const terminal = card.slice(
      card.indexOf('timeLeftValue === null ?'),
      card.indexOf('{timeLeftLabel}'),
    );

    // Разбор удался: ветка найдена и непустая.
    expect(terminal.length).toBeGreaterThan(100);
    expect(terminal).toContain("color: 'rgb(var(--color-warning-400))'");
    expect(terminal).not.toContain('daysLeft');
  });

  it('строка, которую печатает карточка, в локали есть', () => {
    // Ключ, потерянный при переименовании, i18next печатает как есть —
    // человек увидел бы на плитке `dashboard.timeLeftUnderMinute`.
    expect(ru.dashboard.timeLeftUnderMinute).toBeTruthy();
  });
});

/**
 * Сторож против молчаливого расхождения копии.
 *
 * `resolveRenewHref` — копия правила адреса из `purchaseCta.ts`. Раньше оригинал
 * лежал в апстримном `src/components/subscription/` и импортировать его простому
 * режиму запрещала граница; задачей #28 файл переехал в наш слой
 * (`src/simple/components/subscription/purchaseCta.ts`) — он нашего авторства, в
 * апстриме его нет вообще.
 *
 * ⚠️ Сторож после переезда не стал бессмысленным, у него сменился адресат:
 * теперь он ловит не апстримный дрейф, а НАШ собственный. Схлопнуть дубль
 * импортом нельзя — правила расходятся по существу: `resolveSubscriptionCta`
 * считает истёкшей подписку по `!is_active && !is_trial && !is_limited`, а
 * простой главной истечение определяет `isExpired` из этого модуля
 * (`is_expired || status === 'disabled'`). Пока рядом живут два определения,
 * переписать одно из них молча (например, переработкой покупки и продления)
 * можно ровно так же, как это мог сделать апстрим: сборка зелёная, кнопка ведёт
 * не туда.
 *
 * Файл читается ТЕКСТОМ по той же причине, что и реестр в `routes.test.tsx`:
 * импорт потянул бы `types` через alias `@/`, которого нет в `vitest.config.ts`.
 */
describe('копия правила адреса не разошлась с purchaseCta', () => {
  const source = readFileSync('src/simple/components/subscription/purchaseCta.ts', 'utf8');

  it('исходник на месте — иначе сторож сверял бы пустоту', () => {
    expect(source).toContain('resolveSubscriptionCta');
  });

  it('витрина тарифов — тот же адрес', () => {
    expect(source).toContain("'/subscription/purchase'");
  });

  it('адрес продления собирается из id подписки', () => {
    // ⚠️ С #69 адрес строит `paymentRoute`: на него же ведёт кнопка оплаты
    // непродлеваемой подписки (`expiredAction.ts`), и литерал в двух местах
    // разъехался бы молча. Сторож смотрит на обе половины — и на объявление
    // адреса, и на то, что кнопка продления зовёт именно её.
    expect(source).toContain('return `/subscriptions/${subscriptionId}/renew`;');
    expect(source).toContain('to: paymentRoute(subscription.id)');
  });

  it('ветки триала, суточного тарифа и отсутствия id никуда не делись', () => {
    expect(source).toContain('subscription.is_trial');
    expect(source).toContain('subscription.is_daily');
    expect(source).toContain('!subscription.id');
  });
});

/**
 * Сторож против молчаливого расхождения правила «часы/минуты вместо нуля».
 *
 * `resolveTimeLeftDisplay` заимствует приём у апстримного
 * `src/pages/Subscription.tsx` (~ строка 881, блок инфо о триале): при
 * `days_left <= 0` бэкенд округляет дни вниз, и там же в последний час
 * `hours_left` тоже обнуляется — апстрим в этом случае показывает `minutes_left`.
 * Правило одно, второе (своё) не заводим (#38). Апстрим может поменять его
 * молча: сборка останется зелёной, а плитка снова покажет «0 ч.».
 *
 * Файл читается ТЕКСТОМ по той же причине, что и сторож `purchaseCta` выше:
 * импорт потянул бы апстримный граф через alias `@/`, которого нет в
 * `vitest.config.ts`.
 */
describe('правило часы/минуты не разошлось с апстримным Subscription.tsx', () => {
  const source = readFileSync('src/pages/Subscription.tsx', 'utf8');

  it('исходник на месте — иначе сторож сверял бы пустоту', () => {
    expect(source).toContain('subscription.days_left > 0');
  });

  it('в последние сутки апстрим показывает часы и минуты, а не дни', () => {
    expect(source).toContain('subscription.hours_left');
    expect(source).toContain("t('subscription.hours')");
  });

  it('минуты остаются запасной единицей, когда часы тоже обнулились', () => {
    expect(source).toContain('subscription.minutes_left');
    expect(source).toContain("t('subscription.minutes')");
  });
});
