import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа действий в шапке простого режима — десктопной и в ящике бургера
 * (задачи #42, #43, #47).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются. Компонентных тестов в проекте
 * не бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * шапки потянул бы весь граф приложения и упал бы на разрешении модулей.
 * Тот же приём, что в `src/simple/routes.test.tsx`; цена та же — разбор видит
 * только то, что записано литералом, поэтому у каждого сторожа ниже есть
 * парная проверка «разбор удался».
 *
 * Что охраняется по существу (#47): владелец потребовал шапку «один в один» с
 * апстримной, поэтому проверяются состав, ПОРЯДОК и вид кнопок, а язык с
 * колокольчиком обязаны браться из апстрима напрямую. Прежний сторож сверял
 * копию `src/simple/components/LanguageSwitcher.tsx` с оригиналом побайтово —
 * копии больше нет, сверять нечего, эти проверки убраны вместе с ней.
 */

const SIMPLE_SWITCHER = 'src/simple/components/LanguageSwitcher.tsx';
const SHELL = 'src/simple/components/layout/SimpleShell.tsx';
const HEADER = 'src/simple/components/layout/SimpleHeader.tsx';

/** Квадратная кнопка-иконка апстримной шапки — эталон вида всех действий. */
const SQUARE_BUTTON = 'rounded-xl border border-dark-700/50 bg-dark-800/50 p-2';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const shell = read(SHELL);
const header = read(HEADER);

describe('апстримные компоненты шапки берутся напрямую', () => {
  it('копии LanguageSwitcher в простом режиме нет', () => {
    // Требование #47 — один в один с апстримом. Копия давала бы расхождение при
    // синке; вместо неё компонент открыт поимённо в INFRA_ALLOWLIST гейта
    // `scripts/check-mode-boundaries.mjs`.
    expect(existsSync(SIMPLE_SWITCHER)).toBe(false);
  });

  it('гейт границ открывает ровно эти два компонента', () => {
    const gate = read('scripts/check-mode-boundaries.mjs');
    expect(gate).toContain('INFRA_ALLOWLIST');
    expect(gate).toContain("'src/components/TicketNotificationBell'");
    expect(gate).toContain("'src/components/LanguageSwitcher'");
  });
});

describe('правый блок действий десктопной шапки', () => {
  const rightActions = shell.split('justify-self-end')[1] ?? '';

  it('разбор SimpleShell удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(shell.length).toBeGreaterThan(1000);
    expect(shell).toContain('<MobileBottomNav');
    expect(rightActions.length).toBeGreaterThan(200);
  });

  it('язык и колокольчик — апстримные компоненты, а не копии', () => {
    expect(shell).toContain("from '@/components/LanguageSwitcher'");
    expect(shell).toContain("from '@/components/TicketNotificationBell'");
    expect(shell).not.toContain("from '../LanguageSwitcher'");
    expect(rightActions).toContain('<LanguageSwitcher />');
    expect(rightActions).toContain('<TicketNotificationBell');
  });

  it('тумблер темы переключает тему апстримным хуком', () => {
    expect(shell).toContain("from '@/hooks/useTheme'");
    expect(shell).toContain('toggleTheme');
    expect(rightActions).toContain('MoonIcon');
    expect(rightActions).toContain('SunIcon');
  });

  it('тумблер темы виден, только когда админ включил обе темы', () => {
    // Иначе пользователь жмёт кнопку, которая ничего не делает: useTheme
    // молча отказывается переключаться на выключенную тему.
    expect(shell).toContain('themeColorsApi.getEnabledThemes');
    expect(shell).toMatch(/enabledThemes\?\.dark && enabledThemes\?\.light/);
    expect(rightActions).toMatch(/!canToggleTheme && 'hidden'/);
  });

  it('кнопка режима — иконка Phosphor напрямую, без обёртки в components/icons', () => {
    expect(shell).toContain("from 'react-icons/pi'");
    expect(rightActions).toContain('<PiArrowsOutSimple');
    expect(shell).not.toContain('ChevronExpandIcon');
  });

  it('кнопка режима — квадратная иконка без подписи, как в апстримной шапке', () => {
    // #47: подпись «Все возможности» уехала в title/aria-label, вид кнопки
    // совпал с тумблером темы. Текстовый узел внутри кнопки — возврат к
    // забракованному варианту.
    expect(rightActions).toContain("title={tSimple('mode.toExpert')}");
    expect(rightActions).toContain("aria-label={tSimple('mode.toExpert')}");
    expect(rightActions).not.toMatch(/\/>\s*\{tSimple\('mode\.toExpert'\)\}/);
    expect(rightActions).toContain('<PiArrowsOutSimple className="h-5 w-5" />');
  });

  it('все действия — одинаковые квадратные кнопки апстримного вида', () => {
    // Три собственные кнопки блока (режим, тема, выход); язык и колокольчик
    // приезжают апстримными компонентами со своим оформлением.
    const squares = rightActions.split(SQUARE_BUTTON).length - 1;
    expect(squares).toBe(3);
    expect(rightActions).not.toContain('px-3 py-2 text-[13px]');
  });

  it('порядок как в апстримном AppShell: режим, тема, колокольчик, язык, выход', () => {
    const mode = rightActions.indexOf("setMode('expert')");
    const theme = rightActions.indexOf('toggleTheme()');
    const bell = rightActions.indexOf('<TicketNotificationBell');
    const lang = rightActions.indexOf('<LanguageSwitcher />');
    const logout = rightActions.indexOf('logout()');

    expect(mode).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(mode);
    expect(bell).toBeGreaterThan(theme);
    expect(lang).toBeGreaterThan(bell);
    expect(logout).toBeGreaterThan(lang);
  });
});

describe('ящик бургер-меню мобильной шапки простого режима (задачи #43, #47)', () => {
  // Ящик открывается блоком `mobileMenuOpen && (...)` — берём всё, что после
  // него, чтобы не спутать переключатели ящика с чем-то из шапки над ним.
  const drawer = header.split('{mobileMenuOpen && (')[1] ?? '';
  const mobileBar = header.split('{mobileMenuOpen && (')[0] ?? '';
  // Ряд действий внутри ящика — блок рядом с карточкой пользователя.
  const drawerActions =
    drawer.split('className="flex flex-shrink-0 items-center gap-2"')[1]?.split('</div>')[0] ?? '';

  it('разбор SimpleHeader удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(header.length).toBeGreaterThan(1000);
    expect(header).toContain('mobile-menu-content');
    expect(drawer.length).toBeGreaterThan(200);
    expect(mobileBar).toContain('aria-expanded={mobileMenuOpen}');
  });

  it('разбор ряда действий ящика удался', () => {
    expect(drawerActions.length).toBeGreaterThan(100);
  });

  it('язык и колокольчик — апстримные компоненты, а не копии', () => {
    expect(header).toContain("from '@/components/LanguageSwitcher'");
    expect(header).toContain("from '@/components/TicketNotificationBell'");
    expect(header).not.toContain("from '../LanguageSwitcher'");
    expect(drawerActions).toContain('<LanguageSwitcher />');
    expect(drawerActions).toContain('<TicketNotificationBell');
  });

  it('тумблер темы в ящике переключает тему апстримным хуком', () => {
    expect(header).toContain("from '@/hooks/useTheme'");
    expect(header).toContain('toggleTheme');
    expect(drawerActions).toContain('MoonIcon');
    expect(drawerActions).toContain('SunIcon');
  });

  it('тумблер темы в ящике виден, только когда админ включил обе темы', () => {
    expect(header).toContain('themeColorsApi.getEnabledThemes');
    expect(header).toMatch(/enabledThemes\?\.dark && enabledThemes\?\.light/);
    expect(drawerActions).toMatch(/!canToggleTheme && 'hidden'/);
  });

  it('порядок в ряду: тема, колокольчик, язык — язык крайний справа', () => {
    // #47, решение владельца: язык последним в ряду.
    const theme = drawerActions.indexOf('toggleTheme()');
    const bell = drawerActions.indexOf('<TicketNotificationBell');
    const lang = drawerActions.indexOf('<LanguageSwitcher />');

    expect(theme).toBeGreaterThan(-1);
    expect(bell).toBeGreaterThan(theme);
    expect(lang).toBeGreaterThan(bell);
  });

  it('мобильная шапка над ящиком остаётся пустой', () => {
    // Владельцу это нравится осознанно (#47): на мобилке в шапке только логотип
    // и бургер, все действия живут в ящике.
    expect(mobileBar).not.toContain('<LanguageSwitcher');
    expect(mobileBar).not.toContain('<TicketNotificationBell');
    expect(mobileBar).not.toContain('toggleTheme()');
  });

  it('пункт возврата в экспертный режим — иконка Phosphor напрямую, без обёртки в components/icons', () => {
    expect(header).toContain("from 'react-icons/pi'");
    expect(drawer).toContain('<PiArrowsOutSimple');
    expect(header).not.toContain('ChevronExpandIcon');
  });

  it('переход в экспертный режим остаётся отдельной строкой списка меню', () => {
    // Не иконкой в ряду действий: строка с подписью в бургере — решение #43,
    // задача #47 его не отменяла.
    expect(drawer).toMatch(/className="nav-item w-full"[\s\S]{0,200}<PiArrowsOutSimple/);
    expect(drawerActions).not.toContain('PiArrowsOutSimple');
  });
});
