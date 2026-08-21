import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PAGE_HEADING_BLOCK } from '../components/pageHeading';
import { SIMPLE_NAV_ITEMS } from '../components/layout/navItems';
import enSimple from '../locales/en.json';
import ruSimple from '../locales/ru.json';

/**
 * Сторожа страницы новостей `/news` (задача #74).
 *
 * ⚠️ Сторож паритета вертикали (`components/balanceCardParity.test.ts`) знает
 * только про главную и `/balance` — третью страницу он не проверит, и разъезд по
 * вертикали здесь остался бы молчаливым: экран по отдельности выглядит
 * правильно, видно расхождение только при переходе. Поэтому проверка живёт тут.
 *
 * ⚠️ Файл читается ТЕКСТОМ, отрисовать страницу нечем: её граф импортов
 * дотягивается до alias `@/`, которого в тестах нет (канон, раздел «Тесты»).
 * Цена приёма прежняя — разбор видит только литералы, поэтому у каждой группы
 * есть пара «разбор удался».
 *
 * ⚠️ Проверки написаны против МУТАЦИЙ: каждая заявленная здесь гарантия
 * подтверждена тем, что соответствующая поломка исходника делает тест красным.
 */

const PAGE = 'src/simple/pages/News.tsx';
const FEED = 'src/simple/components/news/NewsSection.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны: докстринг страницы сам называет то, что сторожат ниже. */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const pageSource = read(PAGE);
const page = stripComments(pageSource);

/**
 * Ключ, которым подписан заголовок `h1` страницы — печатается `tSimple`, а не
 * апстримным `t` (задача #75).
 */
const headingKey = /<h1[^>]*>\{tSimple\('([^']+)'\)\}<\/h1>/.exec(page)?.[1] ?? '';

/** Пункт меню «Новости» — из общего списка навигации. */
const newsNavItem = SIMPLE_NAV_ITEMS.find((item) => item.path === '/news');
/** Подпись пункта меню «Новости». */
const navLabelKey = newsNavItem?.labelKey ?? '';

describe('разбор страницы новостей удался (задача #74)', () => {
  it('файл на месте и опознан', () => {
    expect(pageSource.length).toBeGreaterThan(300);
    expect(page).toMatch(/export function SimpleNews\(\)/);
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(pageSource).toContain('⚠️');
    expect(page).not.toContain('⚠️');
    expect(page).toContain('<SimpleNewsSection />');
  });

  it('заголовок разобран — иначе сверка ключа сравнивала бы пустоту', () => {
    expect(headingKey.length).toBeGreaterThan(0);
    expect(navLabelKey.length).toBeGreaterThan(0);
  });
});

describe('вертикаль страницы совпадает с соседями (задача #73)', () => {
  it('высота блока заголовка приходит из общей константы', () => {
    // ⚠️ Это и есть критерий приёмки. Свой литерал высоты разъедется с главной и
    // `/balance` при первой же правке — так форк уже терял кнопку подключения
    // (#59 → #61).
    expect(page).toContain("from '../components/pageHeading'");
    expect(countOf(page, 'className={PAGE_HEADING_BLOCK}')).toBe(1);
    expect(page).not.toMatch(/min-h-\[/);
  });

  it('константа непустая — иначе проверка выше сторожила бы пустую строку', () => {
    expect(PAGE_HEADING_BLOCK.length).toBeGreaterThan(0);
  });

  it('ритм страницы — тот же, что у главной и у баланса', () => {
    // Второе слагаемое вертикальной позиции первого блока: высота заголовка плюс
    // отступ до следующего блока.
    expect(countOf(page, '<div className="space-y-4 sm:space-y-6">')).toBe(1);
  });

  it('кегль заголовка — тот же, что на `/balance`', () => {
    // Из этих кеглей посчитана `PAGE_HEADING_BLOCK`; подняв кегль здесь, страницу
    // разведёт с соседями по вертикали при зелёной сборке.
    expect(page).toContain('<h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">');
  });
});

describe('страница и пункт меню называются одинаково (задача #75)', () => {
  it('заголовок печатается тем же ключом, что подпись пункта меню', () => {
    // ⚠️ Ключ — НАШ, из неймспейса `simple`: владелец потребовал просто
    // «Новости», а апстримный `news.title` держит «Новости и обновления» и
    // трогать апстримные локали канон запрещает. Подходящего апстримного ключа
    // со значением «Новости» тоже нет — `admin.nav.news` и
    // `profile.notifications.news` чужой семантики. Разъедься эти два места —
    // пункт меню и заголовок страницы назывались бы по-разному, и заметил бы
    // это человек, а не проверка.
    expect(headingKey).toBe(navLabelKey);
    expect(headingKey).toBe('news.title');
  });

  it('пункт меню помечен как НАШ ключ (`ownLabel`), а не апстримный', () => {
    // Без этого признака потребители печатали бы `labelKey` апстримным `t` и
    // нашли бы в апстримной локали другой текст — «Новости и обновления».
    expect(newsNavItem?.ownLabel).toBe(true);
  });

  it('этот ключ есть в НАШИХ локалях простого режима — на обоих языках', () => {
    // ⚠️ Без этой проверки пара выше сторожила бы только совпадение двух мест,
    // и оба могли бы совпасть на несуществующем ключе: i18next печатает такой
    // ключ как есть, молча, при зелёной сборке и типах. Языков два — решение
    // владельца про состав простого неймспейса, не про переключатель языка.
    const missing = (
      [
        ['ru', ruSimple],
        ['en', enSimple],
      ] as const
    ).filter(
      ([, tree]) => typeof (tree as { news?: { title?: unknown } }).news?.title !== 'string',
    );

    expect(
      missing.map(([lng]) => lng),
      'наши локали не знают `news.title`',
    ).toEqual([]);
  });

  it('заголовок печатается НАШИМ неймспейсом, а не апстримным `t`', () => {
    // `news.title` в неймспейсе `simple` — другой текст, чем у апстримного;
    // непривязанный `t` найдёт апстримную строку («Новости и обновления»), а не
    // ошибку и не пустоту — расхождение молчаливое.
    expect(page).toContain('tSimple');
    expect(page).toContain('SIMPLE_NS');
    expect(page).not.toMatch(/\{t\('news\.title'\)\}/);
  });

  it('апстримный `news.title` не осиротел — его печатает `aria-label` вкладок ленты', () => {
    // ⚠️ Задача #75 требует проверить это, а не поверить на слово: ключ
    // по-прежнему нужен апстримным локалям, поэтому убирать его оттуда нельзя,
    // даже если бы канон это разрешал.
    const feed = stripComments(read(FEED));
    expect(feed).toContain("aria-label={t('news.title')}");
  });

  it('наш текст отличается от апстримного — иначе переезд ключа был бы бессмысленным', () => {
    const upstreamRu = JSON.parse(read('src/locales/ru.json') || '{}') as {
      news?: { title?: string };
    };

    expect(typeof upstreamRu.news?.title, 'апстримный `news.title` пропал').toBe('string');
    expect(ruSimple.news.title).not.toBe(upstreamRu.news?.title);
    expect(ruSimple.news.title).toBe('Новости');
    // Английский закреплён наравне с русским: наши строки живут на двух языках
    // (канон, «Локали»), и «News and updates» вместо «News» — тот же дефект
    // #75, только на второй локали, где владелец его не увидит на стенде.
    expect(enSimple.news.title).toBe('News');
  });
});

describe('страница остаётся тонкой обёрткой (задача #74)', () => {
  it('лента приходит компонентом, а не переписана на странице', () => {
    expect(page).toContain("import { SimpleNewsSection } from '../components/news/NewsSection';");
    expect(existsSync(FEED)).toBe(true);
  });

  it('своего запроса новостей у страницы нет', () => {
    // Запрос живёт внутри ленты — поднять его сюда значило бы либо
    // продублировать, либо перекроить копию апстрима.
    expect(page).not.toContain('useQuery');
    expect(page).not.toContain('newsApi');
  });

  it('состояний ленты страница тоже не держит', () => {
    // Они внутри ленты, потому что там живёт запрос: у страницы нет ни `isError`,
    // ни `isLoading`, чтобы о них знать.
    expect(page).not.toContain('NewsFeedSkeleton');
    expect(page).not.toContain('NewsFeedError');
    expect(page).not.toContain('NewsFeedEmpty');
  });
});
