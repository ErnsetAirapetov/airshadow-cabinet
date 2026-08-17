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
 *   2. Апстримный код не знает о простом режиме вообще. Швы перечислены поимённо
 *      в `SEAMS` — их три, и все три файла уже числятся нашими в каноне.
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
/**
 * Апстримные файлы, которым знать о простом режиме разрешено.
 *
 * Критерий тот же, что у `INFRA_ALLOWLIST`: попасть сюда можно только осознанным
 * решением, видным в дифе, и только файлу, которым мы и так владеем — то есть
 * тому, что перечислен в каноне («Что остаётся нашим в апстримных файлах»).
 *
 *   - `src/App.tsx` — слой подмены страниц.
 *   - шапки `AppShell.tsx` / `AppHeader.tsx` (#45) — переключатель режима виден
 *     всегда, и на пути без простой страницы он обязан увести на `/`. Ответ на
 *     вопрос «есть ли простая версия» даёт `resolveSimpleRoute` из реестра. Свой
 *     матчинг путей в шапке был бы вторым источником истины и разъехался бы с
 *     реестром молча — цена дороже записи в этом списке.
 *
 * Критерий выхода симметричен: перестал файл быть нашим — уходит и отсюда.
 */
const SEAMS = new Set([
  'src/App.tsx',
  'src/components/layout/AppShell/AppShell.tsx',
  'src/components/layout/AppShell/AppHeader.tsx',
]);
/** Совпадает с alias в vite.config.ts. */
const ALIAS = '@/';

/**
 * Апстримные компоненты, открытые простому режиму ПОИМЁННО.
 *
 * Два основания попасть сюда, и других нет:
 *
 *   1. **Инфраструктура.** Это не презентация: без `PromptDialogHost` общие хуки
 *      диалогов молча ничего не показывают, без остальных теряются уведомления.
 *      Апстримный `AppShell` монтирует их рядом с навигацией, и `SimpleShell`,
 *      заменяя его, обязан сделать то же — иначе простой режим тихо лишается
 *      работающих механизмов.
 *   2. **Элемент шапки, который простой режим показывает БЕЗ ИЗМЕНЕНИЙ** —
 *      колокольчик и переключатель языка (#47). Требование владельца тут
 *      дословное: шапка простого режима «один в один» с апстримной. Пикселями
 *      этих двух мы владеть не хотим, а копия в `src/simple/` при таком
 *      требовании даёт ровно две вещи — расхождение при синке и лишнего
 *      сторожа, который его ловит. Критерий выхода из списка симметричен:
 *      захотим перерисовать компонент — он уезжает копией в `src/simple/`, а
 *      отсюда убирается. Промежуточного состояния «копия и запись» не бывает.
 *
 * ⚠️ Именно список, а не дыра в правиле: добавление сюда — осознанное решение,
 * которое видно в дифе. Компонент, который простой режим рисует по-своему, сюда
 * не попадает никогда.
 */
/**
 * Апстримные каталоги БЕЗ продуктовой семантики — простому режиму открыты
 * целиком, как `components/primitives`.
 *
 * Проверено по импортам (14.08.2026): `components/ui/**` тянет только react,
 * framer-motion, simplex-noise, `@/lib/utils`, `@/hooks/useAnimationLoop` и
 * `@/platform`; `components/icons/**` — только `react-icons` и `cn`. Ни api, ни
 * store, ни доменных типов: это библиотеки формы и картинок, а не интерфейс
 * экспертного режима. Держать свою копию каждой иконки значило бы разъехаться
 * с апстримом в мелочах ради нулевой выгоды — тот же довод, по которому общими
 * сделаны примитивы.
 *
 * ⚠️ Продуктовые компоненты сюда не попадают, даже если лежат в тех же папках
 * рядом: `components/stats/StatCard` скопирован в `src/simple/`, потому что его
 * соседи по каталогу (`DailyChart`, `PeriodComparison`) — уже интерфейс.
 */
const OPEN_DIRS = ['src/components/ui', 'src/components/icons'];

const INFRA_ALLOWLIST = new Set([
  'src/components/PromptDialogHost',
  'src/components/WebSocketNotifications',
  'src/components/CampaignBonusNotifier',
  'src/components/SuccessNotificationModal',
  // BackgroundHost рендерит фон, только пока есть хоть один потребитель, а
  // регистрирует потребителя единственный вызов useBackgroundConsumer() — из
  // AppShell. Без него простой режим остался бы на голом фоне, что выглядит
  // как сломанная страница, а не как упрощение.
  'src/components/backgrounds/BackgroundHost',
  // Элементы шапки, показываемые без изменений (#47) — основание 2 выше.
  'src/components/TicketNotificationBell',
  'src/components/LanguageSwitcher',
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

/**
 * Комментарии выбрасываем до поиска импортов.
 *
 * Иначе фраза «так делать нельзя: import('../pages/X')» в докстринге валит
 * сборку — а в этом репозитории докстринги длинные и как раз объясняют запреты.
 */
function stripComments(code) {
  // Блочные комментарии режем только там, где `/*` открывает строку или стоит
  // после пробела: иначе неспаренный `/*` внутри строкового литерала съел бы
  // код до следующего `*/` вместе с импортами, и отказ был бы молчаливым.
  return code.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sources(rawCode) {
  const code = stripComments(rawCode);
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
  const isSeam = SEAMS.has(path);
  const code = readFileSync(file, 'utf8');

  for (const source of sources(code)) {
    const target = resolveSource(file, source);
    if (target === null) {
      continue;
    }

    // ⚠️ Точное совпадение отдельно от префикса: `@/simple` разрешается в
    // `src/simple` БЕЗ слэша, и сравнение только по префиксу его пропускало.
    // Это самая ходовая форма — `App.tsx` сам пишет `from './simple'`, а
    // `src/simple/index.tsx` заведён именно как единственная точка входа.
    const targetInSimple = target === 'src/simple' || target.startsWith(SIMPLE_DIR);

    if (inSimple) {
      // Внутри своего дерева ходим куда угодно.
      if (targetInSimple) {
        continue;
      }
      if (target === 'src/pages' || target.startsWith('src/pages/')) {
        violations.push({
          path,
          source,
          why: 'простой режим не импортирует апстримные страницы (src/pages/**). Нужна логика — бери из api/hooks/store/types; нужен вид — собирай свой в src/simple/',
        });
      } else if (
        target.startsWith('src/components/') &&
        // Точное совпадение — это импорт index-файла каталога, он же разрешён.
        target !== 'src/components/primitives' &&
        !target.startsWith('src/components/primitives/') &&
        !OPEN_DIRS.some((dir) => target === dir || target.startsWith(`${dir}/`)) &&
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
        why: `апстримный код не должен знать о простом режиме; швы поимённо — ${[...SEAMS].join(', ')}`,
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
