import type { ComponentType } from 'react';
import { useUiMode } from '@/store/mode';
import { SimpleBalance } from './pages/Balance';
import { SimpleDashboard } from './pages/Dashboard';
import { SimpleTopUpAmount } from './pages/TopUpAmount';
import { SimpleTopUpMethodSelect } from './pages/TopUpMethodSelect';
import { matchSimpleRoute, type SimpleRoute } from './routeMatch';

export type { SimpleRoute } from './routeMatch';

/**
 * Реестр простых страниц.
 *
 * ⚠️ Путь совпадает с апстримным маршрутом — URL-простор у режимов ОБЩИЙ.
 * `/subscriptions` остаётся `/subscriptions` в обоих режимах, просто рендерится
 * другой страницей. Из этого бесплатно следует: ссылка от саппорта работает у
 * любого пользователя, а страница без простой версии открывается апстримной —
 * то есть «спрятано из меню, но доступно по прямой ссылке» получается само,
 * без списка исключений.
 *
 * Новых путей не заводим. Если тянет добавить `/simple/...` — стоп, это
 * нарушение архитектуры, см. docs/architecture/two-modes.md.
 *
 * Храним КОМПОНЕНТ, а не готовый элемент: элемент, созданный на уровне модуля,
 * имеет постоянную референсную идентичность, из-за чего React бейлаутит поддерево
 * и странице нельзя передать ни ключ, ни собственный boundary.
 *
 * ⚠️ Страницы импортируются СТАТИЧЕСКИ: простой слой держим в основном бандле,
 * `lazy(() => import(...))` здесь запрещён — иначе на каждой навигации мелькает
 * заглушка загрузчика (третье правило против мерцания в каноне).
 */
export const simpleRoutes: SimpleRoute[] = [
  // ⚠️ Путь пишется БУКВА В БУКВУ как в App.tsx: сторож покрытия сравнивает
  // строки, а у апстрима параметры зовутся `:subscriptionId`, `:methodId`,
  // `:slug`. Запись `/subscriptions/:id` уронит npm test, хотя в рантайме
  // matchPath сработала бы.
  //
  // ⚠️ Путь пишется строковым литералом в одну строку: сторож в
  // `routes.test.tsx` читает этот файл текстом (импортировать реестр он не
  // может — вместе с ним подтянулись бы страницы и весь граф приложения).
  // Собранный из переменной путь сторож не увидит.
  //
  // Страницы добавляются задачами милстоуна [M1-E05], по одной за раз. Пути,
  // которых здесь нет, отдаются апстримными страницами.
  { path: '/', component: SimpleDashboard },
  { path: '/balance', component: SimpleBalance },
  // ⚠️ Литерал рядом с параметром ниже — и это работает только потому, что
  // `matchSimpleRoute` ранжирует литералы выше параметров. Порядок записей в
  // реестре на исход не влияет, но соседей по `App.tsx` при заведении такой пары
  // проверять обязательно: `/balance/top-up/result` от параметра ниже спасает
  // список `UPSTREAM_LITERAL_PATHS` в `routeMatch.ts` (дефект #53).
  { path: '/balance/top-up', component: SimpleTopUpMethodSelect },
  { path: '/balance/top-up/:methodId', component: SimpleTopUpAmount },
];

export function resolveSimpleRoute(pathname: string): SimpleRoute | null {
  return matchSimpleRoute(simpleRoutes, pathname);
}

/**
 * ⚠️ Шов подмены живёт в `ProtectedRoute`, поэтому покрывает ТОЛЬКО маршруты
 * под ним. Мимо идут публичные (`/offer`, `/privacy`, `/verify-email`,
 * `/buy/success/:token`, `/coupon/:token`) и админские (у них свой `AdminRoute`).
 *
 * Запись такого пути в реестр не даст ни ошибки сборки, ни исключения — она
 * просто не сработает. Молчаливый промах в фундаменте недопустим, поэтому за
 * этим следит тест `routes.test.tsx`: он сверяет реестр с маршрутами `App.tsx`
 * и падает в `npm test`.
 *
 * Сторожем сделан именно тест, а не предупреждение в консоли: CLAUDE.md
 * объявляет dev-окружение непригодным («проверяем только сборкой»), а
 * `build:docker` собирает с `DEV=false` — предупреждение жило бы там, куда
 * никто не заходит, и стоило бы проду лишних ре-рендеров корня на каждой
 * навигации.
 *
 * Что делать, когда простому режиму реально понадобится публичная страница, —
 * см. docs/architecture/two-modes.md.
 */

/**
 * Возвращает компонент простой страницы для текущего пути или `null`, если её
 * нет либо пользователь в экспертном режиме.
 *
 * ⚠️ Вызывать ДО ранних возвратов вызывающего компонента: внутри есть хук.
 * И решение принимается ДО рендера — апстримная страница не должна отрисоваться,
 * чтобы через кадр быть заменённой.
 */
export function useSimpleOverride(pathname: string): ComponentType | null {
  const mode = useUiMode();

  if (mode !== 'simple') {
    return null;
  }

  return resolveSimpleRoute(pathname)?.component ?? null;
}
