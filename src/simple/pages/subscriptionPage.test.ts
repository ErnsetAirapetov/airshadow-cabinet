import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа простой страницы подписки (задача #28).
 *
 * Задача была про РАЗДЕЛЕНИЕ, а не про упрощение: апстримный
 * `src/pages/Subscription.tsx` вернулся к `upstream/main` побайтово, а всё, что
 * форк успел в нём накопить, переехало в копию `src/simple/pages/Subscription.tsx`.
 * Накопил форк ровно две правки, и обе стоит потерять молча: убранный индикатор
 * зоны расхода и `PurchaseCTAButton` без пропа `isMultiTariff`. Ни одна из них не
 * видна ни сборке, ни типам — вернувшийся индикатор просто нарисуется, а лишний
 * проп кнопка примет и поведёт продление в витрину вместо страницы продления.
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются. Компонентных тестов в проекте
 * не бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * страницы потянул бы весь граф приложения и упал бы на разрешении модулей. Тот
 * же приём, что в `balancePage.test.ts` и `topUpPage.test.ts`; цена та же —
 * разбор видит только записанное литералом, поэтому у каждой проверки ниже есть
 * парная «разбор удался».
 *
 * Пара здесь устроена сильнее обычного: каждое утверждение «в копии этого нет»
 * стоит рядом с утверждением «в апстримной странице это есть». Проверка «нет
 * подстроки» проходит и на пустой строке, и на переименованном файле — соседняя
 * проверка на апстримном оригинале не даёт стороже охранять пустоту.
 */

const PAGE = 'src/simple/pages/Subscription.tsx';
/** Апстримная страница — она же ожидаемый результат отката, читаем только текстом. */
const UPSTREAM_PAGE = 'src/pages/Subscription.tsx';
/** Наша карточка подписки на главной — второй адресат починки склейки классов (#59). */
const ACTIVE_CARD = 'src/simple/components/dashboard/SubscriptionCardActive.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const page = read(PAGE);
const upstream = read(UPSTREAM_PAGE);

/** Вызов кнопки покупки — единственный, поэтому берём его целиком тегом. */
function ctaTag(source: string): string {
  return source.match(/<PurchaseCTAButton[^>]*\/>/)?.[0] ?? '';
}

describe('разбор удался', () => {
  it('обе страницы прочитаны и не пусты', () => {
    // Без этого файл, переименованный или удалённый, дал бы пустую строку — и
    // все проверки «в копии этого нет» проходили бы, ничего не охраняя.
    expect(page.length).toBeGreaterThan(10_000);
    expect(upstream.length).toBeGreaterThan(10_000);
  });

  it('копия — простая страница подписки, а не что-то другое', () => {
    expect(page).toContain('export function SimpleSubscription()');
  });

  it('апстримная страница осталась апстримной по форме экспорта', () => {
    expect(upstream).toContain('export default function Subscription()');
  });

  it('вызов кнопки покупки найден в обеих страницах', () => {
    // Пара для проверок ниже: они смотрят на содержимое тега, и сломанная
    // регулярка дала бы пустую строку, в которой `isMultiTariff` не встречается
    // никогда.
    expect(ctaTag(page)).toContain('PurchaseCTAButton');
    expect(ctaTag(upstream)).toContain('PurchaseCTAButton');
  });
});

describe('правка 1: индикатора зоны расхода в копии нет', () => {
  it('в апстримной странице индикатор на месте — иначе проверка ниже пустая', () => {
    // Она же проверка отката: индикатор — то самое, что форк из апстримного
    // файла вырезал, и его возвращение и есть признак чистого апстрима.
    expect(upstream).toContain('t(zone.labelKey)');
  });

  it('в копии подписи зоны нет', () => {
    expect(page).not.toContain('zone.labelKey');
  });

  it('обоснование удаления перенесено в копию, а не потеряно', () => {
    // Комментарий объясняет, почему блока нет; без него следующий читатель
    // вернёт индикатор как «случайно потерянный при копировании».
    expect(page).toContain('Индикатор зоны расхода убран целиком');
  });
});

describe('правка 2: кнопка покупки в нашем варианте', () => {
  it('в апстримной странице проп передаётся — иначе проверка ниже пустая', () => {
    expect(ctaTag(upstream)).toContain('isMultiTariff');
  });

  it('копия зовёт кнопку без isMultiTariff', () => {
    // С пропом апстримная кнопка уводит продление в витрину тарифов вместо
    // `/subscriptions/:id/renew` — молча, со сборкой зелёной.
    expect(ctaTag(page)).not.toContain('isMultiTariff');
  });

  it('копия зовёт нашу кнопку, а не апстримную', () => {
    // Наш вариант живёт в `src/simple/components/subscription/`; апстримный
    // остался экспертному режиму и принимает другой набор пропов.
    expect(page).toContain("from '../components/subscription/PurchaseCTAButton'");
    expect(page).not.toContain("from '@/components/subscription/PurchaseCTAButton'");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Переработка страницы по спеке владельца (задача #59).
 *
 * Ниже сторожатся шесть пунктов владельца. Разбор идёт по ТЕКСТУ БЕЗ
 * КОММЕНТАРИЕВ: докстринги ниже сами упоминают и `HoverBorderGradient`, и
 * локации, и зону трафика — на сыром тексте запреты проходили бы по прозе.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Комментарии вырезаны — разбор смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const code = stripComments(page);
const upstreamCode = stripComments(upstream);
const rawActiveCard = read(ACTIVE_CARD);
const activeCard = stripComments(rawActiveCard);

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** Индекс якоря; `-1` означает «якорь не найден» и валит пару «разбор удался». */
function at(source: string, anchor: string): number {
  return source.indexOf(anchor);
}

/** Исходник компонента счётчика — от его объявления до докстринга страницы. */
const countdownSource = (() => {
  const from = at(code, 'const CountdownTimer = memo(');
  const to = at(code, 'export function SimpleSubscription(');
  return from === -1 || to === -1 || to < from ? '' : code.slice(from, to);
})();

/**
 * Разметка кнопки подключения со страницы УШЛА в общий компонент (#61):
 * `src/simple/components/subscription/ConnectDeviceButton.tsx`, сторож —
 * `connectDeviceButton.test.ts`. Здесь остаётся вызов, и проверяется он ниже.
 */
const connectCall = /<ConnectDeviceButton[\s\S]*?\/>/.exec(code)?.[0] ?? '';

/** Период тика счётчика — извлекается, а не сверяется текстом. */
const intervalPeriod = /setInterval\([\s\S]*?,\s*([^,()]+?)\s*\)/.exec(countdownSource)?.[1];

/** Массив зависимостей эффекта счётчика. */
const countdownEffectDeps = /\},\s*\[([^\]]*)\]\);/
  .exec(countdownSource)?.[1]
  ?.split(',')
  .map((name) => name.trim())
  .filter(Boolean);

/**
 * Условие «блок автопродления есть» — как ИСПОЛНЯЕМАЯ функция.
 *
 * ⚠️ Приём выбран взамен сверки текста: проверяется ПОВЕДЕНИЕ (при каком
 * состоянии подписки вторая колонка появляется), а не буквы выражения. Возвращает
 * `null`, если разбор не удался или выражение читает поле, которого сторож не
 * знает: подставить в него нечего, и считать такое условие исправным молча
 * нельзя.
 */
function autopayCondition(
  source: string,
): ((subscription: { is_trial: boolean; is_daily: boolean }) => boolean) | null {
  const expression = /const hasAutopay = ([^;]+);/.exec(source)?.[1]?.trim();
  if (!expression) return null;

  const known = new Set(['subscription', 'is_trial', 'is_daily']);
  const names = [...expression.matchAll(/[A-Za-z_$][\w$]*/g)].map((found) => found[0]);
  if (names.length === 0 || names.some((name) => !known.has(name))) return null;

  const compiled = new Function('subscription', `return Boolean(${expression});`) as (
    subscription: unknown,
  ) => boolean;

  return (subscription) => compiled(subscription);
}

const hasAutopay = autopayCondition(code);

/** Все шаблонные литералы `className={`…`}` файла. */
function classNameTemplates(source: string): string[] {
  return [...source.matchAll(/className=\{`[^`]*`\}/g)].map((found) => found[0]);
}

/**
 * Шаблоны классов, в которых перед вставкой НЕТ пробела.
 *
 * Ровно тот дефект, что чинится задачей: `duration-300${cond ? 'x' : ''}` даёт
 * склейку `duration-300cursor-not-allowed` — предыдущий класс ломается, а
 * вставленный не применяется вовсе. Проверка структурная, а не по двум известным
 * местам: третья такая склейка тоже покраснеет.
 */
function gluedClassTemplates(source: string): string[] {
  return classNameTemplates(source).filter((template) => /[^\s`]\$\{/.test(template));
}

describe('разбор страницы после переработки удался (задача #59)', () => {
  it('комментарии вырезаны, а код — нет', () => {
    expect(page).toContain('спека владельца #59');
    expect(code).not.toContain('спека владельца #59');
    expect(code).toContain('export function SimpleSubscription()');
  });

  it('карточка подписки на главной прочитана и опознана', () => {
    // Пара для проверки склейки классов во втором файле: на пустой строке
    // «склеек нет» проходило бы всегда.
    expect(rawActiveCard.length).toBeGreaterThan(5_000);
    expect(activeCard).toContain('<ConnectDeviceButton');
  });

  it('исходник счётчика и вызов кнопки подключения вырезаны', () => {
    expect(countdownSource.length).toBeGreaterThan(500);
    expect(connectCall.length).toBeGreaterThan(50);
    // Кусок счётчика не должен захватить кнопку и наоборот.
    expect(countdownSource).not.toContain('<ConnectDeviceButton');
    expect(connectCall).toContain('subscription={subscription}');
  });

  it('период тика и зависимости эффекта извлечены', () => {
    // ⚠️ Пара именно для регулярок: сломайся любая — и главные сторожа
    // счётчика молча проходили бы всегда.
    expect(intervalPeriod).toBeTruthy();
    expect(countdownEffectDeps?.length).toBeGreaterThan(0);
  });

  it('условие наличия автопродления извлечено и исполняется', () => {
    expect(hasAutopay).not.toBeNull();
  });

  it('разбор шаблонов классов работает — иначе «склеек нет» проходит на пустоте', () => {
    expect(classNameTemplates(code).length).toBeGreaterThan(0);
    expect(classNameTemplates(activeCard).length).toBeGreaterThan(0);
    // Самопроверка детектора на синтетическом дефекте и на исправном шаблоне.
    expect(gluedClassTemplates('className={`p-3 duration-300${x ? "a" : ""}`}')).toHaveLength(1);
    expect(gluedClassTemplates('className={`p-3 duration-300 ${x ? "a" : ""}`}')).toHaveLength(0);
  });
});

describe('пункт 1: счётчик показывает только дни, пока остаток не меньше суток (#59)', () => {
  it('единицы решает чистый модуль, а не разметка', () => {
    // Правило живёт в `subscriptionState.ts` и проверено вызовом в
    // `subscriptionState.test.ts`; здесь сторожится, что страница им ПОЛЬЗУЕТСЯ.
    expect(countdownSource).toContain('resolveCountdownDisplay(');
    expect(countdownSource).toContain("display.kind === 'days'");
  });

  it('разметка читает размеченное объединение, а не четыре числа', () => {
    // ⚠️ Почему этого достаточно: `CountdownDisplay` — размеченное объединение,
    // и у ветки `days` полей `hours`/`minutes`/`seconds` нет вообще. Напечатать
    // секунды рядом с днями — ошибка типов, то есть красный `tsc` в `npm run
    // build`, а не молчаливый регресс.
    expect(countdownSource).toContain('display.days');
    expect(countdownSource).toContain('display.hours');
    expect(countdownSource).toContain('display.seconds');
  });

  it('прежнего счётчика с четырьмя числами не осталось', () => {
    expect(code).not.toContain('setCountdown');
    expect(code).not.toContain('countdown.days');
  });

  it('в апстримной странице прежний счётчик на месте — иначе проверка выше пустая', () => {
    expect(upstreamCode).toContain('setCountdown');
    expect(upstreamCode).toContain('countdown.days');
  });

  it('ветка «истекла» и подпись «Действует до» сохранены', () => {
    // Спека велела оставить их как были.
    expect(countdownSource).toContain("display.kind === 'expired'");
    expect(countdownSource).toContain("t('subscription.expiresAt')");
  });
});

describe('пункт 1b: посекундный тик только на последних сутках (#59)', () => {
  it('период интервала — не литерал, а значение из resolveCountdownTickMs', () => {
    // ⚠️ Сердце пункта. Мутация `setInterval(tick, 1000)` красит этот тест:
    // литерал не пройдёт проверку на идентификатор.
    expect(intervalPeriod).toMatch(/^[A-Za-z_$][\w$]*$/);
    expect(countdownSource).toMatch(
      new RegExp(`const\\s+${intervalPeriod}\\s*=\\s*resolveCountdownTickMs\\(`),
    );
  });

  it('период стоит в зависимостях эффекта — иначе он не переключится на секундный', () => {
    // Открытая с вечера страница осталась бы с минутным тиком на финальных
    // часах: эффект не перезапустился бы.
    expect(countdownEffectDeps).toContain(intervalPeriod);
  });

  it('на `null` интервала не заводится вовсе', () => {
    expect(countdownSource).toContain(`if (${intervalPeriod} === null) return;`);
  });

  it('апстримный счётчик тикает раз в секунду безусловно — было именно так', () => {
    expect(upstreamCode).toContain('setInterval(tick, 1000)');
    expect(code).not.toContain('setInterval(tick, 1000)');
  });
});

describe('пункт 2: счётчик и автопродление делят строку пополам (#59)', () => {
  it('раскладку ряда считает чистая функция, а не литерал в разметке', () => {
    expect(code).toContain('resolveSubscriptionInfoRowLayout(');
    // ⚠️ Классы сетки не должны появиться в JSX литералом: тогда ветка «нет
    // автопродления» перестала бы что-либо решать, а дыра вернулась бы молча.
    expect(code).not.toContain('grid-cols-');
  });

  it('вторая колонка появляется ровно тогда, когда есть автопродление', () => {
    // ⚠️ Условие ИСПОЛНЯЕТСЯ на подставленных состояниях, а не сверяется
    // текстом. Мутация «убрать `!subscription.is_daily`» красит суточный случай.
    expect(hasAutopay?.({ is_trial: false, is_daily: false })).toBe(true);
    expect(hasAutopay?.({ is_trial: true, is_daily: false })).toBe(false);
    expect(hasAutopay?.({ is_trial: false, is_daily: true })).toBe(false);
    expect(hasAutopay?.({ is_trial: true, is_daily: true })).toBe(false);
  });

  it('блок автопродления рисуется по выдаче раскладки, а не по своему условию', () => {
    // Два независимых условия разъехались бы молча: колонка есть, блока нет.
    expect(code).toContain('infoRow.autopay !== null &&');
    expect(code).toContain('className={infoRow.countdown}');
  });

  it('второго автопродления на странице не осталось', () => {
    // Блок переехал в ряд; копия на прежнем месте дала бы два тоггла.
    expect(countOf(code, "t('subscription.autoRenewal')")).toBe(1);
  });
});

describe('пункт 3: блока локаций нет (#59)', () => {
  it('в апстримной странице локации на месте — иначе проверки ниже пустые', () => {
    expect(upstreamCode).toContain("t('subscription.locationsLabel')");
    expect(upstreamCode).toContain('getFlagEmoji');
    expect(upstreamCode).toContain('Twemoji');
  });

  it('ни заголовка, ни чипов, ни осиротевших импортов', () => {
    expect(code).not.toContain('locationsLabel');
    expect(code).not.toContain('subscription.servers');
    expect(code).not.toContain('getFlagEmoji');
    expect(code).not.toContain('Twemoji');
    expect(code).not.toContain('react-twemoji');
  });
});

describe('пункт 4: кнопка подключения — общий компонент (#59, #61)', () => {
  it('страница зовёт общий компонент, а не рисует свою копию', () => {
    // ⚠️ Состав акцента и запрет литеральных цветов проверяются там, где они
    // теперь живут, — в `connectDeviceButton.test.ts` и
    // `connectButtonAccent.test.ts`. Здесь сторожится, что страница ими
    // ПОЛЬЗУЕТСЯ, а не завела копию заново.
    expect(connectCall).toContain('connectedDevices={connectedDevices}');
    expect(code).toContain("from '../components/subscription/ConnectDeviceButton'");
    expect(code).not.toContain('resolveConnectButtonAccent');
  });

  it('своей разметки кнопки на странице не осталось', () => {
    // Заголовок кнопки — самый устойчивый признак её разметки.
    expect(code).not.toContain('dashboard.connectDevice');
    expect(code).not.toContain('dashboard.devicesOfMax');
  });

  it('в апстримной странице разметка кнопки на месте — иначе проверка выше пустая', () => {
    expect(upstreamCode).toContain("t('dashboard.connectDevice')");
    expect(upstreamCode).toContain('dashboard.devicesOfMax');
  });

  it('тон кнопки не зависит от зоны расхода трафика', () => {
    // Кнопка меняла цвет по причине, к действию не относящейся. Проверка
    // адресована вызову: `zone` на странице остался для других блоков.
    expect(connectCall).not.toContain('zone.');
  });

  it('HoverBorderGradient со страницы убран целиком', () => {
    // Он и был причиной «свечение только под курсором»: правило
    // `.hover-border-gradient:hover` в globals.css, а наведения на телефоне и
    // в Telegram не существует.
    expect(code).not.toContain('HoverBorderGradient');
    expect(code).not.toContain('hover-border-gradient');
  });

  it('в апстримной странице HoverBorderGradient на месте — иначе проверка выше пустая', () => {
    expect(upstreamCode).toContain('HoverBorderGradient');
  });

  it('состояние «лимит устройств» считает сам компонент', () => {
    // Два независимых расчёта разъехались бы молча: кнопка выключена на одном
    // экране и жива на другом. Отличимость состояния сторожится в
    // `connectDeviceButton.test.ts` и `connectButtonAccent.test.ts`.
    expect(code).not.toContain('isAtDeviceLimit');
    expect(code).not.toContain('deviceLimitReached');
  });
});

describe('пункт 4b: склейка классов починена в обоих наших файлах (#59)', () => {
  it('на простой странице подписки склеек нет', () => {
    expect(gluedClassTemplates(code)).toEqual([]);
  });

  it('в карточке подписки на главной склеек нет', () => {
    expect(gluedClassTemplates(activeCard)).toEqual([]);
  });

  it('шаблоны классов в обоих файлах есть, а не просто «склейки нет»', () => {
    // Парная проверка: пустой файл склеек тоже не содержит. Сам класс
    // состояния переехал в общий компонент (#61) и сторожится там.
    expect(classNameTemplates(code).length).toBeGreaterThan(0);
    expect(classNameTemplates(activeCard).length).toBeGreaterThan(0);
  });
});

describe('пункты 5 и 6: порядок блоков карточки (#59)', () => {
  /** Якоря — код, а не заголовки-комментарии: комментарий переписать дешевле блока. */
  const ORDER: [string, string][] = [
    ['трафик', '<TrafficProgressBar'],
    ['подключить устройство', '<ConnectDeviceButton'],
    ['продлить подписку', '<PurchaseCTAButton subscription={subscription} />'],
    ['ссылка', 'displayedConnectionUrl && !shouldHideConnectionLink'],
    ['счётчик и автопродление', 'resolveSubscriptionInfoRowLayout('],
    ['пакеты трафика', 'subscription.traffic_purchases &&'],
    ['СБП', "sbpUiStateValue !== 'hidden'"],
    ['Lava', "lavaUiStateValue !== 'hidden'"],
  ];

  it('все якоря порядка найдены — иначе сравнение индексов бессмысленно', () => {
    for (const [name, anchor] of ORDER) {
      expect(`${name}: ${at(code, anchor)}`).not.toBe(`${name}: -1`);
    }
  });

  it('блоки идут в порядке из спеки владельца', () => {
    // ⚠️ Схема «Действия наверху»: шапка, трафик, ПОДКЛЮЧИТЬ, ПРОДЛИТЬ,
    // ссылка, ряд «счётчик + автопродление», пакеты, СБП, Lava.
    const positions = ORDER.map(([, anchor]) => at(code, anchor));

    for (let i = 1; i < positions.length; i += 1) {
      expect(`${ORDER[i][0]} после ${ORDER[i - 1][0]}`).toBe(
        positions[i] > positions[i - 1]
          ? `${ORDER[i][0]} после ${ORDER[i - 1][0]}`
          : `${ORDER[i][0]} ПЕРЕД ${ORDER[i - 1][0]}`,
      );
    }
  });

  it('кнопка продления стоит внутри карточки, а не под ней', () => {
    // Раньше `PurchaseCTAButton` жил снаружи, после всей карточки.
    const card = at(code, 'const usedGb = trafficData?.traffic_used_gb');
    const cta = at(code, '<PurchaseCTAButton subscription={subscription} />');

    expect(card).toBeGreaterThan(-1);
    expect(cta).toBeGreaterThan(card);
  });

  it('снаружи кнопка осталась ровно для случая «подписки нет»', () => {
    // Карточки в этом состоянии нет вовсе, а `resolveSubscriptionCta(null)`
    // отдаёт единственное действие экрана — «Оформить подписку».
    expect(code).toContain('{!subscription && <PurchaseCTAButton subscription={null} />}');
    expect(countOf(code, '<PurchaseCTAButton')).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Блок «Дополнительные опции» после переезда смены тарифа (задача #61).
 * ══════════════════════════════════════════════════════════════════════════ */

/** Разметка блока «Дополнительные опции» — от его условия до следующего блока. */
const optionsBlock = (() => {
  const from = at(code, '{subscription && additionalOptions.visible && (');
  const to = at(code, 'subscription.revoke.button');
  return from === -1 || to === -1 || to < from ? '' : code.slice(from, to);
})();

describe('блок «Дополнительные опции» рисуется по чистой функции (#61)', () => {
  it('разметка блока вырезана — иначе проверки по ней пустые', () => {
    expect(optionsBlock.length).toBeGreaterThan(1000);
    expect(optionsBlock).toContain('additionalOptions.tariffChange');
    // Кусок не должен захватить соседний блок перевыпуска.
    expect(optionsBlock).not.toContain('subscription.revoke');
  });

  it('состав блока считает `resolveAdditionalOptions`, а не условия в разметке', () => {
    // ⚠️ Сердце пункта. Условие в JSX — это второй источник истины, и он
    // разъехался бы с правилом смены тарифа из `purchaseCta` молча.
    expect(code).toContain('resolveAdditionalOptions(');
    expect(code).toContain('{subscription && additionalOptions.visible && (');
  });

  it('прежнего условия «ненулевой лимит устройств» в разметке не осталось', () => {
    // Оно и было ловушкой: `device_limit === 0` — это БЕЗЛИМИТ по устройствам,
    // и такому пользователю блока не показывали вовсе.
    expect(code).not.toContain('device_limit !== 0');
  });

  it('в апстримной странице это условие на месте — иначе проверка выше пустая', () => {
    expect(upstreamCode).toContain('device_limit !== 0');
  });

  it('каждый пункт блока выдаётся по своему флагу из той же функции', () => {
    for (const flag of [
      'additionalOptions.deviceTopup &&',
      'additionalOptions.deviceReduction &&',
      'additionalOptions.trafficTopup &&',
      'additionalOptions.serverManagement &&',
      'additionalOptions.tariffChange &&',
    ]) {
      expect(`${flag}: ${code.includes(flag)}`).toBe(`${flag}: true`);
    }
  });

  it('своих условий у пунктов не осталось', () => {
    // Два условия на один пункт разъехались бы: функция говорит «показать»,
    // разметка молчит.
    expect(code).not.toContain('subscription.traffic_limit_gb > 0 && (');
    expect(code).not.toContain('{!isTariffsMode && (');
  });

  it('пункт смены тарифа берёт действие и адрес из выдачи, а не пишет свои', () => {
    expect(code).toContain('<TariffChangeOption action={additionalOptions.tariffChange}');
    expect(code).not.toContain("'/subscription/purchase'");
  });

  it('отступы между пунктами задаёт контейнер, а не сами пункты', () => {
    // При `mt-4` на каждом кроме первого блок с единственным пунктом получил бы
    // лишний отступ под заголовком, а какой пункт окажется первым — переменная.
    // Проверка адресована самому блоку: `mt-4` в других местах страницы к делу
    // не относится.
    expect(optionsBlock).toContain('<div className="space-y-4">');
    expect(optionsBlock).not.toContain('mt-4');
  });
});
