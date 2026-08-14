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
