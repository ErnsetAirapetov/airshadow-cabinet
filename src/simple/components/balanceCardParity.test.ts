import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PAGE_HEADING_BLOCK } from './pageHeading';
import { resolveBalanceValueClass } from './balanceValueScale';

/**
 * Паритет карточки баланса на главной и на `/balance` (задача #73).
 *
 * Жалоба владельца: при переходе главная → `/balance` карточка «прыгает» —
 * меняются кегль суммы и вертикальная позиция, — а на самой главной карточка не
 * читается как кликабельная. Обе половины дефекта тихие: сборка и тесты на них
 * зелёные, видит их только человек, который прошёл по ссылке.
 *
 * ⚠️ Позицию сторож проверяет ПО РАЗМЕТКЕ и общей константе, а не рендером.
 * Отрисовать страницы простого режима нечем: их граф импортов дотягивается до
 * alias `@/`, который в тестах не разрешается (docs/architecture/two-modes.md,
 * раздел «Тесты»). Совпадение пикселей на стенде проверяет владелец; сторож ниже
 * держит то, из чего это совпадение следует: одну константу высоты на две
 * страницы, один ритм и одно правило кегля.
 *
 * Файлы читаются ТЕКСТОМ, поэтому у каждой группы есть парная проверка «разбор
 * удался»: сломанная регулярка иначе даёт вечно зелёный сторож.
 *
 * ⚠️ Проверки этого файла написаны против МУТАЦИЙ, а не против нынешнего вида
 * кода: каждая заявленная здесь гарантия подтверждена тем, что соответствующая
 * поломка в исходнике делает тест красным. Ревью задачи #73 завернуло прошлую
 * редакцию ровно за обратное — за проверки, которые заявляли покрытие, а мутацию
 * пропускали. Добавляя сюда проверку, сломай то, что она стережёт, и убедись,
 * что она краснеет.
 */

const WIDGET = 'src/simple/components/BalanceWidget.tsx';
const DASHBOARD = 'src/simple/pages/Dashboard.tsx';
const BALANCE = 'src/simple/pages/Balance.tsx';
const TOP_UP = 'src/simple/pages/TopUpAmount.tsx';
const HEADING = 'src/simple/components/pageHeading.ts';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаем: докстринги сами называют то, что сторожа запрещают. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const widget = stripComments(read(WIDGET));
const dashboard = stripComments(read(DASHBOARD));
const balance = stripComments(read(BALANCE));
const topUp = stripComments(read(TOP_UP));
const heading = read(HEADING);

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** Разметка одного элемента: от открывающего тега до конца этого же тега. */
function elementOf(source: string, tag: string): string {
  const start = source.indexOf(`<${tag}`);
  if (start === -1) return '';

  const end = source.indexOf('/>', start);

  return end === -1 ? '' : source.slice(start, end + 2);
}

/**
 * Выражение атрибута `attr={…}` целиком, со сбалансированными скобками.
 *
 * Регуляркой это не берётся: внутри лежат шаблонные строки с подстановками, и
 * наивный поиск закрывающей скобки обрывает выражение на первой же из них.
 */
function attrExpression(source: string, attr: string): string {
  const marker = `${attr}={`;
  const start = source.indexOf(marker);
  if (start === -1) return '';

  let depth = 0;
  for (let i = start + marker.length - 1; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + marker.length, i);
    }
  }

  return '';
}

describe('разбор файлов удался (задача #73)', () => {
  it('все файлы на месте и опознаны', () => {
    expect(widget).toMatch(/export function BalanceWidget\(/);
    expect(dashboard).toMatch(/export function SimpleDashboard\(/);
    expect(balance).toMatch(/export function SimpleBalance\(/);
    expect(topUp).toMatch(/export function SimpleTopUpAmount\(/);
    expect(heading.length).toBeGreaterThan(200);
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(read(WIDGET)).toContain('⚠️');
    expect(widget).not.toContain('⚠️');
    expect(widget).toContain("const isAccent = tone === 'accent';");
  });
});

describe('высота блока заголовка — одно определение на две страницы (задача #73)', () => {
  it('константа задаёт ТОЧНУЮ высоту обоим брейкпоинтам', () => {
    // Высота выведена из кеглей двухстрочного приветствия главной:
    //   мобилка — `text-base` (lh 24px) + `text-2xl` (lh 32px) = 56px;
    //   `sm:`   — `sm:text-lg` (lh 28px) + `sm:text-3xl` (lh 36px) = 64px.
    //
    // ⚠️ Значение пришпилено `toBe`, а не формой регулярки, потому что `min-h`
    // делает расхождение ОДНОСТОРОННИМ: заниженная константа ничего не обрежет
    // и не сломает — она молча разведёт карточки по вертикали, то есть вернёт
    // ровно тот дефект, ради которого заведена задача.
    expect(PAGE_HEADING_BLOCK).toBe('min-h-[56px] sm:min-h-[64px]');
  });

  it('кегли приветствия — те самые, из которых константа посчитана', () => {
    // ⚠️ Вторая сторона того же вывода, и без неё константа висит в воздухе.
    // Правка кеглей приветствия ОБЯЗАНА сопровождаться пересчётом
    // `PAGE_HEADING_BLOCK`: 24 + 32 = 56 на мобилке, 28 + 36 = 64 с `sm:`.
    // Иначе подъём одной строки (`text-base` → `text-lg`) разводит карточки на
    // главной и на `/balance` при зелёных тестах.
    expect(dashboard).toContain(
      '<span className="block text-base font-medium text-dark-300 sm:text-lg">',
    );
    // Обе ветки приветствия — с именем и `welcomeNoName` — одного кегля: высоту
    // блока задаёт самая высокая из них, и разъехавшиеся ветки ломают вывод.
    expect(countOf(dashboard, '<h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">')).toBe(
      2,
    );
  });

  it('классы записаны литералами — иначе Tailwind их не соберёт', () => {
    // Tailwind сканирует исходники ТЕКСТОМ: класса, собранного шаблоном, в CSS
    // не окажется, и высота молча останется нулевой.
    for (const className of PAGE_HEADING_BLOCK.split(' ')) {
      expect(heading).toContain(`${className}`);
    }
  });

  it('обе страницы читают константу, а не пишут свою высоту', () => {
    // ⚠️ Это и есть критерий приёмки «в одном месте, а не литералами в двух
    // файлах». Два литерала разъедутся при первой же правке — так этот форк уже
    // терял кнопку подключения (#59 → #61).
    for (const page of [dashboard, balance]) {
      expect(page).toContain("from '../components/pageHeading'");
      expect(page).toContain('className={PAGE_HEADING_BLOCK}');
      expect(page).not.toMatch(/min-h-\[/);
    }
  });

  it('блок приветствия главной получает ту же высоту, что и однострочная ветка', () => {
    // ⚠️ У приветствия две ветки — с именем (две строки) и `welcomeNoName`
    // (одна). Высота стоит на ОБЩЕЙ обёртке, поэтому позиция карточки не
    // зависит от того, знаем ли мы имя.
    expect(countOf(dashboard, 'className={PAGE_HEADING_BLOCK}')).toBe(1);
    expect(dashboard).toContain("t('dashboard.welcomeNoName')");
  });
});

describe('ритм страниц совпадает (задача #73)', () => {
  it('корневая обёртка обеих страниц — один и тот же ритм', () => {
    // Ритм — второе слагаемое позиции карточки: высота блока заголовка плюс
    // отступ до следующего блока.
    for (const page of [dashboard, balance]) {
      expect(countOf(page, '<div className="space-y-4 sm:space-y-6">')).toBe(1);
    }
    expect(balance).not.toContain('<div className="space-y-6">');
  });
});

describe('кегль суммы одинаков на всех экранах (задача #73)', () => {
  /** Узел суммы целиком — от обёртки до закрытия, вместе с символом валюты. */
  const valueNode = (() => {
    const anchor = widget.indexOf('{formatted}');
    if (anchor === -1) return '';

    const start = widget.lastIndexOf('<div', anchor);
    const symbol = widget.indexOf('{currencySymbol}', anchor);
    if (start === -1 || symbol === -1) return '';

    const end = widget.indexOf('</div>', symbol);

    return end === -1 ? '' : widget.slice(start, end + '</div>'.length);
  })();

  /** Символ валюты — единственное место в узле, где кегль задан литералом. */
  const currencySpan = (() => {
    const anchor = valueNode.indexOf('{currencySymbol}');
    if (anchor === -1) return '';

    const start = valueNode.lastIndexOf('<span', anchor);
    const end = valueNode.indexOf('</span>', anchor);

    return start === -1 || end === -1 ? '' : valueNode.slice(start, end + '</span>'.length);
  })();

  const valueTernary = /^isAccent \? (.+?) : (.+)$/s.exec(
    attrExpression(valueNode, 'className').trim(),
  );
  const valueAccentClass = valueTernary?.[1] ?? '';
  const valueFlatClass = valueTernary?.[2] ?? '';

  it('разбор узла суммы удался', () => {
    // Пара «разбор удался» для проверок ниже: они читают текст, и съехавшая
    // выборка дала бы вечно зелёный сторож.
    expect(valueNode).toContain('{formatted}');
    expect(currencySpan).toContain('{currencySymbol}');
    expect(valueTernary).not.toBeNull();
    expect(valueAccentClass.length).toBeGreaterThan(0);
    expect(valueFlatClass.length).toBeGreaterThan(0);
  });

  it('правило кегля зовётся ровно один раз', () => {
    // Один вызов — одно место, где кегль вообще вычисляется. Сам по себе этот
    // счёт ещё НЕ означает «независимо от тона»: ветка тона может обойти правило
    // литералом рядом, и до задачи #73 именно так и было. За «независимо от
    // тона» отвечают две проверки ниже — про обе ветки класса и про отсутствие
    // литеральных кеглей в узле суммы.
    expect(countOf(widget, 'resolveBalanceValueClass(formatted)')).toBe(1);
    expect(widget).toContain('const valueClass = ');
  });

  it('обе ветки класса суммы собраны из общего правила', () => {
    // ⚠️ Вот это и есть «кегль независимо от тона», записанное по разметке: ни
    // акцентная, ни плоская ветка не имеет права собрать класс мимо
    // `valueClass`. Возврат вида `isAccent ? valueClass : 'text-4xl …'` — это
    // исходный дефект задачи: 48px на главной против 36px на `/balance`.
    expect(valueAccentClass).toContain('valueClass');
    expect(valueFlatClass).toContain('valueClass');
  });

  it('в узле суммы нет литеральных кеглей — кроме символа валюты', () => {
    // ⚠️ Единственное исключение — `text-2xl` на символе валюты: он намеренно
    // мельче самой суммы и к паритету экранов отношения не имеет, потому что
    // одинаков в обеих ветках тона. Всё остальное в узле обязано приходить из
    // `valueClass`, иначе литерал перекрывает правило.
    const withoutCurrency = valueNode.replace(/<span[\s\S]*?<\/span>/, '');

    expect(withoutCurrency).not.toContain('{currencySymbol}');
    expect(withoutCurrency).not.toMatch(/\btext-(?:2xs|xs|sm|base|lg|\d?xl)\b/);
    expect(currencySpan).toContain('text-2xl');
  });

  it('литеральной пары плоского тона в виджете больше нет', () => {
    // Она и давала расхождение: 48px на главной против 36px на `/balance`.
    expect(widget).not.toContain('text-4xl font-bold text-dark-50 sm:text-5xl');
    expect(widget).not.toContain('sm:text-5xl');
  });

  it('правило отдаёт непустой класс и одну и ту же строку на любую сумму', () => {
    // Пара «разбор удался» для проверок выше: сравнивать классы двух экранов
    // осмысленно только пока правило вообще что-то возвращает.
    for (const formatted of ['0.00', '1234.00', '1234567.00']) {
      expect(resolveBalanceValueClass(formatted).length).toBeGreaterThan(0);
      expect(resolveBalanceValueClass(formatted)).toBe(resolveBalanceValueClass(formatted));
    }
  });
});

describe('кликабельность карточки на главной (задача #73)', () => {
  const chevron = elementOf(widget, 'ChevronRightIcon');
  /** Строка подписи «Текущий баланс» целиком — вместе с шевроном в ней. */
  const labelRow = (() => {
    const anchor = widget.indexOf("t('balance.currentBalance')");
    if (anchor === -1) return '';

    const start = widget.lastIndexOf('<div', anchor);
    const end = widget.indexOf('</div>', anchor);

    return start === -1 || end === -1 ? '' : widget.slice(start, end + '</div>'.length);
  })();

  // ⚠️ Тернарник разбирается НА ПОЛОВИНЫ, и каждая ветка проверяется отдельно.
  // Одна регулярка на весь тернарник смотрела фактически только в плоскую ветку
  // и пропускала невидимый шеврон на заливке (`isAccent ? '… text-dark-500' :
  // …`) — прямое нарушение спеки, зелёное у прошлой редакции сторожа.
  const chevronTernary = /^isAccent \? '([^']*)' : '([^']*)'$/.exec(
    attrExpression(chevron, 'className').trim(),
  );
  const chevronAccentClass = chevronTernary?.[1] ?? '';
  const chevronFlatClass = chevronTernary?.[2] ?? '';

  it('разбор шеврона и строки подписи удался', () => {
    expect(chevron).toContain('ChevronRightIcon');
    expect(widget).toContain("import { ChevronRightIcon } from '@/components/icons'");
    expect(labelRow).toContain("t('balance.currentBalance')");
    expect(labelRow).toContain('<ChevronRightIcon');
  });

  it('разбор тернарника шеврона на две половины удался', () => {
    // Пара «разбор удался» для двух проверок ниже: они читают половины по
    // отдельности, и `null` от съехавшей регулярки дал бы две пустые строки —
    // то есть вечно зелёный сторож на самом важном месте задачи.
    expect(chevronTernary).not.toBeNull();
    expect(chevronAccentClass).toContain('shrink-0');
    expect(chevronFlatClass).toContain('shrink-0');
  });

  it('шеврон включается пропом и по умолчанию выключен', () => {
    // ⚠️ На `/balance` и на экране суммы пополнения карточка никуда не ведёт —
    // звать там некуда. Держится это на значении по умолчанию, а не на том, что
    // вызовы сегодня написаны без пропа.
    expect(widget).toContain('linked = false');
    expect(widget).toContain('{linked && (');
  });

  it('шеврон того же размера, что у плитки рефералов, — в ОБЕИХ ветках тона', () => {
    expect(chevronAccentClass).toContain('h-4 w-4');
    expect(chevronFlatClass).toContain('h-4 w-4');
    expect(dashboard).toContain('<ChevronRightIcon className="h-4 w-4 shrink-0 text-dark-500" />');
  });

  it('на акцентной заливке тёмно-серого шеврона нет, в плоской он обязателен', () => {
    // ⚠️ Спека: `text-dark-500` на сплошной акцентной заливке не виден вовсе.
    // Поэтому в акцентной половине запрещена ВСЯ палитра `text-dark-*` —
    // соседний оттенок был бы не лучше, — а плоской половине тот же
    // `text-dark-500`, что у шеврона рефералов, наоборот обязателен.
    expect(chevronAccentClass).not.toMatch(/text-dark-/);
    expect(chevronFlatClass).toContain('text-dark-500');
    // Цвет на акценте приходит наследованием: иконки открытого каталога
    // рисуются `currentColor` и стиля не принимают вовсе, а строка подписи уже
    // покрашена общим `ACCENT_FOREGROUND_MUTED`. Своего цвета у шеврона нет —
    // копия значения была бы вторым местом правки.
    expect(chevron).not.toContain('style=');
    expect(labelRow).toContain('color: ACCENT_FOREGROUND_MUTED');
  });

  it('кликабельная карточка отзывается на курсор, некликабельная — нет', () => {
    // `bento-card-hover` — тот же хром, что у карточек способов пополнения и у
    // плиток каталога тарифов; своего эффекта виджет не выдумывает.
    expect(widget).toContain("linked ? 'bento-card-hover' : 'bento-card'");
  });

  it('шеврон и hover включает только главная', () => {
    expect(dashboard).toContain('<BalanceWidget tone="accent" linked />');
    expect(balance).toContain('<BalanceWidget />');
    expect(balance).not.toContain('linked');
    expect(topUp).not.toContain('<BalanceWidget linked');
  });
});

describe('заливка осталась только на главной (задача #73)', () => {
  it('акцентный тон включает одна страница', () => {
    // Решение владельца: на `/balance` акцент принадлежит кнопке пополнения.
    // Совпадать должны размер, шрифты, компоновка и позиция — но не цвет.
    expect(countOf(dashboard, 'tone="accent"')).toBe(1);
    expect(balance).not.toContain('tone=');
    expect(topUp).not.toContain('tone=');
  });
});
