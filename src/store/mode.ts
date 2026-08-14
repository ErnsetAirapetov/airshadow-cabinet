import { create } from 'zustand';

/**
 * Режим интерфейса. В коде — `simple` / `expert`, в интерфейсе режимы не
 * называем: пользователь видит только пункт-переключатель («Все возможности» /
 * «Упрощённый вид»). Канон — docs/architecture/two-modes.md.
 */
export type UiMode = 'simple' | 'expert';

const STORAGE_KEY = 'cabinet_ui_mode';

/**
 * ⚠️ Читаем СИНХРОННО, на этапе создания стора — то есть до первой отрисовки.
 *
 * Соблазн сделать это в `useEffect` заканчивается кадром экспертной страницы,
 * который потом подменяется простой: та же вспышка светлой темы при тёмной.
 * `localStorage` синхронный, поэтому и middleware `persist` здесь не нужен —
 * явное чтение проще проверить глазами, чем семантику гидратации.
 *
 * Всё в try/catch: в приватном режиме и внутри некоторых webview обращение к
 * localStorage бросает исключение, и падать из-за настройки вида нельзя.
 */
export function readStoredMode(): UiMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'expert' ? 'expert' : 'simple';
  } catch {
    // localStorage недоступен — остаёмся на дефолте
    return 'simple';
  }
}

type ModeState = {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
  toggleMode: () => void;
};

export const useModeStore = create<ModeState>((set, get) => ({
  mode: readStoredMode(),
  setMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // не сохранилось — режим всё равно применяем на текущую сессию
    }
    set({ mode });
  },
  toggleMode: () => {
    get().setMode(get().mode === 'simple' ? 'expert' : 'simple');
  },
}));

export const useUiMode = () => useModeStore((state) => state.mode);
