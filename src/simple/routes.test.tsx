import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchSimpleRoute, type SimpleRoute, UPSTREAM_LITERAL_PATHS } from './routeMatch';

const Stub = () => null;

const routes: SimpleRoute[] = [
  { path: '/', component: Stub },
  { path: '/subscriptions', component: Stub },
  { path: '/subscriptions/:id', component: Stub },
];

/**
 * ⚠️ Реестр читается ТЕКСТОМ, а не импортом.
 *
 * `routes.tsx` статически импортирует простые страницы (ленивая загрузка слою
 * запрещена каноном), а те тянут api, store и platform — все через alias `@/`,
 * которого нет в `vitest.config.ts`. Конфиг апстримный: добавить туда alias
 * значит завести ещё один вечно конфликтующий файл, ради теста этого не делаем.
 * Разбор текстом — тот же приём, которым ниже читается `App.tsx`.
 *
 * Цена приёма: путь, собранный из переменной, сторож не увидит. Поэтому в
 * `routes.tsx` стоит требование писать путь строковым литералом, а проверка
 * «разбор удался» ниже ловит случай, когда регулярка перестала находить хоть
 * что-нибудь.
 */
const routesSource = readFileSync('src/simple/routes.tsx', 'utf8');
const registeredPaths = [...routesSource.matchAll(/^\s*\{\s*path:\s*'([^']+)'/gm)].map(
  (match) => match[1],
);

/**
 * Маршруты `App.tsx` под `ProtectedRoute` — то есть покрытые швом.
 *
 * Разбор текстом, как и у реестра выше: импортировать `App.tsx` в тест нельзя.
 * Поднят на уровень модуля, потому что нужен двум сторожам ниже — покрытию шва и
 * защите литеральных маршрутов апстрима от записи реестра с параметром.
 */
const appSource = readFileSync('src/App.tsx', 'utf8');
const protectedPaths = new Set<string>();
for (const chunk of appSource.split('<Route').slice(1)) {
  const path = chunk.match(/path="([^"]+)"/)?.[1];
  if (path && chunk.includes('<ProtectedRoute')) {
    protectedPaths.add(path);
  }
}

describe('matchSimpleRoute', () => {
  it('корень совпадает точно и не ловит остальные пути', () => {
    expect(matchSimpleRoute(routes, '/')?.path).toBe('/');
    expect(matchSimpleRoute(routes, '/balance')).toBeNull();
  });

  it('различает список и карточку с параметром', () => {
    expect(matchSimpleRoute(routes, '/subscriptions')?.path).toBe('/subscriptions');
    expect(matchSimpleRoute(routes, '/subscriptions/17')?.path).toBe('/subscriptions/:id');
  });

  it('не совпадает по префиксу — иначе подменялись бы вложенные экраны', () => {
    // `/subscriptions/17/edit` — не карточка подписки. Совпадение по префиксу
    // молча подсунуло бы простую страницу вместо нужной.
    expect(matchSimpleRoute(routes, '/subscriptions/17/edit')).toBeNull();
  });

  it('пустой реестр не подменяет ничего', () => {
    expect(matchSimpleRoute([], '/')).toBeNull();
  });
});

describe('состав реестра', () => {
  it('боевой реестр подменяет главную, баланс, пополнение, новости, покупку, продление, подписку и поддержку', () => {
    // Сторож состава. Раньше здесь стояло ожидание пустого реестра — каркас не
    // подменял ничего; первая простая страница (задача #27) его уронила, как и
    // было задумано. Дальше список растёт задачами милстоуна [M1-E05], и каждая
    // новая страница обязана появиться здесь осознанно.
    expect(registeredPaths).toEqual([
      '/',
      '/balance',
      '/balance/top-up',
      '/balance/top-up/:methodId',
      '/news',
      '/subscription/purchase',
      '/subscriptions',
      '/subscriptions/:subscriptionId',
      '/subscriptions/:subscriptionId/renew',
      '/support',
    ]);
  });

  it('пути в реестре не повторяются', () => {
    // Дубль пути не сломал бы ничего заметно: сработала бы первая запись, а
    // вторая молча не рендерилась бы никогда.
    expect(registeredPaths).toHaveLength(new Set(registeredPaths).size);
  });

  it('разбор поймал ВСЕ записи реестра, а не часть', () => {
    // Слабое место текстового разбора: путь, записанный константой или
    // шаблонной строкой, регулярка не увидит и сторож покрытия молча его
    // пропустит. Записей в реестре ровно столько, сколько компонентов, поэтому
    // расхождение этих двух чисел и есть признак пропуска.
    const componentEntries = routesSource.match(/^\s*\{[^}]*component:/gm) ?? [];

    expect(registeredPaths).toHaveLength(componentEntries.length);
  });
});

/**
 * Шов подмены живёт в `ProtectedRoute`. Путь, который идёт мимо него —
 * публичный или админский, — молча не подменится: ни ошибки сборки, ни
 * исключения. Этот сторож ловит такую запись в `npm test`.
 */
describe('покрытие шва', () => {
  it('разбор App.tsx удался — иначе сторож молча пропускал бы всё', () => {
    // Без этой проверки сломанный разбор дал бы пустое множество, и следующий
    // тест проходил бы всегда, ничего не охраняя.
    expect(protectedPaths.size).toBeGreaterThan(20);
    expect(protectedPaths.has('/')).toBe(true);
    expect(protectedPaths.has('/balance')).toBe(true);
    // Публичный маршрут под шов не попадает.
    expect(protectedPaths.has('/privacy')).toBe(false);
  });

  it('разбор реестра удался — иначе сторож сверял бы пустоту', () => {
    expect(registeredPaths.length).toBeGreaterThan(0);
  });

  it('каждый путь реестра ведёт на маршрут под ProtectedRoute', () => {
    const uncovered = registeredPaths.filter((path) => !protectedPaths.has(path));

    // Пусто — значит ни одна простая страница не зарегистрирована в никуда.
    expect(uncovered).toEqual([]);
  });
});

/**
 * Запись реестра с параметром шире, чем выглядит: `/balance/top-up/:methodId`
 * совпадает и с апстримным `/balance/top-up/result` — литеральный сегмент для
 * `matchPath` такой же сегмент, как любой другой. Шов в `ProtectedRoute` выбирает
 * страницу по `location.pathname`, а не по выигравшему `<Route>`, поэтому перехват
 * не остановит ничто: человек, вернувшийся от провайдера, увидит вместо результата
 * оплаты выбор способа платежа.
 *
 * Отсюда два сторожа: точечный на сам этот путь и общий на все статические
 * маршруты под швом, чтобы следующая страница с параметром не наступила на то же.
 */
describe('литеральный маршрут апстрима важнее параметра реестра', () => {
  /** Реестр как он есть: пути настоящие, для матчинга важны только они. */
  const liveRoutes: SimpleRoute[] = registeredPaths.map((path) => ({ path, component: Stub }));

  /** Маршруты под швом без параметров — только их может перехватить чужой шаблон. */
  const staticProtectedPaths = [...protectedPaths].filter((path) => !path.includes(':'));

  it('разбор дал статические пути, и экран результата оплаты среди них', () => {
    // Без этой пары общий сторож ниже сверял бы пустоту и проходил всегда.
    expect(staticProtectedPaths.length).toBeGreaterThan(0);
    expect(staticProtectedPaths).toContain('/balance/top-up/result');
  });

  it('экран результата оплаты остаётся апстримным, а способ оплаты подменяется', () => {
    expect(matchSimpleRoute(liveRoutes, '/balance/top-up/result')).toBeNull();
    expect(matchSimpleRoute(liveRoutes, '/balance/top-up/platega')?.path).toBe(
      '/balance/top-up/:methodId',
    );
  });

  it('выбор способа подменяется, и соседи от этого не пострадали (задача #55)', () => {
    // ⚠️ Литерал `/balance/top-up` заведён рядом с параметром
    // `/balance/top-up/:methodId` — тремя строками ниже в том же реестре. Проверка
    // именно тройкой: сам новый путь подменился, экран результата по-прежнему
    // апстримный (иначе повторился бы блокирующий дефект #53), а экран суммы
    // по-прежнему достаётся записи с параметром.
    expect(matchSimpleRoute(liveRoutes, '/balance/top-up')?.path).toBe('/balance/top-up');
    expect(matchSimpleRoute(liveRoutes, '/balance/top-up/result')).toBeNull();
    expect(matchSimpleRoute(liveRoutes, '/balance/top-up/platega')?.path).toBe(
      '/balance/top-up/:methodId',
    );

    // Путь с параметром метода в адресе результата — тоже апстримный: он на
    // сегмент длиннее и ни одной записи реестра не достаётся.
    expect(matchSimpleRoute(liveRoutes, '/balance/top-up/result/lava')).toBeNull();
  });

  it('покупка и продление подменяются, соседи не задеты (задача #29)', () => {
    // ⚠️ Пара путей задачи #29: литерал `/subscription/purchase` и параметр
    // `/subscriptions/:subscriptionId/renew`. У обоих в `App.tsx` есть соседи,
    // на которых легко промахнуться, — отсюда проверка каждой стороны отдельно.
    expect(matchSimpleRoute(liveRoutes, '/subscription/purchase')?.path).toBe(
      '/subscription/purchase',
    );
    expect(matchSimpleRoute(liveRoutes, '/subscriptions/42/renew')?.path).toBe(
      '/subscriptions/:subscriptionId/renew',
    );

    // `/subscription` — апстримный редирект на список, простой версии у него нет.
    // Совпади литерал покупки по префиксу — человек попадал бы на витрину вместо
    // своих подписок.
    expect(matchSimpleRoute(liveRoutes, '/subscription')).toBeNull();

    // Лишний сегмент — уже другой экран, подмены быть не должно.
    expect(matchSimpleRoute(liveRoutes, '/subscription/purchase/tariff')).toBeNull();
    expect(matchSimpleRoute(liveRoutes, '/subscriptions/42/renew/confirm')).toBeNull();
  });

  it('адрес подписки, карточка и продление достаются каждый своей записи (задача #60)', () => {
    // ⚠️ Зонд по БОЕВОМУ реестру. Литерал `/subscriptions` заведён рядом с двумя
    // записями-параметрами — ровно та конфигурация, на которой в #53 запись с
    // параметром накрыла литерального соседа при полностью зелёных тестах.
    // Поэтому проверяются все три адреса, а не только новый.
    expect(matchSimpleRoute(liveRoutes, '/subscriptions')?.path).toBe('/subscriptions');
    expect(matchSimpleRoute(liveRoutes, '/subscriptions/42')?.path).toBe(
      '/subscriptions/:subscriptionId',
    );
    expect(matchSimpleRoute(liveRoutes, '/subscriptions/42/renew')?.path).toBe(
      '/subscriptions/:subscriptionId/renew',
    );
  });

  it('ни один статический маршрут под швом не отдан чужой записи реестра', () => {
    const hijacked = staticProtectedPaths
      .map((path) => ({ path, override: matchSimpleRoute(liveRoutes, path)?.path ?? null }))
      .filter(({ path, override }) => override !== null && override !== path);

    // Подмена у статического пути допустима только записью с ровно этим путём.
    expect(hijacked).toEqual([]);
  });

  it('литеральная запись реестра сильнее списка апстримных маршрутов', () => {
    // Список апстримных литералов — не запрет навсегда: когда у простого режима
    // появится свой экран результата оплаты, он добавится в реестр как литерал и
    // должен выиграть. Иначе список превратился бы в ловушку.
    const withResultPage: SimpleRoute[] = [
      { path: '/balance/top-up/result', component: Stub },
      { path: '/balance/top-up/:methodId', component: Stub },
    ];

    expect(matchSimpleRoute(withResultPage, '/balance/top-up/result')?.path).toBe(
      '/balance/top-up/result',
    );
  });

  /**
   * Список апстримных литералов — ручная копия знаний `App.tsx`, и разъехаться с
   * оригиналом она может в обе стороны. Забытое пополнение ловит общий сторож
   * выше (статический маршрут под швом, отданный чужой записи реестра).
   * Обратную сторону — **протухание** — не ловил никто: апстрим убрал маршрут,
   * запись осталась, и она навсегда молча запрещает подмену этого адреса, в том
   * числе когда простому режиму понадобится там своя страница. Ни сборка, ни
   * тесты об этом не скажут: лишний путь в списке просто никогда не совпадает.
   */
  describe('список апстримных литералов не протух', () => {
    /** Запись годна, только если это реально существующий статический путь под швом. */
    const isLiveStaticPath = (path: string) => !path.includes(':') && protectedPaths.has(path);

    it('проверка различает живой путь, выдуманный и параметр — иначе она пустая', () => {
      // Пара «разбор удался» для предиката, а не для регулярки: сам предикат
      // держится на `protectedPaths`, и стоит разбору `App.tsx` съехать — проверка
      // ниже начала бы валить корректный список вместо протухшего. Три контроля:
      // живой путь принимается, несуществующий и параметр отвергаются.
      expect(isLiveStaticPath('/balance/top-up/result')).toBe(true);
      expect(isLiveStaticPath('/balance/top-up/gone')).toBe(false);
      expect(isLiveStaticPath('/balance/top-up/:methodId')).toBe(false);
    });

    it('каждая запись списка — существующий статический маршрут под ProtectedRoute', () => {
      const stale = UPSTREAM_LITERAL_PATHS.filter((path) => !isLiveStaticPath(path));

      // Пусто — значит список описывает сегодняшний `App.tsx`, а не вчерашний.
      // Пустой список сам по себе законен: апстрим может убрать последнего
      // литерального соседа, и тогда сторожить будет нечего.
      expect(stale).toEqual([]);
    });
  });

  it('литерал реестра сильнее параметра независимо от порядка записей', () => {
    const paramFirst: SimpleRoute[] = [
      { path: '/subscriptions/:id', component: Stub },
      { path: '/subscriptions/new', component: Stub },
    ];

    expect(matchSimpleRoute(paramFirst, '/subscriptions/new')?.path).toBe('/subscriptions/new');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Петля «страница уводит на собственный адрес» (задача #60).
 *
 * Пока `/subscriptions` рисовался апстримным списком, ветка простой страницы
 * подписки «мультитариф без идентификатора → уйти на /subscriptions» была
 * безобидной. С записью реестра на этом же адресе она превращается в
 * бесконечный редирект страницы на саму себя: шов подставляет ту же страницу,
 * та снова редиректит.
 *
 * Сторож сделан общим, а не точечным на эту страницу: пара «литеральный путь в
 * реестре + самоувод из зарегистрированной на нём страницы» повторится у любой
 * следующей простой страницы, а стоит она белого экрана.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Записи реестра целиком — путь и имя компонента; реестр читается текстом. */
const registryEntries = [
  ...routesSource.matchAll(/^\s*\{\s*path:\s*'([^']+)',\s*component:\s*(\w+)\s*\}/gm),
].map((match) => ({ path: match[1], component: match[2] }));

/** Импорты реестра: имя компонента → файл его исходника. */
const componentSources = new Map(
  [...routesSource.matchAll(/import\s*\{\s*(\w+)\s*\}\s*from\s*'\.\/([^']+)'/g)].map((match) => [
    match[1],
    `src/simple/${match[2]}.tsx`,
  ]),
);

/** Комментарии вырезаны: докстринги сами упоминают и адреса, и петли. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Содержимое строковых литералов заменено заглушкой той же длины.
 *
 * Нужно для разбора вложенности: скобка внутри строки не должна за неё
 * считаться. Длина не меняется, поэтому индексы маскированной копии и исходного
 * текста совпадают — искать можно по одной, а решать по другой.
 */
function maskStrings(source: string): string {
  return source.replace(
    /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g,
    (found) => found[0] + 'x'.repeat(found.length - 2) + found[found.length - 1],
  );
}

/**
 * Чем открыт уровень вложенности, чтобы считать его обработчиком действия
 * пользователя. Обе формы — это уже принятое правило «переход из `onClick`
 * разрешён»: проп или поле-колбэк (`onClick={`, `onSuccess:`) и именованная
 * функция обработчика (`const handleRenew = `, `function onDeleted(`).
 */
const HANDLER_OPENERS = [
  /\bon[A-Z]\w*\s*[:=][^;{}]*$/,
  /\b(?:const|let|var|function)\s+(?:handle|on)[A-Z]\w*[^;{}]*$/,
];

/** Текст перед позицией опознаётся как открытие обработчика. */
function opensHandler(masked: string, cursor: number): boolean {
  const tail = masked.slice(Math.max(0, cursor - 200), cursor);

  return HANDLER_OPENERS.some((opener) => opener.test(tail));
}

/**
 * Идёт ли вызов навигации из обработчика.
 *
 * Разбор поднимается наружу по НЕЗАКРЫТЫМ скобкам и смотрит, чем открыт каждый
 * уровень; нулевым уровнем проверяется сам оператор — короткая стрелка
 * `const handleGo = () => navigate(…)` фигурных скобок не открывает вовсе.
 *
 * ⚠️ Правило ФЕЙЛ-КЛОУЗД: всё, что не опознано обработчиком, считается
 * самоуводом. Перечислять «места, откуда нельзя» — тупик, на котором сторож уже
 * один раз оказался: пока он искал маркер `useEffect(`, та же самая петля,
 * записанная через `useLayoutEffect` или голым вызовом в теле рендера, держала
 * `npm test` зелёным.
 */
function insideHandler(masked: string, index: number): boolean {
  if (opensHandler(masked, index)) {
    return true;
  }

  let round = 0;
  let curly = 0;

  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const char = masked[cursor];

    if (char === ')') {
      round += 1;
    } else if (char === '}') {
      curly += 1;
    } else if (char === '(' && round > 0) {
      round -= 1;
    } else if (char === '{' && curly > 0) {
      curly -= 1;
    } else if ((char === '(' || char === '{') && opensHandler(masked, cursor)) {
      return true;
    }
  }

  return false;
}

/**
 * Адреса, на которые исходник уводит САМ, без действия пользователя.
 *
 * Два источника: `<Navigate to="…" />` — редирект по определению — и вызов
 * `navigate('…')` откуда угодно, КРОМЕ обработчика. Тело рендера, `useEffect`,
 * `useLayoutEffect`, `useInsertionEffect` разбор не различает и различать не
 * должен: петля во всех четырёх одинакова.
 *
 * ⚠️ Известное ограничение — разбор текстовый и видит только литеральный адрес
 * в самом файле страницы. Переход через переменную (`navigate(target)`), через
 * `<Navigate to={expr} />` или из чужого модуля ему не виден. Ровно так же это
 * записано в каноне: обещать больше, чем сторож держит, нельзя.
 */
function selfNavigationTargets(source: string): string[] {
  const code = stripComments(source);
  const masked = maskStrings(code);
  const targets: string[] = [];

  for (const found of code.matchAll(/<Navigate[^>]*\bto=\{?['"]([^'"]+)['"]/g)) {
    targets.push(found[1]);
  }

  for (const found of code.matchAll(/\bnavigate\(\s*['"]([^'"]+)['"]/g)) {
    if (!insideHandler(masked, found.index)) {
      targets.push(found[1]);
    }
  }

  return targets;
}

describe('простая страница не уводит на собственный адрес', () => {
  /**
   * Фикстура-мутация для разбора: в ней собраны все формы сразу — четыре
   * самоувода, два законных перехода из обработчика и ловушка на маскирование
   * строк. Без неё сломанный разбор дал бы вечно зелёного сторожа.
   */
  const fixture = [
    'function Page() {',
    '  useEffect(() => {',
    "    log(':)');",
    "    navigate('/loop-effect', { replace: true });",
    '  }, []);',
    '  useLayoutEffect(() => {',
    "    navigate('/loop-layout');",
    '  }, []);',
    "  if (bare) navigate('/loop-body');",
    "  log('onClick={');",
    "  navigate('/loop-string-trap');",
    "  const handleGo = () => navigate('/not-a-loop-named');",
    '  if (bad) return <Navigate to="/loop-render" replace />;',
    "  return <button onClick={() => { navigate('/not-a-loop-click'); }} />;",
    '}',
  ].join('\n');

  const fixtureTargets = selfNavigationTargets(fixture);

  it('разбор ловит редирект отрисовки и все три формы вызова вне обработчика', () => {
    // `useLayoutEffect` и голый вызов в теле рендера — ровно те две формы, на
    // которых прежний разбор по маркеру `useEffect(` молчал при живой петле.
    expect(fixtureTargets).toContain('/loop-render');
    expect(fixtureTargets).toContain('/loop-effect');
    expect(fixtureTargets).toContain('/loop-layout');
    expect(fixtureTargets).toContain('/loop-body');
  });

  it('разбор не трогает переходы из обработчика — иначе сторож запрещал бы законное', () => {
    // Обе принятые формы: проп-обработчик и именованная функция обработчика,
    // записанная короткой стрелкой без фигурных скобок.
    expect(fixtureTargets).not.toContain('/not-a-loop-click');
    expect(fixtureTargets).not.toContain('/not-a-loop-named');
  });

  it('строковый литерал не выдаёт себя за открытие обработчика', () => {
    // Ловушка на маскирование: `log('onClick={')` — это строка, а не обработчик.
    // Без маскирования разбор принял бы её за него и пропустил бы петлю.
    expect(fixtureTargets).toContain('/loop-string-trap');
  });

  it('реестр разобран вместе с компонентами и их файлами', () => {
    // Пара «разбор удался» для сторожа ниже: он читает исходники страниц по
    // именам компонентов, и незамеченная запись означала бы непроверенную
    // страницу при зелёном тесте.
    expect(registryEntries).toHaveLength(registeredPaths.length);
    expect(registryEntries.filter(({ component }) => !componentSources.has(component))).toEqual([]);

    const missing = registryEntries.filter(
      ({ component }) => !existsSync(componentSources.get(component) ?? ''),
    );
    expect(missing).toEqual([]);
  });

  it('страница подписки зарегистрирована на литеральном /subscriptions (задача #60)', () => {
    // Предпосылка сторожа: без литеральной записи проверять было бы нечего, и
    // он проходил бы, ничего не охраняя.
    expect(registryEntries).toContainEqual({
      path: '/subscriptions',
      component: 'SimpleSubscription',
    });
  });

  it('ни одна страница не уводит сама на путь, на котором зарегистрирована', () => {
    const loops = registryEntries
      .filter(({ path }) => !path.includes(':'))
      .flatMap(({ path, component }) => {
        const file = componentSources.get(component) ?? '';
        const source = existsSync(file) ? readFileSync(file, 'utf8') : '';

        return selfNavigationTargets(source)
          .filter((target) => target === path)
          .map((target) => ({ page: component, target }));
      });

    // Пусто — значит подмена не отправляет пользователя туда, откуда шов вернёт
    // ему ту же страницу, и так до бесконечности.
    expect(loops).toEqual([]);
  });
});
