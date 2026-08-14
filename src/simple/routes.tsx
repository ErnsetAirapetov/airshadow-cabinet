import type { ReactNode } from 'react';
import { matchPath } from 'react-router';
import { useUiMode } from './mode';

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
 */
export type SimpleRoute = {
  path: string;
  element: ReactNode;
};

export const simpleRoutes: SimpleRoute[] = [
  // Страницы добавляются задачами милстоуна [M1-E05], по одной за раз.
  // Пустой реестр — рабочее состояние: режим переключается, подменять нечего,
  // весь кабинет отдаётся апстримными страницами.
];

export function resolveSimpleRoute(pathname: string): SimpleRoute | null {
  for (const route of simpleRoutes) {
    if (matchPath({ path: route.path, end: true }, pathname)) {
      return route;
    }
  }
  return null;
}

/**
 * Возвращает простую страницу для текущего пути или `null`, если её нет либо
 * пользователь в экспертном режиме.
 *
 * ⚠️ Вызывать ДО ранних возвратов вызывающего компонента: внутри есть хук.
 * И решение принимается ДО рендера — апстримная страница не должна отрисоваться,
 * чтобы через кадр быть заменённой.
 */
export function useSimpleOverride(pathname: string): ReactNode | null {
  const mode = useUiMode();

  if (mode !== 'simple') {
    return null;
  }

  return resolveSimpleRoute(pathname)?.element ?? null;
}
