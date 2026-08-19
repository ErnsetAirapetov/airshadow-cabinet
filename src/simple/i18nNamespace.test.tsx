import { readdirSync, readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { SIMPLE_NS } from './i18n';
import en from './locales/en.json';
import ru from './locales/ru.json';

/**
 * Привязка строк простого режима к своему неймспейсу (задача #58).
 *
 * ⚠️ Дыра, из-за которой этот сторож существует: подмена `useTranslation(SIMPLE_NS)`
 * на `useTranslation()` оставляла ВСЕ тесты зелёными, а на экране печатался сырой
 * ключ — `dashboard.timeLeftUnderMinute` вместо «Меньше минуты». Сторожа страниц
 * проверяли литерал ключа (`tSimple('dashboard.timeLeftUnderMinute')`), но не то,
 * что `tSimple` действительно читает из НАШЕГО неймспейса.
 *
 * Поэтому проверка здесь одна на весь слой и по составу из исходников: новая
 * страница с нашей строкой попадает под сторожа сама, без правки списков. Сторожа
 * отдельных экранов ту же строку проверяют у себя дополнительно — там она стоит
 * рядом с ключами, которые они и так читают.
 *
 * ⚠️ Граница приёма: сторож ловит КОНВЕНЦИЮ, записанную в каноне, а не любой
 * рабочий способ привязки. Требуется буквально `useTranslation(SIMPLE_NS)` и имя
 * `tSimple`, поэтому легальные варианты вроде `useTranslation(SIMPLE_NS, {
 * keyPrefix })`, `useTranslation([SIMPLE_NS])` или привязка без переименования
 * покраснеют. Это осознанно: одна форма записи на весь слой дешевле разбора всех
 * форм, а понадобится другая — расширяют сторож вместе с каноном, а не в обход.
 * Обход только `.tsx`: `tSimple` в `.ts` слоя не бывает по построению — там нет
 * ни разметки, ни хуков.
 *
 * Ниже — вторая часть файла: тот же дефект, доказанный ИСПОЛНЕНИЕМ, а не разбором
 * текста. `renderToStaticMarkup` из `react-dom/server` работает при
 * `environment: 'node'` (серверный рендер не трогает DOM, jsdom ему не нужен), и
 * граница у приёма ровно одна — alias `@/` в тестах не резолвится, поэтому
 * отрисовать можно только то, чей граф импортов до него не дотягивается. Сами
 * страницы и карточки простого режима под это не подходят (`@/api`, `@/hooks`,
 * `@/utils`), а механика неймспейса — подходит.
 */

const SIMPLE_ROOT = 'src/simple';

/** Все `.tsx` слоя, кроме самих тестов. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...tsxFiles(path));
    } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Исходник без комментариев: докстринги слоя сами обсуждают `tSimple` и
 * `useTranslation(SIMPLE_NS)`, и на сыром тексте сторож ловил бы прозу.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const allTsx = tsxFiles(SIMPLE_ROOT);
const sources = new Map(allTsx.map((path) => [path, code(readFileSync(path, 'utf8'))]));

/** Файлы, печатающие НАШУ строку. */
const printOurStrings = allTsx.filter((path) => sources.get(path)?.includes('tSimple('));
/** Файлы, привязавшие переводчик к нашему неймспейсу. */
const bindOurNamespace = allTsx.filter((path) =>
  sources.get(path)?.includes('useTranslation(SIMPLE_NS)'),
);

type Tree = { [key: string]: Tree | string };

/** Плоский набор ключей локали — для проверки, что печатаемый ключ существует. */
function flatKeys(tree: Tree, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.add(path);
    } else {
      for (const nested of flatKeys(value, path)) {
        out.add(nested);
      }
    }
  }
  return out;
}

const ruKeys = flatKeys(ru as Tree);
const enKeys = flatKeys(en as Tree);

describe('строки простого режима читаются из своего неймспейса (задача #58)', () => {
  it('разбор удался — иначе сторож обходил бы пустоту', () => {
    // Сломанный обход каталогов или регулярка комментариев дали бы пустые
    // списки, и все проверки ниже прошли бы при любой реализации слоя.
    expect(allTsx.length, 'в src/simple не найдено .tsx — обход каталогов сломан').toBeGreaterThan(
      20,
    );
    expect(
      printOurStrings.length,
      'ни один файл не печатает `tSimple(` — разбор исходников сломан',
    ).toBeGreaterThan(4);
    expect(printOurStrings).toContain('src/simple/pages/Dashboard.tsx');
    expect(ruKeys.size).toBeGreaterThan(0);
  });

  it('каждый файл с `tSimple` привязан к SIMPLE_NS', () => {
    // ⚠️ Ровно та мутация, из-за которой сторож заведён: `useTranslation()`
    // вместо `useTranslation(SIMPLE_NS)` печатает сырой ключ.
    const unbound = printOurStrings.filter(
      (path) => !sources.get(path)?.includes('useTranslation(SIMPLE_NS)'),
    );

    expect(
      unbound,
      'файл печатает нашу строку, но переводчик к неймспейсу `simple` не привязан — ' +
        'на экране будет сырой ключ',
    ).toEqual([]);
  });

  it('SIMPLE_NS берётся из нашего модуля, а не литералом', () => {
    // Литерал `useTranslation('simple')` работал бы, но переименование
    // неймспейса в `src/simple/i18n.ts` он бы не заметил.
    const noImport = bindOurNamespace.filter(
      (path) => !/import \{[^}]*SIMPLE_NS[^}]*\} from '[^']*i18n'/.test(sources.get(path) ?? ''),
    );

    expect(noImport, 'SIMPLE_NS используется без импорта из нашего i18n').toEqual([]);
  });

  it('привязка без потребителя не заводится', () => {
    // Обратная сторона: неймспейс привязан, а ни одной нашей строки не печатается —
    // мёртвая привязка, которую следующий читатель примет за настоящую.
    const unused = bindOurNamespace.filter((path) => !sources.get(path)?.includes('tSimple('));

    expect(unused, 'неймспейс привязан, но `tSimple` не вызывается').toEqual([]);
  });

  it('каждый печатаемый ключ есть в обеих наших локалях', () => {
    // Ключ, потерянный при переименовании, i18next печатает как есть — тот же
    // сырой ключ на экране, только другой дорогой.
    const missing: string[] = [];

    for (const path of printOurStrings) {
      for (const found of (sources.get(path) ?? '').matchAll(/tSimple\('([^']+)'/g)) {
        const key = found[1];
        if (!ruKeys.has(key)) {
          missing.push(`${path}: ru.json не знает ${key}`);
        }
        if (!enKeys.has(key)) {
          missing.push(`${path}: en.json не знает ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Тот же дефект, доказанный отрисовкой.
 *
 * Сторожа выше читают текст и потому верят на слово, что непривязанный
 * переводчик печатает сырой ключ. Здесь это ИСПОЛНЯЕТСЯ: два компонента
 * отличаются одним аргументом `useTranslation`, оба рендерятся всерьёз, и
 * разница видна в разметке. Заодно это единственный в репе образец рендера в
 * тесте — на него ссылается канон (docs/architecture/two-modes.md, «Тесты»).
 * ══════════════════════════════════════════════════════════════════════════ */

/** Представитель наших строк: терминальная формулировка плитки остатка (#50). */
const OUR_KEY = 'dashboard.timeLeftUnderMinute';

/**
 * Инстанс, повторяющий раскладку приложения: общий неймспейс `translation` от
 * апстрима плюс наш `simple`. Наших ключей в общем неймспейсе нет — именно
 * поэтому непривязанный `t` их не находит.
 */
function appLikeInstance() {
  const instance = createInstance();
  instance.init({
    lng: 'ru',
    fallbackLng: 'ru',
    initImmediate: false,
    interpolation: { escapeValue: false },
    resources: { ru: { translation: { 'common.refresh': 'Обновить' } } },
  });
  instance.addResourceBundle('ru', SIMPLE_NS, ru, true, true);
  return instance;
}

function Bound() {
  const { t: tSimple } = useTranslation(SIMPLE_NS);
  return <span>{tSimple(OUR_KEY)}</span>;
}

function Unbound() {
  const { t } = useTranslation();
  return <span>{t(OUR_KEY)}</span>;
}

function markup(node: React.ReactElement) {
  return renderToStaticMarkup(<I18nextProvider i18n={appLikeInstance()}>{node}</I18nextProvider>);
}

describe('отрисовка: непривязанный переводчик печатает сырой ключ (задача #58)', () => {
  it('разбор удался — ключ действительно живёт в нашей локали, а не в общей', () => {
    // Иначе «привязанный печатает текст» проходило бы и без неймспейса.
    expect(ruKeys.has(OUR_KEY)).toBe(true);
    expect(appLikeInstance().t(OUR_KEY)).toBe(OUR_KEY);
  });

  it('с привязкой к неймспейсу на экране текст', () => {
    expect(markup(<Bound />)).toBe(`<span>${ru.dashboard.timeLeftUnderMinute}</span>`);
  });

  it('без привязки на экране сырой ключ — цена одного пропущенного аргумента', () => {
    expect(markup(<Unbound />)).toBe(`<span>${OUR_KEY}</span>`);
  });
});
