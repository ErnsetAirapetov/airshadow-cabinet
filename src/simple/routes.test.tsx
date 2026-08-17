import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchSimpleRoute, type SimpleRoute } from './routeMatch';

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
  it('боевой реестр подменяет главную, баланс и сумму пополнения', () => {
    // Сторож состава. Раньше здесь стояло ожидание пустого реестра — каркас не
    // подменял ничего; первая простая страница (задача #27) его уронила, как и
    // было задумано. Дальше список растёт задачами милстоуна [M1-E05], и каждая
    // новая страница обязана появиться здесь осознанно.
    expect(registeredPaths).toEqual(['/', '/balance', '/balance/top-up/:methodId']);
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

  it('литерал реестра сильнее параметра независимо от порядка записей', () => {
    const paramFirst: SimpleRoute[] = [
      { path: '/subscriptions/:id', component: Stub },
      { path: '/subscriptions/new', component: Stub },
    ];

    expect(matchSimpleRoute(paramFirst, '/subscriptions/new')?.path).toBe('/subscriptions/new');
  });
});
