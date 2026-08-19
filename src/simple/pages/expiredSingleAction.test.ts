import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isPausedDailySubscription,
  resolveExpiredActionLabelKey,
  resolveExpiredRenewOperation,
} from '../components/subscription/expiredAction';
import { resolveSubscriptionCta } from '../components/subscription/purchaseCta';
import { resolveSubscriptionCardActions } from './subscriptionState';
import type { Subscription } from '@/types';

/**
 * Критерий приёмки #65: у истёкшей платной подписки на странице подписки РОВНО
 * ОДНО действие С ПОДПИСКОЙ, и кнопки подключения среди них нет.
 *
 * ⚠️ Именно «действие с подпиской», а не «одна кнопка на экране»: ниже по
 * странице стоит блок «Мои устройства» со своими кнопками, и стоял он там до
 * #65 тоже. Спека владельца про пару «Подключить устройство» + «Продлить»,
 * которая при истёкшей подписке спорила сама с собой.
 *
 * ⚠️ ЧТО ИМЕННО СКЛАДЫВАЕТ ПЕРЕБОР — и чего он не видит. Перебор ниже
 * складывает ТРИ ИЗВЕСТНЫХ ЕМУ ИСТОЧНИКА действий страницы:
 * `resolveSubscriptionCardActions` (кнопка подключения и блок действия),
 * `resolveSubscriptionCta` (кнопки покупки) и флаг `dailyPause` (кнопка блока
 * «Пауза списаний»). Разметку страницы он НЕ читает вовсе, поэтому сам по себе
 * он доказывает согласованность этих трёх модулей между собой — и ничего
 * больше. Четвёртое действие, дописанное прямо в JSX, ему не видно: ревью
 * доказало это вставкой в `Subscription.tsx` отдельного блока со второй
 * кнопкой на пополнение — перебор остался зелёным.
 *
 * ⚠️ Поэтому рядом стоят ДВА ТЕКСТОВЫХ СТОРОЖА раскладки страницы (в конце
 * файла): закреплённый перечень блоков верхнего уровня вместе с их условиями
 * отрисовки и запрет на собственные якоря действий подписки в разметке. Та
 * самая вставка красит оба. Что они НЕ ловят, сказано честно: кнопку,
 * дописанную ВНУТРЬ уже существующего блока и не ведущую ни на пополнение, ни
 * на продление, текст файла не отличает от прочей разметки — это остаётся за
 * ревью. Третья редакция сторожа была бы разбором JSX в тест-файле, и это
 * несоразмерно.
 *
 * Первая редакция считала только карточку и `PurchaseCTAButton`, и этого не
 * хватало иначе: ниже карточки стоит блок «Пауза списаний» суточного тарифа со
 * своей кнопкой. У приостановленной суточной подписки на экране было два
 * одинаковых «Возобновить», у истёкшей — «Продлить» рядом с «Приостановить», и
 * сторож при этом оставался зелёным. Отсюда третье слагаемое.
 *
 * ⚠️ Зачем отдельный перебор. Действия страницы считают ДВА независимых модуля:
 * видимость кнопок — `resolveSubscriptionCardActions`, состав кнопок покупки —
 * `resolveSubscriptionCta`. Разъедься они — экран получит либо две кнопки
 * (ровно та жалоба владельца, с которой началась задача), либо ни одной. Ни то,
 * ни другое не видно ни сборке, ни типам, а состояний подписки сотни, так что
 * проверять примерами тут нечего.
 *
 * ⚠️ Эталон «как было ДО #65» записан НЕЗАВИСИМОЙ функцией, а не взят из
 * рабочего кода: сравнение кода с самим собой доказывало бы только то, что он
 * себе равен. Формула выведена из прежнего `resolveAllSubscriptionActions` и из
 * прежнего условия блока паузы: кнопка подключения рисовалась у любой подписки
 * безусловно, блок паузы — у любой суточной непробной, а кнопки покупки шли по
 * цепочке «истекла → витрина, триал → витрина, суточная и без id → смена
 * тарифа, иначе продление».
 */

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 7,
    status: 'active',
    is_trial: false,
    start_date: '2026-08-01T00:00:00',
    end_date: '2026-09-01T00:00:00',
    days_left: 19,
    hours_left: 0,
    minutes_left: 0,
    time_left_display: '19 дней',
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
    is_active: true,
    is_expired: false,
    is_limited: false,
    ...overrides,
  };
}

/** Истёкшая платная подписка — независимый эталон правила, см. докстринг. */
function isExpiredPaid(subscription: Subscription): boolean {
  return !subscription.is_active && !subscription.is_trial && !subscription.is_limited;
}

/**
 * Действия страницы СЕЙЧАС по трём известным источникам: кнопки карточки,
 * кнопки покупки и кнопка блока «Пауза списаний».
 *
 * ⚠️ Это МОДЕЛЬ экрана, а не сам экран: разметка `Subscription.tsx` здесь не
 * читается. Что четвёртого источника в ней не завелось, сторожат текстовые
 * проверки в конце файла — см. головной докстринг.
 *
 * ⚠️ Блок паузы попал сюда не для полноты. Его кнопка зовёт тот же
 * `togglePause`, что ветка `resumeDaily` общего блока действия, то есть у
 * приостановленной суточной подписки она задваивала единственное действие
 * экрана. Считать её надо ровно как остальные.
 */
function actionsNow(subscription: Subscription): string[] {
  const visible = resolveSubscriptionCardActions(subscription);

  return [
    ...(visible.connectDevice ? ['connectDevice'] : []),
    ...(visible.expiredAction ? ['expiredAction'] : []),
    ...resolveSubscriptionCta(subscription).map((action) => action.kind),
    ...(visible.dailyPause ? ['dailyPause'] : []),
  ];
}

/** Что было на экране ДО #65 — независимый эталон. */
function actionsBefore(subscription: Subscription): string[] {
  const purchaseButtons = isExpiredPaid(subscription)
    ? ['purchase']
    : subscription.is_trial
      ? ['purchase']
      : subscription.is_daily || !subscription.id
        ? ['change']
        : ['renew'];

  // Блок паузы стоял под условием `is_daily && !is_trial` — без оглядки на
  // «истекла», в этом и была дыра.
  const pauseBlock = subscription.is_daily && !subscription.is_trial ? ['dailyPause'] : [];

  return ['connectDevice', ...purchaseButtons, ...pauseBlock];
}

/**
 * Подписан ли ЕДИНСТВЕННЫЙ путь возобновления списаний на экране.
 *
 * ⚠️ Кнопка блока паузы называлась «Возобновить» по условию
 * `is_daily_paused || status === 'disabled'` — это правило записано здесь
 * НЕЗАВИСИМО, прямо с разметки блока, чтобы проверка ниже не сравнивала код с
 * самим собой.
 */
function pauseBlockOfferedResume(subscription: Subscription): boolean {
  return (
    Boolean(subscription.is_daily) &&
    !subscription.is_trial &&
    Boolean(subscription.is_daily_paused || subscription.status === 'disabled')
  );
}

/** Есть ли на экране СЕЙЧАС кнопка «Возобновить» — из блока паузы или из блока действия. */
function screenOffersResume(subscription: Subscription): boolean {
  const visible = resolveSubscriptionCardActions(subscription);

  if (visible.dailyPause && pauseBlockOfferedResume(subscription)) return true;

  return (
    visible.expiredAction &&
    resolveExpiredActionLabelKey(resolveExpiredRenewOperation(subscription)) ===
      'dashboard.suspended.resume'
  );
}

const STATES: { name: string; subscription: Subscription }[] = [];

for (const isActive of [true, false]) {
  for (const isLimited of [true, false]) {
    for (const isTrial of [true, false]) {
      for (const isDaily of [true, false]) {
        for (const id of [7, 0]) {
          // ⚠️ `pending` — вторая половина множества непродлеваемых статусов
          // бэкенда (#67, `renewal.py:130-136`). Без него перебор проверял бы
          // страницу только на том статусе, о котором владелец сообщил.
          for (const status of ['active', 'expired', 'disabled', 'pending']) {
            for (const dailyPrice of [0, 1500]) {
              // ⚠️ `is_daily_paused` — отдельное измерение, а не мелочь: блок
              // паузы называет кнопку «Возобновить» по нему ИЛИ по статусу
              // `disabled`, а операция общего блока смотрит только на статус.
              for (const dailyPaused of [true, false]) {
                STATES.push({
                  name: `active=${isActive} limited=${isLimited} trial=${isTrial} daily=${isDaily} id=${id} status=${status} dailyPrice=${dailyPrice} paused=${dailyPaused}`,
                  subscription: sub({
                    is_active: isActive,
                    is_limited: isLimited,
                    is_trial: isTrial,
                    is_daily: isDaily,
                    id,
                    status,
                    daily_price_kopeks: dailyPrice,
                    is_daily_paused: dailyPaused,
                  }),
                });
              }
            }
          }
        }
      }
    }
  }
}

describe('разбор удался', () => {
  it('перебор собран и покрывает обе стороны эталона', () => {
    // Без этого пустой перебор дал бы вечно зелёные проверки ниже.
    expect(STATES.length).toBeGreaterThan(100);
    expect(STATES.some(({ subscription }) => isExpiredPaid(subscription))).toBe(true);
    expect(STATES.some(({ subscription }) => !isExpiredPaid(subscription))).toBe(true);
  });

  it('в переборе есть спорные состояния истёкшей подписки', () => {
    // Суточный тариф (продлевается покупкой дня), приостановленный суточный
    // (снимается с паузы) и подписка без id.
    const expired = STATES.filter(({ subscription }) => isExpiredPaid(subscription));

    expect(expired.some(({ subscription }) => subscription.is_daily)).toBe(true);
    expect(expired.some(({ subscription }) => subscription.status === 'disabled')).toBe(true);
    expect(expired.some(({ subscription }) => !subscription.id)).toBe(true);
  });

  it('в переборе есть оба непродлеваемых статуса (#67)', () => {
    // Пара «разбор удался» к проверке ниже: без таких состояний она проходила
    // бы ни на чём.
    const expired = STATES.filter(({ subscription }) => isExpiredPaid(subscription));

    expect(expired.some(({ subscription }) => subscription.status === 'disabled')).toBe(true);
    expect(expired.some(({ subscription }) => subscription.status === 'pending')).toBe(true);
  });
});

describe('непродлеваемый статус: экран даёт переход, а не продление (#67)', () => {
  it('ни одно состояние с таким статусом не зовёт продление', () => {
    // ⚠️ Правило смотрится с ЭКРАНА, а не только из чистого модуля: страница и
    // главная рисуют один блок действия, поэтому запрет обязан держаться на всех
    // состояниях, у которых этот блок вообще виден.
    const nonRenewable = STATES.filter(
      ({ subscription }) =>
        resolveSubscriptionCardActions(subscription).expiredAction &&
        (subscription.status === 'disabled' || subscription.status === 'pending'),
    );

    expect(nonRenewable.length).toBeGreaterThan(0);

    for (const { name, subscription } of nonRenewable) {
      expect(`${name}: ${resolveExpiredRenewOperation(subscription).kind}`).not.toBe(
        `${name}: renewSubscription`,
      );
    }
  });

  it('не суточная подписка с таким статусом уходит в витрину, и действие у неё одно', () => {
    const states = STATES.filter(
      ({ subscription }) =>
        isExpiredPaid(subscription) &&
        !subscription.is_daily &&
        (subscription.status === 'disabled' || subscription.status === 'pending'),
    );

    expect(states.length).toBeGreaterThan(0);

    for (const { name, subscription } of states) {
      expect(`${name}: ${resolveExpiredRenewOperation(subscription).kind}`).toBe(
        `${name}: openPurchase`,
      );
      expect(`${name}: ${actionsNow(subscription).join('+')}`).toBe(`${name}: expiredAction`);
    }
  });

  it('в переборе есть состояния с блоком паузы и без него', () => {
    // Без этой пары проверки про блок паузы охраняли бы пустоту: перебор без
    // суточных подписок дал бы вечно зелёное «блока нет».
    expect(
      STATES.some(({ subscription }) => actionsBefore(subscription).includes('dailyPause')),
    ).toBe(true);
    expect(
      STATES.some(({ subscription }) => !actionsBefore(subscription).includes('dailyPause')),
    ).toBe(true);
    expect(STATES.some(({ subscription }) => actionsNow(subscription).includes('dailyPause'))).toBe(
      true,
    );
  });

  it('в переборе есть приостановленные суточные подписки', () => {
    // Пара к проверке «возобновить не потерялось»: без таких состояний она
    // проходила бы ни на чём.
    expect(STATES.some(({ subscription }) => isPausedDailySubscription(subscription))).toBe(true);
    expect(STATES.some(({ subscription }) => pauseBlockOfferedResume(subscription))).toBe(true);
    expect(STATES.some(({ subscription }) => screenOffersResume(subscription))).toBe(true);
  });
});

describe('истёкшая платная подписка: ровно одно действие (#65)', () => {
  it('действие одно, и это не подключение устройства', () => {
    // ⚠️ Сердце задачи. Мутация «оставить подключение при истёкшей» и мутация
    // «вернуть истёкшей кнопку витрины» красят этот тест каждая по-своему: в
    // первом случае действий становится два, во втором — тоже два.
    for (const { name, subscription } of STATES.filter(({ subscription }) =>
      isExpiredPaid(subscription),
    )) {
      expect(`${name}: ${actionsNow(subscription).join('+')}`).toBe(`${name}: expiredAction`);
    }
  });

  it('состав действий у ВСЕХ остальных состояний не изменился', () => {
    // Критерий приёмки «у активной, приостановленной, суточной подписки и у
    // триала поведение не изменилось» — перебором, а не глазами.
    for (const { name, subscription } of STATES.filter(
      ({ subscription }) => !isExpiredPaid(subscription),
    )) {
      const before = actionsBefore(subscription).join('+');
      const now = actionsNow(subscription).join('+');

      expect(`${name}: ${now}`).toBe(`${name}: ${before}`);
    }
  });

  it('без действия не остаётся НИ ОДНО состояние', () => {
    // Обратная сторона «одной кнопки»: экран без единого действия — тупик, и
    // прежняя правка на этом уже спотыкалась (#49, истёкший триал).
    for (const { name, subscription } of STATES) {
      expect(`${name}: ${actionsNow(subscription).length > 0}`).toBe(`${name}: true`);
    }
  });

  it('подписки нет вовсе — «Оформить подписку» и никакого блока карточки', () => {
    // Второй случай прежней склейки: карточки нет, кнопку рисует
    // `PurchaseCTAButton` снаружи.
    expect(resolveSubscriptionCardActions(null)).toEqual({
      connectDevice: false,
      expiredAction: false,
      dailyPause: false,
    });
    expect(resolveSubscriptionCta(null).map((action) => action.kind)).toEqual(['purchase']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Блок «Пауза списаний» при истёкшей подписке (решение владельца от 19.08.2026).
 *
 * Блок рисовался по условию `is_daily && !is_trial`, без оглядки на «истекла», и
 * критерий «одна кнопка» у суточного тарифа не выполнялся. Довод владельца не
 * про лишнюю кнопку, а про ложь: строка состояния блока у истёкшей подписки
 * печатает «Списания активны». Решение — блок не рисуется вовсе.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('блок паузы у истёкшей подписки не рисуется (#65)', () => {
  it('у истёкшей суточной подписки блока паузы нет ни в одном состоянии', () => {
    // ⚠️ Мутация «вернуть кнопку паузы при истёкшей» (условие блока без
    // `&& !expired`) краснеет здесь и в проверке «действие одно».
    const expiredDaily = STATES.filter(
      ({ subscription }) => isExpiredPaid(subscription) && subscription.is_daily,
    );

    // Пара «разбор удался»: такие состояния в переборе есть.
    expect(expiredDaily.length).toBeGreaterThan(0);

    for (const { name, subscription } of expiredDaily) {
      expect(`${name}: ${actionsNow(subscription).includes('dailyPause')}`).toBe(`${name}: false`);
      // И это именно ИЗМЕНЕНИЕ: до решения владельца блок там был.
      expect(`${name}: ${actionsBefore(subscription).includes('dailyPause')}`).toBe(
        `${name}: true`,
      );
    }
  });

  it('у живой суточной подписки блок паузы остался', () => {
    // Обратная сторона: скрыть блок у всех суточных значило бы отобрать
    // «Приостановить» у тех, кому он и адресован.
    const liveDaily = STATES.filter(
      ({ subscription }) =>
        !isExpiredPaid(subscription) && subscription.is_daily && !subscription.is_trial,
    );

    expect(liveDaily.length).toBeGreaterThan(0);

    for (const { name, subscription } of liveDaily) {
      expect(`${name}: ${actionsNow(subscription).includes('dailyPause')}`).toBe(`${name}: true`);
    }
  });

  it('приостановленная суточная подписка возобновляется общим блоком, а не блоком паузы', () => {
    // ⚠️ Главный риск скрытия блока: кнопка блока паузы зовёт тот же
    // `togglePause`, что ветка `resumeDaily` общего блока действия, и вместе с
    // блоком могло уехать единственное действие человека, остановившего
    // списания. Правило проекта — `isPausedDailySubscription`; блока паузы у
    // этих состояний нет, а «Возобновить» есть.
    const paused = STATES.filter(
      ({ subscription }) => isPausedDailySubscription(subscription) && isExpiredPaid(subscription),
    );

    expect(paused.length).toBeGreaterThan(0);

    for (const { name, subscription } of paused) {
      expect(`${name}: ${actionsNow(subscription).join('+')}`).toBe(`${name}: expiredAction`);
      expect(`${name}: ${resolveExpiredRenewOperation(subscription).kind}`).toBe(
        `${name}: resumeDaily`,
      );
      expect(`${name}: ${screenOffersResume(subscription)}`).toBe(`${name}: true`);
    }
  });

  it('«Возобновить» пропало РОВНО в одном закреплённом состоянии, и там есть рабочее действие', () => {
    // ⚠️ Полный ответ на вопрос «не потеряли ли функцию»: список состояний, где
    // блок паузы давал «Возобновить», а экран после скрытия блока не даёт,
    // сверяется целиком. Новая потеря добавит в него запись и покрасит тест.
    //
    // Единственная признанная запись — суточная подписка с `is_daily_paused`,
    // но статусом НЕ `disabled` (операция общего блока смотрит на статус).
    // Блок паузы называл её кнопку «Возобновить», общий блок предлагает
    // «Продлить» — покупку дня, которая службу и возвращает, то есть тупика
    // нет. Менять под это `isPausedDailySubscription` (то есть звать
    // `togglePause` для протухшей подписки) — решение не наше; описано в MR.
    const lostResume = STATES.filter(
      ({ subscription }) =>
        pauseBlockOfferedResume(subscription) && !screenOffersResume(subscription),
    ).map(({ subscription }) => ({
      expired: isExpiredPaid(subscription),
      dailyPaused: subscription.is_daily_paused === true,
      statusDisabled: subscription.status === 'disabled',
    }));

    // Пара «разбор удался»: состояния с «Возобновить» в блоке паузы в переборе
    // есть, иначе список был бы пуст по другой причине.
    expect(STATES.some(({ subscription }) => pauseBlockOfferedResume(subscription))).toBe(true);

    expect(lostResume.every((state) => state.expired)).toBe(true);
    expect(lostResume.every((state) => state.dailyPaused)).toBe(true);
    expect(lostResume.every((state) => !state.statusDisabled)).toBe(true);

    // И у каждого такого состояния на экране есть ровно одно рабочее действие.
    for (const { name, subscription } of STATES.filter(
      ({ subscription }) =>
        pauseBlockOfferedResume(subscription) && !screenOffersResume(subscription),
    )) {
      expect(`${name}: ${actionsNow(subscription).join('+')}`).toBe(`${name}: expiredAction`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Раскладка страницы — по ТЕКСТУ файла (доработка по вердикту ревью, круг 2).
 *
 * Перебор выше складывает три ИЗВЕСТНЫХ ему источника действий и разметку не
 * читает. Ревью доказало цену этого: вставка в `Subscription.tsx` отдельного
 * блока со второй кнопкой на пополнение оставляла `npm test`, `tsc` и
 * `check:modes` полностью зелёными. Два сторожа ниже закрывают ровно ту дыру.
 *
 * ⚠️ Файл читается ТЕКСТОМ, а не импортируется: `vitest.config.ts` задаёт
 * `environment: 'node'`, jsdom и testing-library в репе нет, alias `@/` в
 * тестах не разрешается — импорт страницы потянул бы весь граф приложения.
 * Приём принят в проекте (`subscriptionPage.test.ts`, `balancePage.test.ts`),
 * и цена та же: разбор видит только записанное литералом, поэтому у каждой
 * проверки есть парная «разбор удался».
 *
 * ⚠️ ЧЕГО ЭТИ СТОРОЖА НЕ ЛОВЯТ. Кнопку, дописанную ВНУТРЬ уже существующего
 * блока верхнего уровня и не ведущую ни на пополнение, ни на продление, текст
 * файла не отличает от прочей разметки. Полный ответ означал бы разбор JSX в
 * тест-файле — несоразмерно; такая вставка остаётся за ревью.
 * ══════════════════════════════════════════════════════════════════════════ */

const PAGE = 'src/simple/pages/Subscription.tsx';
/** Общий блок действия — там и живут якоря, запрещённые странице. */
const ACTION_BLOCK = 'src/simple/components/subscription/ExpiredSubscriptionAction.tsx';

function read(path: string): string {
  // ⚠️ `\r\n` → `\n`: рабочая копия на Windows, а разбор ниже построчный.
  return existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '';
}

/** Комментарии вырезаны — иначе запреты проходили бы по прозе докстрингов. */
function stripComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const pageSource = read(PAGE);
const pageCode = stripComments(pageSource);
const actionBlockCode = stripComments(read(ACTION_BLOCK));

/**
 * Блоки ВЕРХНЕГО УРОВНЯ страницы — вместе с условиями их отрисовки.
 *
 * Разбор простой и потому предсказуемый: у корневого контейнера страницы дети
 * стоят ровно на шести пробелах отступа (форматирование держит prettier, и его
 * гоняет pre-commit). Строки-закрывашки отбрасываются, а многострочное условие
 * склеивается в одну запись — иначе блок перевыпуска попал бы в перечень
 * обрубком `{subscription &&`, и правка его условия прошла бы молча.
 */
function topLevelBlocks(source: string): string[] {
  const from = source.indexOf('return (\n    <div className="space-y-6">');
  const to = source.indexOf('\n    </div>\n  );', from);
  if (from === -1 || to === -1) return [];

  const lines = source.slice(from, to).split('\n');
  const blocks: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!/^ {6}\S/.test(lines[i])) continue;

    let text = lines[i].trim();
    if (/^[)}\]]/.test(text) || text.startsWith('</')) continue;

    // Условие, разорванное по строкам, добираем до конца: `&&`, `||`, `?`, `:`,
    // `,` на конце строки означают, что выражение продолжается.
    while (/[&|,?:]$/.test(text) && i + 1 < lines.length) {
      i += 1;
      text += ` ${lines[i].trim()}`;
    }

    blocks.push(text.replace(/\s+/g, ' '));
  }

  return blocks;
}

/**
 * Закреплённая раскладка страницы.
 *
 * ⚠️ Список ЗАКРЫТЫЙ. Новый блок верхнего уровня — как и снятое условие у
 * старого — красит проверку ниже, и это ровно то, чего стороже не хватало:
 * вставленный блок со второй кнопкой действия обязан требовать осознанной
 * правки этого перечня, а не проходить молча.
 */
const PAGE_TOP_LEVEL_BLOCKS = [
  // Заголовок страницы с кнопкой «назад» — действий с подпиской не несёт.
  '<div className="flex items-center gap-3">',
  // Карточка подписки либо пустое состояние. Внутри — `ConnectDeviceButton`,
  // `ExpiredSubscriptionAction` и `PurchaseCTAButton`, все три под
  // `resolveSubscriptionCardActions` / `resolveSubscriptionCta`.
  '{subscription ? (',
  // Блок «Пауза списаний» — третий источник действий перебора выше.
  '{subscription && cardActions.dailyPause && (',
  // «Подписки нет вовсе» — единственная кнопка экрана снаружи карточки.
  '{!subscription && <PurchaseCTAButton subscription={null} />}',
  // Дополнительные опции: при истёкшей подписке `resolveAdditionalOptions`
  // отдаёт `visible: false` — проверено перебором в `tariffChangeAccess.test.ts`.
  '{subscription && additionalOptions.visible && (',
  // Перевыпуск — только у живой непробной подписки, у истёкшей его нет.
  '{subscription && (subscription.is_active || subscription.is_limited) && !subscription.is_trial && (',
  // «Мои устройства» — свои кнопки, к действиям С ПОДПИСКОЙ не относятся, и
  // стоял этот блок здесь до #65 тоже.
  '{subscription && (',
];

/**
 * Действия с подпиской — переход на пополнение и вызовы продления. Все три
 * записаны ровно в общем блоке; на странице их быть не должно ни в одном
 * блоке, включая уже существующие.
 */
const SUBSCRIPTION_ACTION_ANCHORS = [
  '/balance/top-up',
  'subscriptionApi.renewSubscription',
  'subscriptionApi.purchaseTariff',
];

describe('разбор раскладки страницы удался', () => {
  it('страница прочитана и опознана', () => {
    // Без этого переименованный файл дал бы пустую строку, и «лишних блоков
    // нет» проходило бы всегда.
    expect(pageSource.length).toBeGreaterThan(10_000);
    expect(pageCode).toContain('export function SimpleSubscription()');
    expect(actionBlockCode).toContain('export function ExpiredSubscriptionAction(');
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(pageSource).toContain('Блок не рисуется при истёкшей подписке');
    expect(pageCode).not.toContain('Блок не рисуется при истёкшей подписке');
  });

  it('разбор блоков что-то нашёл, а не вернул пустоту', () => {
    expect(topLevelBlocks(pageCode).length).toBeGreaterThan(3);
    expect(topLevelBlocks(pageCode)[0]).toContain('flex items-center gap-3');
  });

  it('разбор замечает вставленный блок — иначе пин сторожит сам себя', () => {
    // ⚠️ Самопроверка парсера на синтетической странице: без неё сломанная
    // регулярка дала бы пустой список, `toEqual` покраснел бы один раз, его
    // «починили» бы правкой пина, и сторож умер бы молча.
    const shape = (blocks: string) =>
      `  return (\n    <div className="space-y-6">\n${blocks}\n    </div>\n  );`;
    const one = shape('      {subscription && (\n        <div />\n      )}');
    const two = shape(
      '      {subscription && (\n        <div />\n      )}\n      {subscription && (\n        <button />\n      )}',
    );

    expect(topLevelBlocks(one)).toEqual(['{subscription && (']);
    expect(topLevelBlocks(two)).toEqual(['{subscription && (', '{subscription && (']);
  });

  it('многострочное условие склеивается, а не обрубается', () => {
    const source =
      '  return (\n    <div className="space-y-6">\n      {a &&\n        b && (\n        <div />\n      )}\n    </div>\n  );';

    expect(topLevelBlocks(source)).toEqual(['{a && b && (']);
  });
});

describe('раскладка страницы закреплена (#65, круг 2)', () => {
  it('блоки верхнего уровня — ровно те, что перечислены, и в том же порядке', () => {
    // ⚠️ Сердце доработки. Мутация ревью — отдельный блок со второй кнопкой
    // действия при истёкшей подписке — добавляет сюда восьмую запись и красит
    // проверку. Понадобился новый блок по делу — его добавляют в перечень
    // осознанно, вместе с ответом на вопрос «а что он рисует у истёкшей».
    expect(topLevelBlocks(pageCode)).toEqual(PAGE_TOP_LEVEL_BLOCKS);
  });
});

describe('своих якорей действия с подпиской у страницы нет (#65, круг 2)', () => {
  it('в общем блоке эти якоря есть — иначе запрет ниже пустой', () => {
    // Пара «разбор удался»: строки настоящие, а не опечатки, при которых
    // «на странице их нет» проходит всегда.
    for (const anchor of SUBSCRIPTION_ACTION_ANCHORS) {
      expect(`${anchor}: ${actionBlockCode.includes(anchor)}`).toBe(`${anchor}: true`);
    }
  });

  it('на странице подписки их нет ни одного', () => {
    // ⚠️ Второй сторож против той же мутации ревью: её кнопка зовёт
    // `navigate('/balance/top-up')` прямо из разметки страницы. Работает и
    // тогда, когда блок дописан ВНУТРЬ существующего, — там пин раскладки
    // выше бессилен.
    for (const anchor of SUBSCRIPTION_ACTION_ANCHORS) {
      expect(`${anchor}: ${pageCode.includes(anchor)}`).toBe(`${anchor}: false`);
    }
  });
});
