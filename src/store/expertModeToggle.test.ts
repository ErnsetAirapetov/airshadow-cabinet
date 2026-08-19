import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сторож переключателя режима в апстримной шапке (задачи #41, #45, #46, #48).
 *
 * `AppShell.tsx` и `AppHeader.tsx` — файлы апстрима, которыми мы владеем
 * осознанно (канон: docs/architecture/two-modes.md, «Что остаётся нашим в
 * апстримных файлах»). При синке апстрим правит их регулярно, и наш выход из
 * режима может уехать вместе с разрешением конфликта — молча, с зелёной сборкой.
 *
 * Мест два, и они разные (решение владельца 14.08.2026, #48):
 *   - десктоп (`AppShell.tsx`) — кнопка-иконка в ряду действий шапки;
 *   - мобилка (`AppHeader.tsx`) — отдельная строка в оверлее бургер-меню, как в
 *     ящике простого режима; кнопки-иконки в ряду действий там больше нет.
 *
 * Поведение после решения владельца 17.08.2026 (#45, #46) — одно на оба места:
 *   - кнопка видна ВСЕГДА, гейта по режиму больше нет;
 *   - есть простая версия текущего пути — `setMode('simple')`, адрес не меняется;
 *   - нет — `setMode('simple')` и уход на `/`, иначе кнопка была бы мёртвой;
 *   - подпись берётся из НАШЕГО неймспейса, русского литерала в шапке нет.
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются: `vitest.config.ts` задаёт
 * `environment: 'node'`, alias `@/` в тестах не работает, а импорт шапки
 * потянул бы весь граф приложения. Отрисовку проверить нечем — проверяем
 * присутствие ключевых кусков патча.
 *
 * Цена приёма — тест видит только литералы, поэтому обязательна пара «разбор
 * удался»: без неё опечатка в пути или промах окна дают вечно зелёного сторожа,
 * который ничего не охраняет.
 */
const SHELL_DIR = resolve(__dirname, '../components/layout/AppShell');
const SIMPLE_LOCALES_DIR = resolve(__dirname, '../simple/locales');
const SIMPLE_I18N_FILE = resolve(__dirname, '../simple/i18n.ts');
const SIMPLE_ROUTES_FILE = resolve(__dirname, '../simple/routes.tsx');
const BOUNDARIES_SCRIPT = resolve(__dirname, '../../scripts/check-mode-boundaries.mjs');

const HEADERS = [
  { name: 'AppShell.tsx (десктопная шапка)', file: 'AppShell.tsx' },
  { name: 'AppHeader.tsx (мобильная шапка)', file: 'AppHeader.tsx' },
] as const;

/** Подпись кнопки: ключ нашего неймспейса, написанный в шапке литералом. */
const LABEL = "t('mode.toSimple', { ns: 'simple' })";

function read(file: string): string {
  return readFileSync(resolve(SHELL_DIR, file), 'utf8');
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/**
 * JSX-узел кнопки переключения режима — от её `<button` до её `</button>`.
 *
 * Проверки «в том же элементе» иначе не выразить: разбирать JSX нечем, а поиск
 * по всему файлу нашёл бы `setMobileMenuOpen(false)` у любой соседней кнопки и
 * был бы зелёным всегда.
 *
 * ⚠️ ОБЕ границы структурные, а не отступ в N символов. Прошлая версия резала
 * начало окна на фиксированные −600 символов, окно захватывало соседнюю кнопку
 * «Выход», и проверка «клик закрывает бургер» была зелёной независимо от нашего
 * кода. Теперь назад идём до ближайшего `<button` (это открывающий тег ИМЕННО
 * нашей кнопки: `setMode('simple')` лежит в её `onClick`), вперёд — до первого
 * `</button>`.
 */
function modeSwitchButton(source: string): string {
  const at = source.indexOf("setMode('simple')");
  expect(at, "в файле нет setMode('simple')").toBeGreaterThan(-1);

  const open = source.lastIndexOf('<button', at);
  expect(open, "не найден открывающий <button перед setMode('simple')").toBeGreaterThan(-1);

  const close = source.indexOf('</button>', at);
  expect(close, "не найден закрывающий </button> после setMode('simple')").toBeGreaterThan(-1);

  return source.slice(open, close + '</button>'.length);
}

describe('переключатель режима в апстримной шапке', () => {
  it.each(HEADERS)('$name: разбор удался — файл найден и непустой', ({ file }) => {
    expect(read(file).length).toBeGreaterThan(1000);
  });

  it.each(HEADERS)('$name: разбор удался — узел кнопки вырезан и он не весь файл', ({ file }) => {
    // Вторая половина пары «разбор удался»: окно должно быть непустым (иначе
    // проверкам внутри него нечего искать) и строго меньше файла (иначе оно
    // ловило бы совпадения из соседних кнопок, как было до #45).
    const source = read(file);
    const block = modeSwitchButton(source);

    expect(block.startsWith('<button'), 'окно не начинается с <button').toBe(true);
    expect(block.endsWith('</button>'), 'окно не заканчивается на </button>').toBe(true);
    expect(block.length).toBeGreaterThan(100);
    expect(block.length).toBeLessThan(source.length);
  });

  it.each(HEADERS)('$name: переключатель ровно один', ({ file }) => {
    // Две кнопки означали бы, что при правке забыли снять старую: на мобилке
    // так уже было (#48 отменял иконку из ряда действий), и окно кнопки тогда
    // указывало бы не на ту.
    expect(countOf(read(file), "setMode('simple')")).toBe(1);
  });

  it.each(HEADERS)('$name: стор режима берётся из @/store/mode', ({ file }) => {
    // Стор переехал в @/store (#40) именно ради этого: гейт границ запрещает
    // апстримным файлам импортировать презентацию простого режима. Про сами
    // шапки уточнение: с #45 они в SEAMS, и им гейт разрешил бы и `src/simple/**`
    // — стор за границей нужен остальному апстримному коду, которому не разрешён.
    expect(read(file)).toContain("from '@/store/mode'");
  });

  it.each(HEADERS)('$name: переключает режим на simple', ({ file }) => {
    expect(modeSwitchButton(read(file))).toContain("setMode('simple')");
  });

  it.each(HEADERS)('$name: иконка — PiArrowsInSimple из react-icons/pi', ({ file }) => {
    const source = read(file);
    expect(source).toContain("from 'react-icons/pi'");
    expect(modeSwitchButton(source)).toContain('PiArrowsInSimple');
  });

  it.each(HEADERS)('$name: кнопка не гейтится режимом — видна всегда (#45)', ({ file }) => {
    // Решение владельца 17.08.2026: гейт `mode === 'expert'` убран. Он делал
    // кнопку невидимой в простом режиме на путях без простой страницы — а это
    // всё меню, кроме главной, пока идёт милстоун [M1-E05].
    //
    // Проверяем и условие, и чтение поля: без `state.mode` компоненту гейт по
    // режиму просто не на чем построить. Литерал `mode === 'expert'` пишем
    // целиком — подстрока `mode` живёт в соседнем `'Light mode'`.
    const source = read(file);
    expect(source).not.toContain("mode === 'expert'");
    expect(source).not.toContain('state.mode');
  });

  it.each(HEADERS)('$name: подпись — ключ из нашего неймспейса (#46)', ({ file }) => {
    // Неймспейс написан литералом по сознательному решению, а НЕ потому что
    // импорт SIMPLE_NS запрещён: обе шапки в SEAMS, и гейт границ пропустил бы
    // им любой импорт из src/simple/** — подробно ниже, в тесте
    // «src/simple/i18n.ts: неймспейс объявлен строкой 'simple'». Ключ живёт в
    // src/simple/locales/{ru,en}.json — апстримные ru/en/fa/zh.json не трогаем:
    // четыре файла, конфликтующих на каждом синке ради одной строки.
    expect(modeSwitchButton(read(file))).toContain(LABEL);
  });

  it.each(HEADERS)('$name: русского литерала подписи в шапке нет (#46)', ({ file }) => {
    expect(read(file)).not.toContain('Упрощённый вид');
  });

  it.each(HEADERS)('$name: путь без простой страницы уводит на / (#45)', ({ file }) => {
    // Кнопка видна всегда, поэтому клик обязан приводить к простому виду и там,
    // где простой страницы нет: иначе режим сменится, а экран останется
    // апстримным — та самая мёртвая кнопка, ради которой стоял гейт.
    //
    // ⚠️ Проверяем ПОЛЯРНОСТЬ условия, а не факт вызова navigate('/') где-то в
    // узле кнопки. Мутация `!hasSimpleView(…)` → `hasSimpleView(…)` не убирает
    // ни один из вызовов (`hasSimpleView(` и `navigate('/')` в блоке остаются),
    // поэтому старая версия проверки — `toContain` по каждому куску отдельно —
    // оставалась зелёной, а поведение при этом переворачивалось обратно в дефект
    // #45: на пути без простой страницы клик ничего не делал, а на пути с ней —
    // уводил на `/` без нужды. Поэтому ищем условие целиком строкой и отдельно
    // убеждаемся, что `navigate('/')` стоит внутри ЕГО then-блока (между `{`
    // сразу после условия и первым `}` после него), а не просто где-то в файле.
    const block = modeSwitchButton(read(file));
    const condition = '!hasSimpleView(location.pathname)';
    const conditionAt = block.indexOf(condition);
    expect(conditionAt, `нет условия "${condition}"`).toBeGreaterThan(-1);

    const thenStart = block.indexOf('{', conditionAt + condition.length);
    expect(thenStart, 'после условия нет открывающего { then-блока').toBeGreaterThan(-1);
    const thenEnd = block.indexOf('}', thenStart);
    expect(thenEnd, 'после условия нет закрывающего } then-блока').toBeGreaterThan(-1);

    const navigateAt = block.indexOf("navigate('/')");
    expect(navigateAt, "нет navigate('/')").toBeGreaterThan(-1);
    expect(navigateAt, "navigate('/') должен быть внутри then-блока условия").toBeGreaterThan(
      thenStart,
    );
    expect(navigateAt, "navigate('/') должен быть внутри then-блока условия").toBeLessThan(thenEnd);
  });

  it.each(HEADERS)('$name: наличие простой версии спрашивается у простого слоя', ({ file }) => {
    // Второго источника истины быть не должно: тем же простым слоем пользуется
    // шов подмены в App.tsx. Свой матчинг путей в шапке разъехался бы с ним
    // молча.
    //
    // ⚠️ С #64 вопрос шире, чем «есть ли страница в реестре»: простой версией
    // считается и апстримная страница в простой оболочке (сквозной список).
    // Отвечает на оба сразу один предикат hasSimpleView; возврат сюда
    // resolveSimpleRoute вернул бы дефект — переключение режима на /profile
    // снова уводило бы на главную.
    //
    // Через `@/simple`, а не напрямую из `@/simple/routes` (#51): точка входа
    // простого режима одна, и на её импорте висит регистрация неймспейса
    // локалей. Прямой импорт реестра оставлял бы подпись кнопки зависеть от
    // того, что `./simple` импортирует кто-то ещё — см. src/simple/entryPoint.test.ts.
    //
    // ⚠️ Ищем импорт ЦЕЛИКОМ, а не подстроку `from '@/simple'`: та связывала
    // проверку с любым импортом из точки входа, а не с импортом реестра. Синк,
    // добавивший в шапку второй импорт из `@/simple`, открыл бы возврат к
    // прямому `@/simple/routes` при зелёном тесте (проверено мутацией).
    expect(
      read(file),
      "потерян импорт `import { hasSimpleView } from '@/simple';` — предикат берут " +
        'через точку входа простого режима, а не из @/simple/routes',
    ).toContain("import { hasSimpleView } from '@/simple';");
  });

  it('src/simple/routes.tsx: resolveSimpleRoute экспортируется', () => {
    // С #64 шапки зовут не его, а `hasSimpleView` — но тот спрашивает реестр
    // именно через `resolveSimpleRoute`, так что цепочка от шапки до реестра на
    // нём и держится. Переименование в реестре обязано ронять этот тест, а не
    // сборку в чужом MR.
    expect(readFileSync(SIMPLE_ROUTES_FILE, 'utf8')).toContain(
      'export function resolveSimpleRoute(',
    );
  });

  it('гейт границ знает обе шапки как швы', () => {
    // scripts/check-mode-boundaries.mjs запрещает апстримному коду импортировать
    // src/simple/**. Шапки внесены в список швов поимённо (#45) — если запись
    // потеряется, `npm run check:modes` начнёт валить сборку.
    const script = readFileSync(BOUNDARIES_SCRIPT, 'utf8');
    expect(script).toContain('src/components/layout/AppShell/AppShell.tsx');
    expect(script).toContain('src/components/layout/AppShell/AppHeader.tsx');
  });

  it("src/simple/i18n.ts: неймспейс объявлен строкой 'simple'", () => {
    // Шапки пишут ns: 'simple' литералом — это сознательное решение, а НЕ запрет
    // гейта: обе шапки в SEAMS, а швам scripts/check-mode-boundaries.mjs
    // разрешает любой импорт из src/simple/**, включая SIMPLE_NS из
    // src/simple/i18n. Литерал выбран, чтобы апстримный файл не зависел от
    // внутренностей простого режима. Плата за это — ровно данный тест: если
    // константу NS в src/simple/i18n.ts переименуют или изменят значение,
    // литерал в шапке молча разойдётся с реальным неймспейсом, и подпись
    // отрисуется как сырой ключ. Проверяем факт объявления, а не импортируем
    // модуль: environment у vitest — 'node', импорт потянул бы i18next и весь
    // граф.
    expect(readFileSync(SIMPLE_I18N_FILE, 'utf8')).toContain("const NS = 'simple'");
  });

  it.each(['ru', 'en'])('%s.json простого режима: ключ mode.toSimple на месте', (lng) => {
    const bundle = JSON.parse(readFileSync(resolve(SIMPLE_LOCALES_DIR, `${lng}.json`), 'utf8')) as {
      mode?: Record<string, string>;
    };
    expect(bundle.mode?.toSimple, `нет mode.toSimple в ${lng}.json`).toBeTruthy();
  });

  describe('десктоп: кнопка-иконка в ряду действий', () => {
    // Владелец одобрил её отдельно и явно (#48): на десктопе всё остаётся как
    // есть, подпись живёт в title/aria-label — только теперь переведённая.
    it('AppShell.tsx: подпись в aria-label и в title', () => {
      const block = modeSwitchButton(read('AppShell.tsx'));
      expect(block).toContain(`aria-label={${LABEL}}`);
      expect(block).toContain(`title={${LABEL}}`);
    });
  });

  describe('мобилка: строка в бургер-меню', () => {
    it('AppHeader.tsx: строка оформлена как соседние пункты меню', () => {
      expect(modeSwitchButton(read('AppHeader.tsx'))).toContain('className="nav-item w-full"');
    });

    it('AppHeader.tsx: подпись стоит текстом рядом с иконкой, а не в атрибутах', () => {
      // #48: на мобилке переключатель — строка меню, а не иконка. Признак —
      // подпись ребёнком кнопки, сразу после иконки. Пробелы между ними —
      // \s*, потому что отступы правит biome, а не человек.
      expect(modeSwitchButton(read('AppHeader.tsx'))).toMatch(
        /PiArrowsInSimple[^>]*\/>\s*\{t\('mode\.toSimple', \{ ns: 'simple' \}\)\}/,
      );
    });

    it('AppHeader.tsx: клик закрывает бургер', () => {
      expect(modeSwitchButton(read('AppHeader.tsx'))).toContain('setMobileMenuOpen(false)');
    });
  });
});
