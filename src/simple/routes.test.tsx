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
  it('боевой реестр подменяет главную', () => {
    // Сторож состава. Раньше здесь стояло ожидание пустого реестра — каркас не
    // подменял ничего; первая простая страница (задача #27) его уронила, как и
    // было задумано. Дальше список растёт задачами милстоуна [M1-E05], и каждая
    // новая страница обязана появиться здесь осознанно.
    expect(registeredPaths).toEqual(['/']);
  });

  it('пути в реестре не повторяются', () => {
    // Дубль пути не сломал бы ничего заметно: сработала бы первая запись, а
    // вторая молча не рендерилась бы никогда.
    expect(registeredPaths).toHaveLength(new Set(registeredPaths).size);
  });
});

/**
 * Шов подмены живёт в `ProtectedRoute`. Путь, который идёт мимо него —
 * публичный или админский, — молча не подменится: ни ошибки сборки, ни
 * исключения. Этот сторож ловит такую запись в `npm test`.
 */
describe('покрытие шва', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');

  /** Пути, чей `<Route>` содержит `<ProtectedRoute>` — то есть покрытые швом. */
  const protectedPaths = new Set<string>();
  for (const chunk of appSource.split('<Route').slice(1)) {
    const path = chunk.match(/path="([^"]+)"/)?.[1];
    if (path && chunk.includes('<ProtectedRoute')) {
      protectedPaths.add(path);
    }
  }

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
