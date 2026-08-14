#!/usr/bin/env node
/**
 * Границы двух режимов кабинета — docs/architecture/two-modes.md.
 *
 * Правило в документе игнорируют, красную сборку — нет. Поэтому проверка висит
 * первой в `npm run build`: нарушение границы ломает сборку, а не остаётся
 * замечанием в ревью.
 *
 * Что охраняем:
 *
 *   1. `src/simple/**` наследует ЛОГИКУ (api, hooks, store, types) и примитивы,
 *      но не апстримную презентацию. Иначе апстрим тихо переделает нашу простую
 *      страницу при очередном синке: конфликта не будет, а страница перестанет
 *      быть простой. Молчаливый дрейф хуже конфликта — конфликт хотя бы орёт.
 *   2. Апстримный код не знает о простом режиме вообще. Шов один — `src/App.tsx`.
 *
 * Почему не grit-плагин biome, хотя прецедент в репе есть: biome отдаёт путь
 * файла с системным разделителем, и условие вида `includes "src/simple/"` на
 * Windows не совпадает никогда. Тот же баг живёт в апстримном
 * `telegram-webview-guards.grit` — его исключения для `src/platform/` на Windows
 * не работают. Здесь путь нормализуется явно.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = 'src';
const SIMPLE_DIR = `${SRC}/simple/`;
const SEAM = `${SRC}/App.tsx`;

/** Оба вида кавычек, `import ... from '...'` и `export ... from '...'`. */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
/** Отдельно: `import './side-effect'` без from. */
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function walk(dir, out = []) {
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

function sources(code) {
  const found = [];
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let match = re.exec(code);
    while (match !== null) {
      found.push(match[1]);
      match = re.exec(code);
    }
  }
  return found;
}

/** Путь всегда через `/`, чтобы правила не зависели от системы. */
function posix(path) {
  return relative(process.cwd(), path).split(sep).join('/');
}

const violations = [];

for (const file of walk(SRC)) {
  const path = posix(file);
  const inSimple = path.startsWith(SIMPLE_DIR);
  const isSeam = path === SEAM;
  const code = readFileSync(file, 'utf8');

  for (const source of sources(code)) {
    if (inSimple) {
      if (/(^|\/)pages\//.test(source)) {
        violations.push({
          path,
          source,
          why: 'простой режим не импортирует апстримные страницы (src/pages/**). Нужна логика — бери из api/hooks/store/types; нужен вид — собирай свой в src/simple/',
        });
      } else if (/(^|\/)components\//.test(source) && !source.includes('components/primitives')) {
        violations.push({
          path,
          source,
          why: 'из апстримных компонентов простому режиму доступны только components/primitives — остальное апстрим переделает под себя; собери свой компонент в src/simple/components/',
        });
      }
    } else if (!isSeam && /(^|\/)simple(\/|$)/.test(source)) {
      violations.push({
        path,
        source,
        why: `апстримный код не должен знать о простом режиме; шов один — ${SEAM}`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`\nГраницы двух режимов нарушены (${violations.length}):\n`);
  for (const v of violations) {
    console.error(`  ${v.path}`);
    console.error(`    импорт: ${v.source}`);
    console.error(`    ${v.why}\n`);
  }
  console.error('Канон: docs/architecture/two-modes.md\n');
  process.exit(1);
}

console.log('Границы двух режимов соблюдены.');
