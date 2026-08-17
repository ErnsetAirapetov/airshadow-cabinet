import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сторож чистоты открытых каталогов (#37).
 *
 * docs/architecture/two-modes.md, «Открытые каталоги: primitives, ui, icons»:
 * простому режиму открыты ЦЕЛИКОМ три апстримных каталога —
 * `components/primitives`, `components/ui`, `components/icons` — а не
 * компоненты поимённо. Критерий один: в каталоге нет продуктовой семантики,
 * только форма и картинки. `scripts/check-mode-boundaries.mjs` сторожит
 * НАПРАВЛЕНИЕ импорта (простой режим не тянет закрытое), но не ЧИСТОТУ
 * открытого каталога — если апстрим положит в `components/ui` файл, который
 * тянет `@/api`, `@/store` или доменные типы `@/types`, тот гейт промолчит:
 * каталог-то открыт целиком. Через открытую дверь в простой режим молча
 * приедет продуктовая семантика апстрима — ровно то, от чего два режима и
 * защищают.
 *
 * Раньше критерий был проверен один раз руками (14.08.2026, см. историю #37) —
 * этот файл проверяет его на каждом запуске `npm test`.
 *
 * `components/primitives` включён в проверку наравне с `ui`/`icons`: канон
 * открывает все три каталога по одному и тому же критерию, риск для
 * `primitives` тот же (радикс-обёртки апстрим тоже может обрасти продуктовой
 * логикой), а цена включения — одна строка в списке ниже.
 *
 * Файлы разбираются ТЕКСТОМ (readFileSync), не импортируются: и `ui`, и
 * `primitives` тянут `framer-motion`, `@/hooks/*`, `@radix-ui/*` — импорт
 * потянул бы их рантайм-граф без всякой пользы для проверки. Тот же приём,
 * что в `scripts/check-mode-boundaries.mjs` и `src/store/expertModeToggle.test.ts`.
 */

const REPO_ROOT = resolve(__dirname, '../..');
const BOUNDARIES_SCRIPT = resolve(REPO_ROOT, 'scripts/check-mode-boundaries.mjs');

const OPEN_DIRS = ['src/components/ui', 'src/components/icons', 'src/components/primitives'];

/** Совпадает с alias в vite.config.ts. */
const ALIAS = '@/';

/**
 * Продуктовая семантика — доступ к бэкенду или доменным типам. Открытым
 * каталогам такое запрещено; форма и картинки этого не тянут никогда.
 */
const FORBIDDEN_PREFIXES = ['src/api', 'src/store', 'src/types'];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Комментарии выбрасываем до поиска импортов — докстринг вида «нельзя import
 * ../api/x» не должен уронить проверку. Тот же приём, что в
 * scripts/check-mode-boundaries.mjs. */
function stripComments(code: string): string {
  return code.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function importSources(rawCode: string): string[] {
  const code = stripComments(rawCode);
  const found: string[] = [];
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let match = re.exec(code);
    while (match !== null) {
      found.push(match[1]);
      match = re.exec(code);
    }
  }
  return found;
}

/** Путь всегда через `/`, чтобы правило не зависело от системы (Windows). */
function posix(path: string): string {
  return path.split(sep).join('/');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Куда ведёт импорт внутри проекта. `null` — импорт наружу (пакет из
 * node_modules), такие не проверяем.
 *
 * Ловит оба написания: alias `@/api/...` и относительное `../../api/...` —
 * файлы внутри апстримных каталогов ходят друг к другу и то, и другое.
 */
function resolveTarget(fromFile: string, source: string): string | null {
  if (source.startsWith(ALIAS)) {
    return `src/${source.slice(ALIAS.length)}`;
  }
  if (source.startsWith('.')) {
    return posix(relative(REPO_ROOT, resolve(dirname(fromFile), source)));
  }
  return null;
}

function isForbidden(target: string): boolean {
  return FORBIDDEN_PREFIXES.some((prefix) => target === prefix || target.startsWith(`${prefix}/`));
}

/** Строковые литералы в одинарных кавычках — из куска текста скрипта. */
function quoted(fragment: string): string[] {
  const re = /'([^']+)'/g;
  const found: string[] = [];
  let match = re.exec(fragment);
  while (match !== null) {
    found.push(match[1]);
    match = re.exec(fragment);
  }
  return found;
}

/** Каталоги из списка `OPEN_DIRS` гейта границ. */
function gateListedDirs(gateSource: string): string[] {
  const list = /const OPEN_DIRS = \[([\s\S]*?)\];/.exec(gateSource);
  return list === null ? [] : quoted(list[1]);
}

/**
 * Каталоги, открытые в гейте не списком, а отдельным условием: `primitives`
 * исключается парой `target !== 'src/components/primitives'` и
 * `!target.startsWith('src/components/primitives/')`. Ловим первую форму —
 * второй достаточно как парной.
 */
function gateConditionDirs(gateSource: string): string[] {
  const re = /target !== '(src\/components\/[^']+)'/g;
  const found: string[] = [];
  let match = re.exec(gateSource);
  while (match !== null) {
    found.push(match[1]);
    match = re.exec(gateSource);
  }
  return found;
}

/** Всё, что гейт границ пускает в простой режим ЦЕЛЫМ каталогом. */
function gateOpenDirs(gateSource: string): string[] {
  return [...new Set([...gateListedDirs(gateSource), ...gateConditionDirs(gateSource)])].sort();
}

/**
 * Сверка двух списков открытых каталогов (#51).
 *
 * Каталог открывает `scripts/check-mode-boundaries.mjs`, чистоту открытого
 * каталога проверяет `OPEN_DIRS` выше — и это два разных списка в двух файлах.
 * Причём в гейте список неполный: `components/ui` и `components/icons` лежат в
 * его `OPEN_DIRS`, а `components/primitives` открыт отдельными условиями рядом.
 * Пока сверки не было, четвёртый открытый каталог покрывался бы гейтом и НЕ
 * покрывался сторожом чистоты — молча, с зелёными проверками: продуктовая
 * семантика апстрима приехала бы в простой режим через новую открытую дверь,
 * за которой никто не смотрит.
 *
 * Гейт разбирается ТЕКСТОМ, а не импортируется: скрипт выполняет обход `src/**`
 * и `process.exit(1)` на верхнем уровне — импорт из теста запустил бы всю
 * проверку и уронил бы процесс vitest. Цена приёма та же, что у остальных
 * сторожей: разбор видит только литералы, поэтому ниже обязательна пара
 * «разбор удался».
 *
 * ⚠️ Граница покрытия — ровно две формы записи: литерал `const OPEN_DIRS = [...]`
 * и условие `target !== 'src/components/...'`. Каталог, открытый в гейте любой
 * третьей формой, разбор недосчитает С ОБЕИХ сторон — его не будет ни в составе
 * гейта, ни в `OPEN_DIRS` выше, — списки совпадут, и сверка останется ЗЕЛЁНОЙ
 * (проверено мутацией: `!target.startsWith('src/components/connection/')` в
 * цепочке условий гейта не роняет ни `check:modes`, ни этот файл). То есть
 * сверка ловит только случай, когда каталог попал хотя бы в один из двух
 * известных разбору источников — а это главный, ходовой путь: `OPEN_DIRS` гейта.
 * Вводите в гейт новую форму записи — расширяйте разбор здесь же, иначе новая
 * дверь останется без присмотра молча.
 */
describe('списки открытых каталогов: гейт границ и сторож чистоты — один состав', () => {
  const gateSource = existsSync(BOUNDARIES_SCRIPT) ? readFileSync(BOUNDARIES_SCRIPT, 'utf8') : '';

  it('разбор удался — скрипт гейта прочитан', () => {
    expect(gateSource.length, `не прочитан ${BOUNDARIES_SCRIPT}`).toBeGreaterThan(1000);
  });

  it('разбор удался — в тексте гейта найден список OPEN_DIRS', () => {
    expect(
      gateListedDirs(gateSource),
      'в гейте не разобран литерал `const OPEN_DIRS = [...]` — регулярка промахнулась',
    ).not.toEqual([]);
  });

  it('разбор удался — найдены каталоги, открытые отдельным условием', () => {
    expect(
      gateConditionDirs(gateSource),
      "в гейте не найдено ни одного `target !== 'src/components/...'` — так открыт primitives",
    ).not.toEqual([]);
  });

  it('состав совпадает ровно', () => {
    expect(
      gateOpenDirs(gateSource),
      'состав открытых каталогов в scripts/check-mode-boundaries.mjs и в OPEN_DIRS этого ' +
        'файла разошёлся. Каталог, открытый гейтом, обязан проверяться на чистоту — ' +
        'иначе апстрим положит в него продуктовый компонент, и обе проверки промолчат. ' +
        'Канон: docs/architecture/two-modes.md, «Открытые каталоги: primitives, ui, icons».',
    ).toEqual([...OPEN_DIRS].sort());
  });
});

describe('чистота открытых каталогов: components/ui, components/icons, components/primitives', () => {
  describe.each(OPEN_DIRS)('%s — разбор удался', (dir) => {
    const absDir = resolve(REPO_ROOT, dir);

    // Без этой пары сломанный путь или переименованный каталог дают вечно
    // зелёный сторож, который ничего не охраняет: it.each ниже просто не
    // построил бы ни одного теста.
    it('каталог существует', () => {
      expect(existsSync(absDir) && statSync(absDir).isDirectory(), `нет каталога ${dir}`).toBe(
        true,
      );
    });

    it('содержит хотя бы один .ts/.tsx файл', () => {
      const count = existsSync(absDir) ? walk(absDir).length : 0;
      expect(count, `в ${dir} не нашлось ни одного .ts/.tsx файла`).toBeGreaterThan(0);
    });
  });

  for (const dir of OPEN_DIRS) {
    const absDir = resolve(REPO_ROOT, dir);
    const files = existsSync(absDir) ? walk(absDir) : [];

    it.each(
      files.map((file) => [posix(relative(REPO_ROOT, file)), file] as const),
    )('%s: импорты не тянут api/store/types', (relPath, file) => {
      const violations = importSources(readFileSync(file, 'utf8'))
        .map((source) => ({ source, target: resolveTarget(file, source) }))
        .filter((entry): entry is { source: string; target: string } => entry.target !== null)
        .filter((entry) => isForbidden(entry.target));

      expect(
        violations.map((v) => v.source),
        `${relPath} импортирует продуктовую семантику (${violations
          .map((v) => v.source)
          .join(', ')}). Открытый каталог (docs/architecture/two-modes.md, ` +
          `«Открытые каталоги: primitives, ui, icons») пускает только форму и ` +
          `картинки — компонент с бэкенд- или доменной логикой сюда не кладут. ` +
          `Копируй его в src/simple/ и упрощай там, а не открывай поимённо.`,
      ).toEqual([]);
    });
  }
});
