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

/** Чистая часть подмены — проверяется тестом без реестра. */
export function matchSimpleRoute(routes: SimpleRoute[], pathname: string): SimpleRoute | null {
  for (const route of routes) {
    if (matchPath({ path: route.path, end: true }, pathname)) {
      return route;
    }
  }
  return null;
}
