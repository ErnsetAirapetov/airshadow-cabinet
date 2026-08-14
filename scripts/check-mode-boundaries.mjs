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
 *   1. `src/simple/**` наследует ЛОГИКУ (api, hooks, store, types, lib, platform)
 *      и примитивы, но не апстримную презентацию. Иначе апстрим тихо переделает
 *      нашу простую страницу при очередном синке: конфликта не будет, а страница
 *      перестанет быть простой. Молчаливый дрейф хуже конфликта — конфликт орёт.
 *   2. Апстримный код не знает о простом режиме вообще. Шов один — `src/App.tsx`.
 *
 * ⚠️ Сравниваем РАЗРЕШЁННЫЙ путь, а не текст импорта. Наивная проверка строки
 * запрещала бы простому режиму собственные подкаталоги `components/` и `pages/`:
 * импорт `./components/SimpleBottomNav` из `src/simple/SimpleShell.tsx` выглядит
 * как обращение к апстриму, хотя никуда за границу не выходит. Правило про
 * пересечение границы, а не про совпадение подстроки.
 *
 * Почему не grit-плагин biome, хотя прецедент в репе есть: biome отдаёт путь
 * файла с системным разделителем, и условие вида `includes "src/simple/"` на
 * Windows не совпадает никогда. Тот же баг живёт в апстримном
 * `telegram-webview-guards.grit` — его исключения для `src/platform/` на Windows
 * не работают. Здесь путь нормализуется явно.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SRC = 'src';
const SIMPLE_DIR = 'src/simple/';
const SEAM = 'src/App.tsx';
/** Совпадает с alias в vite.config.ts. */
const ALIAS = '@/';

/**
 * Апстримная ИНФРАСТРУКТУРА, которую простому режиму монтировать можно.
 *
 * Это не презентация: без `PromptDialogHost` общие хуки диалогов молча ничего не
 * показывают, без остальных теряются уведомления. Апстримный `AppShell` монтирует
 * их рядом с навигацией, и `SimpleShell`, заменяя его, обязан сделать то же —
 * иначе простой режим тихо лишается работающих механизмов.
 *
 * ⚠️ Именно список, а не дыра в правиле: добавление сюда — осознанное решение,
 * которое видно в дифе. Компоненты с видом сюда не попадают никогда.
 */
const INFRA_ALLOWLIST = new Set([
  'src/components/PromptDialogHost',
  'src/components/WebSocketNotifications',
  'src/components/CampaignBonusNotifier',
  'src/components/SuccessNotificationModal',
]);

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

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

/** Путь всегда через `/`, чтобы правила не зависели от системы. */
function posix(path) {
  return path.split(sep).join('/');
}

/**
 * Куда ведёт импорт внутри проекта. `null` — импорт наружу (пакет из
 * node_modules), такие нас не интересуют.
 */
function resolveSource(fromFile, source) {
  if (source.startsWith(ALIAS)) {
    return `${SRC}/${source.slice(ALIAS.length)}`;
  }
  if (source.startsWith('.')) {
    return posix(relative(process.cwd(), resolve(dirname(fromFile), source)));
  }
  return null;
}

const violations = [];

for (const file of walk(SRC)) {
  const path = posix(relative(process.cwd(), file));
  const inSimple = path.startsWith(SIMPLE_DIR);
  const isSeam = path === SEAM;
  const code = readFileSync(file, 'utf8');

  for (const source of sources(code)) {
    const target = resolveSource(file, source);
    if (target === null) {
      continue;
    }

    const targetInSimple = target.startsWith(SIMPLE_DIR);

    if (inSimple) {
      // Внутри своего дерева ходим куда угодно.
      if (targetInSimple) {
        continue;
      }
      if (target.startsWith('src/pages/')) {
        violations.push({
          path,
          source,
          why: 'простой режим не импортирует апстримные страницы (src/pages/**). Нужна логика — бери из api/hooks/store/types; нужен вид — собирай свой в src/simple/',
        });
      } else if (
        target.startsWith('src/components/') &&
        // Точное совпадение — это импорт index-файла примитивов, он же разрешён.
        target !== 'src/components/primitives' &&
        !target.startsWith('src/components/primitives/') &&
        !INFRA_ALLOWLIST.has(target)
      ) {
        violations.push({
          path,
          source,
          why: 'из апстримных компонентов простому режиму доступны только components/primitives — остальное апстрим переделает под себя; собери свой компонент в src/simple/components/',
        });
      }
    } else if (!isSeam && targetInSimple) {
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
