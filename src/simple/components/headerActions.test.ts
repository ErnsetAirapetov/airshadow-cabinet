import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа правого блока действий десктопной шапки простого режима (задача #42).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются. Компонентных тестов в проекте
 * не бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * шапки потянул бы весь граф приложения и упал бы на разрешении модулей.
 * Тот же приём, что в `src/simple/routes.test.tsx`; цена та же — разбор видит
 * только то, что записано литералом, поэтому у каждого сторожа ниже есть
 * парная проверка «разбор удался».
 */

const UPSTREAM_SWITCHER = 'src/components/LanguageSwitcher.tsx';
const SIMPLE_SWITCHER = 'src/simple/components/LanguageSwitcher.tsx';
const SHELL = 'src/simple/components/layout/SimpleShell.tsx';
const HEADER = 'src/simple/components/layout/SimpleHeader.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/**
 * Докстринги в копии свои, логика — апстримная: блочные комментарии
 * выбрасываем, а вместе с ними пустые строки, оставшиеся на их месте.
 */
function withoutBlockComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join('\n');
}

const upstreamSwitcher = read(UPSTREAM_SWITCHER);
const simpleSwitcher = read(SIMPLE_SWITCHER);
const shell = read(SHELL);
const header = read(HEADER);

describe('копия LanguageSwitcher в простом режиме', () => {
  it('разбор апстримного оригинала удался — иначе сторож сверял бы пустоту', () => {
    // Без этой проверки исчезнувший или переименованный апстримный файл дал бы
    // пустую строку, и сравнение ниже сравнивало бы пустоту с пустотой.
    expect(upstreamSwitcher.length).toBeGreaterThan(500);
    expect(upstreamSwitcher).toContain('infoApi.getLanguages');
  });

  it('копия существует — прямой импорт апстримного компонента запрещён границами', () => {
    // `src/components/LanguageSwitcher.tsx` лежит вне открытых каталогов
    // (primitives, ui, icons), поэтому импорт из `src/simple/**` уронил бы
    // `npm run check:modes`. Канон предписывает копию.
    expect(existsSync(SIMPLE_SWITCHER)).toBe(true);
  });

  it('копия помечена номером задачи — иначе через год непонятно, откуда она', () => {
    expect(simpleSwitcher).toContain('#42');
  });

  it('копия показывает полный список языков аккаунта, а не зашитый ru/en', () => {
    // Решение владельца от 14.08.2026: переключатель целиком, со всеми языками
    // аккаунта. Отсечка списка здесь была бы отменой этого решения.
    expect(simpleSwitcher).toContain('infoApi.getLanguages');
    expect(simpleSwitcher).toMatch(/availableLanguages\.map/);
    expect(simpleSwitcher).not.toMatch(/\.filter\(/);
  });

  it('логика копии совпадает с апстримной побайтово, кроме докстринга', () => {
    // Сторож против молчаливого расхождения: апстрим может поменять оригинал, и
    // сборка останется зелёной, а переключатель в простом режиме — вчерашним.
    expect(withoutBlockComments(simpleSwitcher)).toBe(withoutBlockComments(upstreamSwitcher));
  });
});

describe('правый блок действий десктопной шапки', () => {
  const rightActions = shell.split('justify-self-end')[1] ?? '';

  it('разбор SimpleShell удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(shell.length).toBeGreaterThan(1000);
    expect(shell).toContain('<MobileBottomNav');
    expect(rightActions.length).toBeGreaterThan(200);
  });

  it('в шапке есть переключатель языка — своя копия, не апстримная', () => {
    // Относительный путь, а не `@/components/LanguageSwitcher`: апстримный
    // компонент за границей, и его импорт уронил бы `npm run check:modes`.
    expect(shell).toContain("from '../LanguageSwitcher'");
    expect(shell).not.toContain("from '@/components/LanguageSwitcher'");
    expect(rightActions).toContain('<LanguageSwitcher />');
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

  it('порядок действий: язык, тема, режим', () => {
    const lang = rightActions.indexOf('<LanguageSwitcher />');
    const theme = rightActions.indexOf('toggleTheme()');
    const mode = rightActions.indexOf("setMode('expert')");

    expect(lang).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(lang);
    expect(mode).toBeGreaterThan(theme);
  });
});

describe('ящик бургер-меню мобильной шапки простого режима (задача #43)', () => {
  // Ящик открывается блоком `mobileMenuOpen && (...)` — берём всё, что после
  // него, чтобы не спутать переключатели ящика с чем-то из шапки над ним.
  const drawer = header.split('{mobileMenuOpen && (')[1] ?? '';

  it('разбор SimpleHeader удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(header.length).toBeGreaterThan(1000);
    expect(header).toContain('mobile-menu-content');
    expect(drawer.length).toBeGreaterThan(200);
  });

  it('в ящике есть переключатель языка — своя копия, не апстримная', () => {
    expect(header).toContain("from '../LanguageSwitcher'");
    expect(header).not.toContain("from '@/components/LanguageSwitcher'");
    expect(drawer).toContain('<LanguageSwitcher />');
  });

  it('тумблер темы в ящике переключает тему апстримным хуком', () => {
    expect(header).toContain("from '@/hooks/useTheme'");
    expect(header).toContain('toggleTheme');
    expect(drawer).toContain('MoonIcon');
    expect(drawer).toContain('SunIcon');
  });

  it('тумблер темы в ящике виден, только когда админ включил обе темы', () => {
    expect(header).toContain('themeColorsApi.getEnabledThemes');
    expect(header).toMatch(/enabledThemes\?\.dark && enabledThemes\?\.light/);
    expect(drawer).toMatch(/!canToggleTheme && 'hidden'/);
  });

  it('пункт возврата в экспертный режим — иконка Phosphor напрямую, без обёртки в components/icons', () => {
    expect(header).toContain("from 'react-icons/pi'");
    expect(drawer).toContain('<PiArrowsOutSimple');
    expect(header).not.toContain('ChevronExpandIcon');
  });
});
