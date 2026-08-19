import type { ComponentType } from 'react';
import { useUiMode } from '@/store/mode';
import { SimpleBalance } from './pages/Balance';
import { SimpleDashboard } from './pages/Dashboard';
import { SimpleSubscription } from './pages/Subscription';
import { SimpleSubscriptionPayment } from './pages/SubscriptionPayment';
import { SimpleSubscriptionPurchase } from './pages/SubscriptionPurchase';
import { SimpleSupport } from './pages/Support';
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
  { path: '/subscription/purchase', component: SimpleSubscriptionPurchase },
  // ⚠️ Адрес апстримного СПИСКА подписок отдан странице ПОДПИСКИ, и это решение
  // владельца (#60), а не промах. Пункт меню «Подписка» ведёт сюда; апстримный
  // список сам уходил с этого адреса на карточку — но только после ответа
  // сервера, и человек успевал увидеть мелькание экспертной оболочки. Простая
  // страница работает и без идентификатора: `getSubscription(undefined)` отдаёт
  // текущую подписку. Следствие принято: у кого подписок несколько, увидит одну
  // (канон, «одна подписка — одна карточка»).
  //
  // ⚠️ Литерал рядом с двумя записями-параметрами ниже. Сегодня он выиграл бы и
  // без ранжирования — стоит выше них в массиве, — но ранжирование в
  // `matchSimpleRoute` страхует от перестановки записей и от появления параметра
  // выше. Зонд по всем трём адресам стоит в `routes.test.tsx`.
  { path: '/subscriptions', component: SimpleSubscription },
  { path: '/subscriptions/:subscriptionId', component: SimpleSubscription },
  // ⚠️ Апстримный адрес продления отдан ЕДИНОМУ экрану оплаты (#69). Новых
  // маршрутов задача не заводит: меняется только то, что простой режим рисует
  // на этом адресе. Сюда ведут оба входа — «Продлить подписку» у активной и
  // кнопка оплаты у подписки с непродлеваемым статусом.
  { path: '/subscriptions/:subscriptionId/renew', component: SimpleSubscriptionPayment },
  // ⚠️ Литеральный путь без соседей: у `/support` в `App.tsx` нет ни дочерних
  // маршрутов, ни записей-параметров рядом, так что `UPSTREAM_LITERAL_PATHS`
  // этот адрес не касается. Переход из колокольчика `/support?ticket=<id>` —
  // тот же путь с хвостом query: в `location.pathname` хвост не входит, и
  // отдельная запись ему не нужна.
  { path: '/support', component: SimpleSupport },
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
