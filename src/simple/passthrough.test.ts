import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPassthroughPath, PASSTHROUGH_PATHS, shouldPassthrough } from './passthrough';
import { matchPathList } from './routeMatch';

/**
 * Сторожа сквозного списка (#64) — третьей ветки шва `ProtectedRoute`.
 *
 * Сквозной список меняет не страницу, а ОБОЛОЧКУ: апстримная страница рисуется
 * в `SimpleShell`. Отсюда главная особенность цены ошибки — она молчалива.
 * Промах реестра виден сразу (не тот экран), промах сквозного списка выглядит
 * как «страница почему-то в другой рамке», и заметить его можно только глазами
 * на конкретном адресе. Поэтому сторожей здесь больше, чем кажется нужным.
 *
 * ⚠️ Файл отдельный от `routes.test.tsx` намеренно: сквозной список и реестр —
 * разные списки с разной семантикой, и параллельные задачи не должны драться за
 * один тестовый файл.
 *
 * ⚠️ `App.tsx`, `routes.tsx`, `index.tsx` и шапки разбираются ТЕКСТОМ, а не
 * импортом: `vitest.config.ts` апстримный (`environment: 'node'`, alias `@/`
 * нет), и импорт любого из них потянул бы страницы и весь граф приложения. Цена
 * приёма та же, что у остальных сторожей простого режима, — разбор видит только
 * литералы, поэтому у каждого текстового сторожа есть пара «разбор удался».
 */
const appSource = readFileSync('src/App.tsx', 'utf8');
const routesSource = readFileSync('src/simple/routes.tsx', 'utf8');
const entrySource = readFileSync('src/simple/index.tsx', 'utf8');
const appShellSource = readFileSync('src/components/layout/AppShell/AppShell.tsx', 'utf8');
const appHeaderSource = readFileSync('src/components/layout/AppShell/AppHeader.tsx', 'utf8');

/**
 * Комментарии выбрасываем до поиска — иначе сторож бумажный.
 *
 * И шапки, и шов объясняют своё поведение докстрингами, которые цитируют имена
 * функций. Без этого шага цитаты в комментарии хватило бы, чтобы сторож остался
 * зелёным при потерянном коде. Тот же приём, что в `entryPoint.test.ts`,
 * `openDirsPurity.test.ts` и `scripts/check-mode-boundaries.mjs`.
 */
function stripComments(code: string): string {
  return code
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Маршруты `App.tsx` под `ProtectedRoute` — то есть покрытые швом. */
const protectedPaths = new Set<string>();
/** Пути, объявленные БЕЗ оболочки: `withLayout={false}`. */
const withoutLayoutPaths = new Set<string>();
for (const chunk of appSource.split('<Route').slice(1)) {
  const path = chunk.match(/path="([^"]+)"/)?.[1];
  if (!path || !chunk.includes('<ProtectedRoute')) {
    continue;
  }
  protectedPaths.add(path);
  if (chunk.includes('withLayout={false}')) {
    withoutLayoutPaths.add(path);
  }
}

/** Пути реестра простых страниц — читаем текстом, как это делает routes.test.tsx. */
const registeredPaths = [...routesSource.matchAll(/^\s*\{\s*path:\s*'([^']+)'/gm)].map(
  (match) => match[1],
);

describe('состав сквозного списка', () => {
  it('разбор удался — список прочитан импортом и непустой', () => {
    // Пара к сторожам ниже: пустой список делал бы их вечно зелёными.
    expect(PASSTHROUGH_PATHS.length).toBeGreaterThan(0);
  });

  it('список — ровно двенадцать путей, назначенных владельцем', () => {
    // Сторож состава. Список — решение владельца (#64), а не догадка
    // исполнителя: добавление или удаление адреса обязано быть осознанным и
    // видным в дифе, поэтому сверка полная, а не «содержит».
    expect([...PASSTHROUGH_PATHS]).toEqual([
      '/connection',
      '/connection/qr',
      '/referral',
      '/referral/partner/apply',
      '/referral/withdrawal/request',
      '/profile',
      '/profile/accounts',
      '/info',
      '/info/:slug',
      '/wheel',
      '/gift',
      '/gift/result',
    ]);
  });

  it('пути в списке не повторяются', () => {
    // Дубль ничего бы не сломал заметно — просто вторая запись никогда не
    // сработала бы. Молчаливый мусор в списке решений владельца недопустим.
    expect(PASSTHROUGH_PATHS).toHaveLength(new Set(PASSTHROUGH_PATHS).size);
  });
});

/**
 * Сквозной список — ручная копия знаний `App.tsx`, и протухнуть он может молча:
 * апстрим уберёт маршрут, запись останется и не совпадёт никогда. Ни сборка, ни
 * остальные тесты об этом не скажут. Образец сторожа — `UPSTREAM_LITERAL_PATHS`
 * в `routes.test.tsx` (#57), заведённый против ровно этой протухаемости.
 */
describe('каждая запись — существующий маршрут под ProtectedRoute', () => {
  it('разбор App.tsx удался — иначе сторож молча пропускал бы всё', () => {
    expect(protectedPaths.size).toBeGreaterThan(20);
    expect(protectedPaths.has('/profile')).toBe(true);
    expect(protectedPaths.has('/info/:slug')).toBe(true);
    // Публичный маршрут под шов не попадает — значит разбор различает ветки.
    expect(protectedPaths.has('/privacy')).toBe(false);
  });

  it('разбор нашёл маршруты без оболочки — пара к сторожу withLayout ниже', () => {
    expect([...withoutLayoutPaths].sort()).toEqual([
      '/balance/top-up/result',
      '/balance/top-up/result/:method',
    ]);
  });

  it('ни одна запись сквозного списка не ведёт в никуда', () => {
    const missing = PASSTHROUGH_PATHS.filter((path) => !protectedPaths.has(path));

    // Пусто — значит все двенадцать адресов существуют и стоят под швом.
    // Апстрим уберёт любой из них — здесь и покраснеет.
    expect(missing).toEqual([]);
  });

  it('сквозной список не претендует на маршруты без оболочки', () => {
    // `withLayout={false}` означает «без оболочки вообще». Запись такого пути в
    // сквозной список читалась бы как требование обернуть его в SimpleShell —
    // прямое противоречие маршруту.
    const clashing = PASSTHROUGH_PATHS.filter((path) => withoutLayoutPaths.has(path));

    expect(clashing).toEqual([]);
  });
});

/**
 * Обратная сторона сторожа выше — и до неё дело не доходило. Сквозной список
 * проверялся только «изнутри»: что каждая его запись существует в `App.tsx`.
 * Обратное не запрещал никто — чтобы ЧУЖОЙ апстримный маршрут молча уехал в
 * простую оболочку, совпав с нашей записью-параметром.
 *
 * Это ловушка #53 на новом списке: для `matchPath` литеральный сегмент
 * неотличим от параметра, и `/info/:slug` совпадёт с апстримным литералом
 * `/info/archive` ничуть не хуже, чем со статьёй FAQ. Апстрим заведёт такой
 * маршрут — и чужая страница тихо сменит оболочку при зелёных `npm test` и
 * `npm run check:modes`. Образец сторожа — «ни один статический маршрут под
 * швом не отдан чужой записи реестра» в `routes.test.tsx`.
 *
 * ⚠️ Лечится сторожем, а не пополнением `UPSTREAM_LITERAL_PATHS`: живых
 * литеральных соседей у `/info/` сегодня нет, а запись в списке без нужды сама
 * стала бы протухшей (за это `routes.test.tsx` красит отдельно).
 */
describe('ни один чужой маршрут под швом не уехал в простую оболочку', () => {
  /** Записи с параметром сравнивать не с чем: буквально они в рантайме не встречаются. */
  const staticProtectedPaths = [...protectedPaths].filter((path) => !path.includes(':'));

  it('разбор удался и сторож различает своё и чужое', () => {
    // Без пары проверка ниже осталась бы зелёной и на пустом наборе, и на
    // сломанном матчинге. Три контроля: набор непустой; свой путь достаётся
    // себе; выдуманный апстримный литерал под `/info/` — ровно тот случай, ради
    // которого сторож заведён, — распознаётся как чужой.
    expect(staticProtectedPaths.length).toBeGreaterThan(20);
    expect(matchPathList(PASSTHROUGH_PATHS, '/profile')).toBe('/profile');
    expect(matchPathList(PASSTHROUGH_PATHS, '/info/archive')).toBe('/info/:slug');
  });

  it('статический маршрут либо не сквозной вовсе, либо сквозной сам по себе', () => {
    const hijacked = staticProtectedPaths
      .map((path) => ({ path, matched: matchPathList(PASSTHROUGH_PATHS, path) }))
      .filter(({ path, matched }) => matched !== null && matched !== path);

    // Пусто — значит оболочку меняют только адреса из списка владельца.
    // Апстрим заведёт под швом `/info/archive` — здесь и покраснеет.
    expect(hijacked).toEqual([]);
  });
});

/**
 * Реестр сильнее сквозного списка: путь, у которого есть простая страница,
 * обязан достаться ей. Порядок веток в шве это обеспечивает, но путь в ОБОИХ
 * списках — не выбор приоритета, а ошибка конфигурации: одна из двух записей
 * мертва, и какая именно — видно только по порядку веток в чужом файле.
 *
 * Это же и обратный ход, обещанный владельцем: когда у страницы появится своя
 * простая версия, путь ПЕРЕЕЗЖАЕТ из сквозного списка в реестр. Сторож требует
 * именно переезда, а не копирования.
 */
describe('сквозной список и реестр не пересекаются', () => {
  it('разбор реестра удался — иначе сверялась бы пустота', () => {
    expect(registeredPaths.length).toBeGreaterThan(0);
    expect(registeredPaths).toContain('/');
  });

  it('пересечение пусто — путь живёт ровно в одном списке', () => {
    const both = PASSTHROUGH_PATHS.filter((path) => registeredPaths.includes(path));

    expect(both).toEqual([]);
  });
});

describe('isPassthroughPath', () => {
  it('отвечает «да» на все двенадцать адресов владельца', () => {
    // Литеральные записи проверяются собой, запись с параметром — реальным
    // адресом статьи: `/info/:slug` в рантайме никогда не встретится буквально.
    const probes = PASSTHROUGH_PATHS.map((path) =>
      path === '/info/:slug' ? '/info/kak-podklyuchit' : path,
    );

    expect(probes.filter((probe) => !isPassthroughPath(probe))).toEqual([]);
  });

  it('отвечает «нет» соседям, которых в списке нет', () => {
    // Промах сквозного списка не подменяет страницу, а меняет оболочку, и
    // потому молчалив: человек увидит апстримную админку в простой рамке.
    expect(isPassthroughPath('/admin')).toBe(false);
    expect(isPassthroughPath('/support')).toBe(false);
    expect(isPassthroughPath('/news/kak-podklyuchit')).toBe(false);
    expect(isPassthroughPath('/contests')).toBe(false);
    // Главная — страница реестра, сквозным она быть не должна ни при каких.
    expect(isPassthroughPath('/')).toBe(false);
  });

  it('не совпадает по префиксу — вложенный экран не сквозной', () => {
    // Совпадение по префиксу утащило бы в простую оболочку всё поддерево, в том
    // числе адреса, которых сегодня нет, а завтра апстрим заведёт.
    expect(isPassthroughPath('/profile/accounts/telegram')).toBe(false);
    expect(isPassthroughPath('/info/kak-podklyuchit/print')).toBe(false);
    expect(isPassthroughPath('/gift/result/ok')).toBe(false);
  });

  it('запись с параметром не накрывает литерального соседа апстрима', () => {
    // Ловушка #53 в чистом виде: для `matchPath` литеральный сегмент — такой же
    // сегмент, как параметр. Матчинг здесь переиспользован из `routeMatch.ts`
    // ровно ради этого, второго матчинга в проекте быть не должно.
    expect(isPassthroughPath('/balance/top-up/result')).toBe(false);
  });
});

describe('shouldPassthrough — сквозной список действует только в простом режиме', () => {
  it('в простом режиме сквозной путь даёт простую оболочку', () => {
    expect(shouldPassthrough('simple', '/profile')).toBe(true);
  });

  it('в экспертном режиме сквозной список не действует вовсе', () => {
    // Критерий приёмки #64: в экспертном режиме поведение всех двенадцати путей
    // не меняется — апстримная страница в апстримной оболочке, как сегодня.
    expect(shouldPassthrough('expert', '/profile')).toBe(false);
    expect(shouldPassthrough('expert', '/connection')).toBe(false);
  });

  it('в простом режиме путь вне списка сквозным не становится', () => {
    expect(shouldPassthrough('simple', '/admin')).toBe(false);
  });
});

/**
 * Шов `ProtectedRoute` — третья ветка.
 *
 * Разбор текстом: `App.tsx` в тест не импортировать. Проверяется не наличие
 * строк, а ПОРЯДОК веток — он и есть решение о приоритете реестра, и переставить
 * его можно случайно, не заметив.
 */
describe('шов ProtectedRoute знает три ветки', () => {
  const seamStart = appSource.indexOf('function ProtectedRoute(');
  const seamEnd = appSource.indexOf('function AdminRoute(');
  const seam = stripComments(appSource.slice(seamStart, seamEnd));

  it('разбор шва удался — тело ProtectedRoute найдено', () => {
    // Без пары переименование ProtectedRoute дало бы отрицательные индексы,
    // пустую строку и вечно зелёные проверки ниже.
    expect(seamStart).toBeGreaterThan(-1);
    expect(seamEnd).toBeGreaterThan(seamStart);
    expect(seam).toContain('useSimpleOverride');
  });

  it('шов спрашивает сквозной список хуком простого слоя', () => {
    // Хук — потому что решение зависит от режима, а режим живёт в store.
    // Вызов обязан стоять ДО ранних возвратов, иначе порядок хуков плывёт.
    expect(seam).toContain('useSimplePassthrough(location.pathname)');
  });

  it('ветка реестра стоит ПЕРЕД сквозной — простая страница сильнее', () => {
    // Сравниваются именно ВЕТКИ, а не первое упоминание имени: объявление
    // `const isPassthrough = …` стоит выше обеих веток по правилам хуков.
    const registryBranch = seam.indexOf('if (SimplePage)');
    const passthroughBranch = seam.indexOf('if (isPassthrough)');

    expect(registryBranch).toBeGreaterThan(-1);
    expect(passthroughBranch).toBeGreaterThan(registryBranch);
  });

  it('сквозная ветка стоит ПЕРЕД апстримной — иначе она недостижима', () => {
    const passthroughBranch = seam.indexOf('if (isPassthrough)');
    const upstreamBranch = seam.indexOf('<Layout>');

    expect(passthroughBranch).toBeGreaterThan(-1);
    expect(upstreamBranch).toBeGreaterThan(passthroughBranch);
  });

  it('сквозная ветка уважает withLayout и рисует SimpleShell', () => {
    // Без `withLayout` в этой ветке маршруты `/balance/top-up/result*` получили
    // бы оболочку, которой у них нет по замыслу апстрима.
    //
    // ⚠️ Берётся ТЕЛО ветки, а не кусок файла до `<Layout>`: у апстримной ветки
    // ниже `withLayout` стоит перед `<Layout>` в той же строке, поэтому срез по
    // `<Layout>` содержал бы чужое слово `withLayout` и оставался зелёным при
    // потерянном условии (проверено мутацией).
    const branch = seam.match(/if \(isPassthrough\) \{([\s\S]*?)\n {2}\}/)?.[1];

    expect(branch, 'тело ветки isPassthrough не разобрано').toBeTruthy();
    expect(branch).toContain('withLayout');
    expect(branch).toContain('<SimpleShell>');
  });
});

/**
 * Переключатель режима в обеих шапках.
 *
 * До #64 шапки спрашивали `resolveSimpleRoute(...) === null` — то есть «есть ли
 * СТРАНИЦА в реестре». Для сквозного пути ответ был бы «нет», и переключение
 * режима на `/profile` выбрасывало бы человека на главную, хотя простая версия
 * (в смысле оболочки) там теперь есть. Возврат старой записи обязан ронять тест.
 */
describe('шапки спрашивают hasSimpleView, а не реестр напрямую', () => {
  const headers = [
    ['AppShell.tsx', appShellSource],
    ['AppHeader.tsx', appHeaderSource],
  ] as const;

  for (const [name, source] of headers) {
    const code = stripComments(source);

    it(`${name}: разбор удался — файл прочитан и содержит переключатель`, () => {
      expect(source.length).toBeGreaterThan(100);
      expect(code).toContain("setMode('simple')");
      expect(code).toContain("navigate('/')");
    });

    it(`${name}: уход на / решается предикатом простого слоя`, () => {
      expect(code).toContain('hasSimpleView(location.pathname)');
    });

    it(`${name}: реестр напрямую больше не спрашивается`, () => {
      // Возврат `resolveSimpleRoute(...) === null` — это возврат дефекта:
      // сквозные пути снова начнут уводить на главную.
      expect(code).not.toContain('resolveSimpleRoute');
    });

    it(`${name}: предикат берётся из точки входа @/simple (#51)`, () => {
      // Импорт из `@/simple/routes` минует регистрацию неймспейса локалей,
      // и подпись кнопки выродилась бы в сырой ключ. Сторож двери —
      // `entryPoint.test.ts`, здесь сторожится сторона потребителя.
      expect(code).toMatch(/import \{[^}]*\bhasSimpleView\b[^}]*\} from '@\/simple';/);
      expect(code).not.toContain("from '@/simple/routes'");
    });
  }
});

describe('точка входа отдаёт наружу обе новые функции', () => {
  const entryCode = stripComments(entrySource);

  it('разбор удался — точка входа прочитана', () => {
    expect(entrySource.length).toBeGreaterThan(100);
    expect(entryCode).toContain("import './i18n';");
  });

  it('hasSimpleView экспортирован — его зовут обе шапки', () => {
    expect(entryCode).toMatch(/export function hasSimpleView\(/);
  });

  it('hasSimpleView складывает реестр СО сквозным списком', () => {
    // Главное свойство предиката, и потерять его легко: без слагаемого
    // `isPassthroughPath` он снова отвечает «простой версии нет» на всех
    // двенадцати сквозных путях, и переключение режима на `/profile` уводит на
    // главную — тот самый дефект, ради которого предикат и заведён.
    //
    // Разбор текстом: точку входа не импортировать (alias `@/` в тестах нет,
    // а за ней тянутся страницы). Поэтому проверяется тело функции, а не ответ.
    const body = entryCode.match(/export function hasSimpleView\([\s\S]*?\n\}/)?.[0];

    expect(body, 'тело hasSimpleView не разобрано').toBeTruthy();
    expect(body).toContain('resolveSimpleRoute(pathname)');
    expect(body).toContain('isPassthroughPath(pathname)');
  });

  it('useSimplePassthrough экспортирован — его зовёт шов', () => {
    expect(entryCode).toMatch(/export function useSimplePassthrough\(/);
  });
});
