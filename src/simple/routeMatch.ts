import type { ComponentType } from 'react';
import { matchPath } from 'react-router';

/**
 * Сопоставление пути с реестром простых страниц — БЕЗ самого реестра.
 *
 * Вынесено из `routes.tsx` ради тестов: реестр статически импортирует страницы
 * (ленивая загрузка простому слою запрещена, docs/architecture/two-modes.md), а
 * страницы тянут за собой api, store и platform. Все они ходят через alias `@/`,
 * которого в `vitest.config.ts` нет — конфиг апстримный, и трогать его нельзя,
 * иначе появится ещё один конфликтный файл при синке. Импорт реестра в тесте
 * поэтому падает на разрешении модулей, а импорт этого файла — нет.
 *
 * Здесь только react-router и типы: держим файл свободным от приложения.
 */
export type SimpleRoute = {
  path: string;
  component: ComponentType;
};

/**
 * Апстримные маршруты, которые записи реестра с параметром накрывают собой.
 *
 * ⚠️ Для `matchPath` литеральный сегмент — такой же сегмент, как параметр:
 * `/balance/top-up/:methodId` совпадает с `/balance/top-up/result` ничуть не хуже,
 * чем с `/balance/top-up/platega`. Апстримный роутер такой спор решает сам (у
 * `<Routes>` есть ранжирование по специфичности), но шов подмены живёт внутри
 * `ProtectedRoute` и выбирает страницу по `location.pathname`, а не по выигравшему
 * `<Route>` — до ранжирования роутера дело не доходит.
 *
 * Что это стоило бы без списка: человек возвращается от провайдера на
 * `/balance/top-up/result`, шов подставляет простой экран суммы, метода с id
 * `result` в списке нет — и заплативший видит выбор способа оплаты, будто платёж
 * не прошёл. Статус платежа при этом не опрашивается вообще.
 *
 * Список ведётся руками, и это осознанно: `App.tsx` в рантайме не прочитать.
 * Забыть пополнить его нельзя — за составом следит `routes.test.tsx`, который
 * разбирает `App.tsx` и требует, чтобы ни один статический маршрут под швом не
 * доставался записи реестра с другим путём.
 *
 * Запретом навсегда список не является: литеральная запись реестра сильнее (см.
 * порядок проходов ниже), так что свой экран результата оплаты простой режим
 * когда-нибудь получит обычным добавлением пути.
 */
export const UPSTREAM_LITERAL_PATHS = ['/balance/top-up/result'];

function isLiteral(path: string): boolean {
  return !path.includes(':');
}

function hits(path: string, pathname: string): boolean {
  return matchPath({ path, end: true }, pathname) !== null;
}

/**
 * Чистая часть подмены — проверяется тестом без реестра.
 *
 * Ранжирование: литерал специфичнее параметра, поэтому проходов три —
 * литералы реестра, литералы апстрима (они означают «подмены нет»), и только
 * потом записи с параметрами. Порядок записей внутри прохода сохраняется.
 */
export function matchSimpleRoute(routes: SimpleRoute[], pathname: string): SimpleRoute | null {
  for (const route of routes) {
    if (isLiteral(route.path) && hits(route.path, pathname)) {
      return route;
    }
  }

  if (UPSTREAM_LITERAL_PATHS.some((path) => hits(path, pathname))) {
    return null;
  }

  for (const route of routes) {
    if (!isLiteral(route.path) && hits(route.path, pathname)) {
      return route;
    }
  }

  return null;
}
