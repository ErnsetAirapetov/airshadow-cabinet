import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchSimpleRoute, simpleRoutes, type SimpleRoute } from './routes';

const Stub = () => null;

const routes: SimpleRoute[] = [
  { path: '/', component: Stub },
  { path: '/subscriptions', component: Stub },
  { path: '/subscriptions/:id', component: Stub },
];

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

  it('боевой реестр пуст: каркас ещё не подменяет страниц', () => {
    // Тест-сторож. Когда появится первая простая страница, он упадёт и заставит
    // осознанно обновить ожидание, а не забыть про него.
    expect(simpleRoutes).toHaveLength(0);
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

  it('каждый путь реестра ведёт на маршрут под ProtectedRoute', () => {
    const uncovered = simpleRoutes
      .map((route) => route.path)
      .filter((path) => !protectedPaths.has(path));

    // Пусто — значит ни одна простая страница не зарегистрирована в никуда.
    expect(uncovered).toEqual([]);
  });
});
