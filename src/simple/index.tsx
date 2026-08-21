/**
 * Единственная точка входа простого режима для апстримного кода.
 *
 * `App.tsx` импортирует только отсюда — чтобы диф в нём остался в пределах
 * нескольких строк и не рос при каждой новой простой странице. Через эту же
 * дверь ходят швы в апстримных шапках (`AppShell.tsx`, `AppHeader.tsx`): им
 * нужен `resolveSimpleRoute`, и он реэкспортирован ниже.
 *
 * Побочный эффект импорта: регистрация неймспейса локалей (`./i18n`).
 *
 * ⚠️ Именно поэтому реэкспорт, а не импорт реестра напрямую (#51). Шапки
 * подписывают кнопку ключом нашего неймспейса; пока они импортировали
 * `@/simple/routes`, регистрация держалась на посторонней строке — импорте
 * `./simple` в `App.tsx`. Переехал бы тот импорт — подпись выродилась бы в сырой
 * ключ, молча. Сторож двери: `src/simple/entryPoint.test.ts`.
 */
import './i18n';
import { useUiMode } from '@/store/mode';
import { isPassthroughPath, shouldPassthrough } from './passthrough';
import { resolveSimpleRoute } from './routes';

export { useUiMode, useModeStore, type UiMode } from '@/store/mode';
export { resolveSimpleRoute, useSimpleOverride } from './routes';
export { isPassthroughPath, PASSTHROUGH_PATHS } from './passthrough';
export { SimpleShell } from './components/layout/SimpleShell';

/**
 * Есть ли у пути простая версия — в любом из двух смыслов.
 *
 * Простых версий два вида, и швам в шапках важны оба: своя страница в реестре
 * (`routes.tsx`) и апстримная страница в простой оболочке (сквозной список,
 * `passthrough.ts`). Переключатель режима виден в обоих режимах и на пути без
 * простой версии уводит на `/` (#45); спрашивай он только реестр, переключение
 * на `/profile` выбрасывало бы человека на главную, хотя простая оболочка там
 * теперь есть.
 *
 * ⚠️ Предикат ОДИН на обе шапки и живёт в точке входа: два независимых ответа
 * на один вопрос разъехались бы молча. Режима не спрашивает намеренно —
 * шапка зовёт его сразу после `setMode('simple')`, когда store ещё отдаёт
 * прежний режим, и ответ «да/нет» здесь про путь, а не про состояние.
 */
export function hasSimpleView(pathname: string): boolean {
  return resolveSimpleRoute(pathname) !== null || isPassthroughPath(pathname);
}

/**
 * Нужна ли апстримной странице простая оболочка — вопрос шва `ProtectedRoute`.
 *
 * ⚠️ Вызывать ДО ранних возвратов вызывающего компонента: внутри есть хук.
 * Режим спрашивается так же, как в `useSimpleOverride`: в экспертном режиме
 * сквозной список не действует вовсе, и каждый его путь ведёт себя ровно как до
 * #64 — апстримная страница в апстримной оболочке.
 */
export function useSimplePassthrough(pathname: string): boolean {
  const mode = useUiMode();

  return shouldPassthrough(mode, pathname);
}
