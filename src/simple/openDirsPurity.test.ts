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
