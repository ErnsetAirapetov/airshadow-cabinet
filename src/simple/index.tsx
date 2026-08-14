/**
 * Единственная точка входа простого режима для апстримного кода.
 *
 * `App.tsx` импортирует только отсюда — чтобы диф в нём остался в пределах
 * нескольких строк и не рос при каждой новой простой странице.
 *
 * Побочный эффект импорта: регистрация неймспейса локалей (`./i18n`).
 */
import './i18n';

export { ModeAffordance } from './ModeAffordance';
export { useUiMode, useModeStore, type UiMode } from '@/store/mode';
export { useSimpleOverride } from './routes';
export { SimpleShell } from './components/layout/SimpleShell';
