import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторож расхождения простой ленты новостей с апстримной (задача #74).
 *
 * `src/simple/components/news/NewsSection.tsx` — копия апстримного
 * `src/components/news/NewsSection.tsx`: гейт границ не пускает простой режим в
 * `src/components/news/**`, а расширять гейт канон запрещает. Копия живая —
 * апстрим правит оригинал каждый синк, сборка при этом остаётся зелёной, и
 * простая лента молча остаётся вчерашней.
 *
 * ⚠️ Сторож НЕ довольствуется набором «ключевые ветки на месте». Такая проверка
 * краснеет, только если апстрим что-то УДАЛИТ, и молчит на правке разметки,
 * классов, порядка узлов и параметров запроса — то есть на самом частом виде
 * дрейфа. Поэтому здесь сверяется весь файл, декларация за декларацией, после
 * нормализации (комментарии и пути импортов законно различаются). Именные
 * проверки внизу оставлены не вместо этого, а рядом: они называют словами то,
 * что перечислено в спеке задачи, и служат парой «разбор удался» для сверки.
 *
 * ⚠️ Сознательных расхождений с апстримом два: состояния ленты (скелетон, ошибка,
 * пусто) и снятый заголовок-чип. Оба размечены в копии маркерами
 * `ФОРК: НАЧАЛО/КОНЕЦ РАСХОЖДЕНИЯ`; сторож вырезает обе области перед сверкой и
 * отдельно пришпиливает содержимое каждой целиком — иначе маркеры стали бы дырой,
 * куда можно спрятать любую правку. Апстримные куски, на месте которых эти области
 * стоят (`if (items.length === 0) return null;` и разметка чипа), вырезаются из
 * апстримного тела по литеральным образцам: перепишет апстрим любой из них —
 * вырезание не совпадёт, и тест покраснеет с явным сообщением, а не промолчит.
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются: `vitest.config.ts` апстримный
 * (`environment: 'node'`), alias `@/` в тестах не резолвится, и импорт копии
 * потянул бы весь граф приложения. Цена приёма прежняя — разбор видит только
 * записанное литералом, поэтому у каждой проверки есть парная «разбор удался».
 * Тот же приём и та же причина, что в `supportCopies.test.ts`.
 */

const UPSTREAM = 'src/components/news/NewsSection.tsx';
const COPY = 'src/simple/components/news/NewsSection.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны: копия несёт свой заголовок и свои пояснения. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Приводит текст к виду, в котором копия и оригинал обязаны совпасть.
 *
 * Законных различий два, и каждое закрыто своей нормализацией: путь импорта
 * сводится к имени модуля (копия ходит через alias `@/`, оригинал —
 * относительными путями, модуль один и тот же) и комментарии вырезаются.
 * Пробелы схлопнуты — иначе сторож ловил бы переносы строк вместо кода.
 */
function normalize(source: string): string {
  return collapse(stripComments(source).replace(/from '[^']*\/([^'/]+)'/g, "from '<$1>'"));
}

/**
 * Схлопывает пробелы. Отдельно от `normalize`, потому что вырезание апстримного
 * чипа идёт уже по нормализованному тексту и оставляет за собой двойной пробел.
 */
function collapse(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

/**
 * Верхнеуровневые декларации файла: имя → текст от строки объявления до
 * следующего такого объявления.
 *
 * Разбор по колонке нуля: внутри функций и JSX всё в этом файле с отступом
 * (форматирование держит prettier), поэтому объявление в первой колонке — всегда
 * верхнеуровневое. Всё до первой декларации — импорты и докстринг файла — уходит
 * в остаток и в сверку не попадает: там законно различается больше, чем можно
 * нормализовать. Состав импортов проверяется отдельно, ниже.
 */
function declarations(source: string): Map<string, string> {
  const lines = source.split('\n');
  const starts: { name: string; line: number }[] = [];

  lines.forEach((line, index) => {
    const found = /^(?:export\s+(?:default\s+)?)?(?:const|function|interface|type)\s+(\w+)/.exec(
      line,
    );
    if (found) {
      starts.push({ name: found[1], line: index });
    }
  });

  const out = new Map<string, string>();
  starts.forEach(({ name, line }, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].line : lines.length;
    out.set(name, lines.slice(line, end).join('\n'));
  });

  return out;
}

/** Имена, импортированные файлом, — без путей: пути у копии законно другие. */
function importedNames(source: string): Set<string> {
  const out = new Set<string>();
  for (const found of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
    for (const name of found[1].split(',')) {
      const clean = name.trim();
      if (clean) out.add(clean);
    }
  }
  return out;
}

/** Тело функции — от открывающей фигурной скобки: подписи у копии и оригинала разные. */
function body(chunk: string): string {
  const start = chunk.indexOf('{');
  return start === -1 ? '' : chunk.slice(start);
}

/**
 * Аргумент `useQuery({ … })` целиком, со сбалансированными скобками.
 *
 * Регуляркой не берётся: внутри вложенные объекты и стрелки. Балансировка,
 * как в `supportCopies.test.ts`.
 */
function queryOptions(source: string): string {
  const marker = 'useQuery({';
  const start = source.indexOf(marker);
  if (start === -1) return '';

  let depth = 0;
  for (let i = start + marker.length - 1; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return normalize(source.slice(start, i + 1));
    }
  }

  return '';
}

/** Ветка апстрима, на месте которой в копии стоят состояния. */
const UPSTREAM_EMPTY_GUARD = /if \(items\.length === 0\) \{\s*return null;\s*\}/;

/**
 * Заголовочная строка-чип апстримного блока — та, на месте которой в копии пусто.
 *
 * Пришпилена дословно, а не образцом с «чем-нибудь посередине»: допиши апстрим
 * внутрь чипа что-то ещё — счётчик, ссылку, — образец вырезал бы это молча вместе
 * с чипом. Дословный литерал в такой ситуации не совпадёт, и человек посмотрит
 * сам, не переехало ли в чип что-то нужное.
 */
const UPSTREAM_HEADER_CHIP = normalize(`
  <div className="mb-2 flex items-center gap-2.5">
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-400 to-accent-600">
      <NewsIcon className="h-[18px] w-[18px] text-dark-950" />
    </div>
    <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-dark-500">
      {t('news.title')}
    </span>
  </div>
`);

/**
 * Размеченные области расхождения копии — вместе с маркерами.
 *
 * Форм две, потому что расхождения стоят в разных местах: между инструкциями
 * (состояния) маркеры — обычные комментарии, внутри JSX (снятый чип) — узел
 * комментария в фигурных скобках. Скобки узла съедаются вместе с комментарием:
 * останься они, копия несла бы лишнюю пару скобок там, где у апстрима разметка.
 */
const FORK_DIVERGENCE =
  /\{\/\*\s*ФОРК: НАЧАЛО[\s\S]*?ФОРК: КОНЕЦ РАСХОЖДЕНИЯ \*\/\}|\/\*\s*ФОРК: НАЧАЛО[\s\S]*?ФОРК: КОНЕЦ РАСХОЖДЕНИЯ \*\//g;

/** Имена апстримных импортов, которых в копии нет: их держал только снятый чип. */
const DROPPED_IMPORTS = ['NewsIcon'];

/**
 * Деструктуризация результата `useQuery` — единственная строка тела, которая у
 * копии законно шире апстримной (`isError` и `refetch` нужны состояниям).
 * Маскируется в обоих файлах, а разница проверяется отдельной именной проверкой.
 */
const QUERY_RESULT = /const \{[^}]*\} = useQuery\(/;

const upstreamSource = read(UPSTREAM);
const copySource = read(COPY);

const upstreamDecls = declarations(upstreamSource);
const copyDecls = declarations(copySource);

/** Имя главного компонента у копии своё — остальные декларации совпадают по именам. */
const MAIN_UPSTREAM = 'NewsSection';
const MAIN_COPY = 'SimpleNewsSection';

const upstreamMain = upstreamDecls.get(MAIN_UPSTREAM) ?? '';
const copyMain = copyDecls.get(MAIN_COPY) ?? '';

const divergences = copyMain.match(FORK_DIVERGENCE) ?? [];

/** Тела главного компонента, приведённые к сравнимому виду. */
const upstreamMainBody = collapse(
  normalize(
    body(upstreamMain)
      .replace(UPSTREAM_EMPTY_GUARD, '')
      .replace(QUERY_RESULT, 'const <QUERY_RESULT> = useQuery('),
  ).replace(UPSTREAM_HEADER_CHIP, ''),
);
const copyMainBody = normalize(
  body(copyMain)
    .replace(FORK_DIVERGENCE, '')
    .replace(QUERY_RESULT, 'const <QUERY_RESULT> = useQuery('),
);

describe('разбор копии ленты новостей удался (задача #74)', () => {
  it('оба файла на месте и непусты', () => {
    // Без этого удалённый или переименованный файл дал бы пустые строки, и
    // сравнения ниже сверяли бы пустоту с пустотой.
    expect(upstreamSource.length, UPSTREAM).toBeGreaterThan(10000);
    expect(copySource.length, COPY).toBeGreaterThan(10000);
  });

  it('нормализация схлопывает законные различия и НЕ схлопывает код', () => {
    // Пара «разбор удался» для самой нормализации.
    expect(normalize("import { X } from '../../api/news';")).toBe(
      normalize("import { X } from '@/api/news';"),
    );
    expect(normalize('/* заголовок копии */ const a = 1;')).toBe('const a = 1;');
    expect(normalize('const a = 1;')).not.toBe(normalize('const a = 2;'));
  });

  it('декларации разобраны — и в апстриме, и в копии их больше десятка', () => {
    // Сломайся разбор по колонке нуля — сверка составов ниже проходила бы на
    // двух пустых картах, ничего не охраняя.
    expect(upstreamDecls.size).toBeGreaterThan(10);
    expect(copyDecls.size).toBe(upstreamDecls.size);
    expect(upstreamDecls.get('NewsCard')).toContain('motion.article');
  });

  it('тела главного компонента выделены и непусты', () => {
    expect(upstreamMain).toContain('useQuery(');
    expect(copyMain).toContain('useQuery(');
    expect(upstreamMainBody.length).toBeGreaterThan(500);
    expect(copyMainBody.length).toBeGreaterThan(500);
  });

  it('ветка апстрима «нечего показывать» найдена по образцу', () => {
    // ⚠️ Пара «разбор удался» ДЛЯ ВЫРЕЗАНИЯ. Апстрим перепишет эту ветку —
    // вырезать станет нечего, тела перестанут совпадать, и тест покраснеет
    // здесь же с внятным сообщением. Это и есть нужное поведение: расхождение
    // ровно на том месте, где мы сознательно разошлись, обязано быть замечено
    // человеком, а не переехать молча.
    expect(
      UPSTREAM_EMPTY_GUARD.test(body(upstreamMain)),
      'апстрим переписал ветку `items.length === 0` — сверьте состояния копии вручную',
    ).toBe(true);
  });

  it('заголовок-чип апстрима найден дословно', () => {
    // ⚠️ Пара «разбор удался» ДЛЯ ВТОРОГО ВЫРЕЗАНИЯ, с той же логикой, что у
    // ветки выше: перепишет апстрим чип — вырезать станет нечего, тела перестанут
    // совпадать, и решать, что с этим делать, будет человек.
    expect(
      normalize(body(upstreamMain)).includes(UPSTREAM_HEADER_CHIP),
      'апстрим переписал заголовок-чип ленты — сверьте расхождение копии вручную',
    ).toBe(true);
    expect(UPSTREAM_HEADER_CHIP).toContain("{t('news.title')}");
  });

  it('областей расхождения в копии две и обе размечены обоими маркерами', () => {
    // Больше или меньше двух — значит разметка поехала, и сверка тел ниже стала бы
    // сравнивать не то, что задумано.
    expect(divergences).toHaveLength(2);
    for (const region of divergences) {
      expect(region).toContain('ФОРК: НАЧАЛО');
      expect(region).toContain('ФОРК: КОНЕЦ РАСХОЖДЕНИЯ');
    }
  });
});

describe('копия ленты совпадает с апстримной (задача #74)', () => {
  it('состав деклараций тот же — ни одна не потеряна и ни одна не дописана', () => {
    // Апстрим добавит подкомпонент — здесь и покраснеет. Наши состояния живут
    // отдельным файлом (`NewsFeedStates.tsx`) именно ради этого: в копии не
    // должно быть НИ ОДНОЙ нашей декларации.
    const renamed = [...upstreamDecls.keys()].map((name) =>
      name === MAIN_UPSTREAM ? MAIN_COPY : name,
    );

    expect([...copyDecls.keys()]).toEqual(renamed);
  });

  it('каждая декларация, кроме главного компонента, совпадает дословно', () => {
    // Сердце сторожа: `safeColor`, анимации, `CategoryBadge`, `TagBadge`,
    // `FilterTabs`, `FeaturedCard`, `NewsCard`, `NewsCardWrapper`, `NEWS_LIMIT` —
    // всё сверяется целиком, вместе с классами и разметкой.
    const drifted = [...upstreamDecls.entries()]
      .filter(([name]) => name !== MAIN_UPSTREAM)
      .filter(([name, chunk]) => normalize(copyDecls.get(name) ?? '') !== normalize(chunk))
      .map(([name]) => name);

    expect(drifted, 'апстрим изменил эти декларации — перенесите правку в копию').toEqual([]);
  });

  it('тело главного компонента совпадает вне области расхождения', () => {
    // Хуки, мемоизация, обработчики и вся разметка секции — дословно апстримные.
    expect(copyMainBody).toBe(upstreamMainBody);
  });

  it('оба компонента по-прежнему без пропов', () => {
    // Апстримный блок самодостаточен — сам делает запрос и держит фильтр. Появись
    // у него пропы, «тонкая обёртка» страницы перестала бы быть тонкой.
    expect(upstreamMain).toMatch(/function NewsSection\(\) \{/);
    expect(copyMain).toMatch(/function SimpleNewsSection\(\) \{/);
  });

  it('набор импортируемых имён апстрима есть в копии — кроме имён снятого чипа', () => {
    // Импорты в сверку тел не попадают (пути законно разные), а потерянный
    // импорт — это потерянная возможность: копия молча осталась бы без нового
    // хука или иконки, которые апстрим начал использовать.
    const upstreamNames = importedNames(upstreamSource);
    const copyNames = importedNames(copySource);

    expect(upstreamNames.size).toBeGreaterThan(5);
    expect(
      [...upstreamNames].filter((name) => !copyNames.has(name) && !DROPPED_IMPORTS.includes(name)),
      'апстрим импортирует это, а копия — нет',
    ).toEqual([]);

    // ⚠️ Исключение узкое с ОБЕИХ сторон: слева — что имя вправду апстримное
    // (иначе список прикрывал бы пустоту), справа — что копия его действительно
    // не импортирует. Вернись `NewsIcon` в копию, и список стал бы разрешением
    // держать неиспользуемый импорт.
    expect(DROPPED_IMPORTS.filter((name) => !upstreamNames.has(name))).toEqual([]);
    expect(DROPPED_IMPORTS.filter((name) => copyNames.has(name))).toEqual([]);
  });
});

describe('ключевые ветки ленты — поимённо (задача #74)', () => {
  const copyCode = stripComments(copySource);
  const upstreamCode = stripComments(upstreamSource);

  it('запрос и его параметры совпадают', () => {
    // ⚠️ Именно объект параметров, а не факт вызова: смена `queryKey` разъехала
    // бы кеш простой и экспертной ленты, а смена `staleTime` — их свежесть.
    expect(queryOptions(upstreamCode)).toContain("queryKey: ['news', 'list'");
    expect(queryOptions(copyCode)).toBe(queryOptions(upstreamCode));
  });

  it('шаг «Загрузить ещё» — тот же', () => {
    expect(upstreamCode).toContain('const NEWS_LIMIT = 6;');
    expect(copyCode).toContain('const NEWS_LIMIT = 6;');
  });

  it('карточка ведёт на апстримный адрес статьи', () => {
    // Адрес — половина сквозного перехода: вторая половина, `/news/:slug` в
    // `passthrough.ts`, сторожится в `passthrough.test.ts`.
    // Сторожа читают ИСХОДНИК текстом, поэтому подстановка здесь — часть искомой
    // строки, а не выражение. Правило biome про неё справедливо в общем случае и
    // не про этот.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: искомая подстрока исходника
    expect(upstreamCode).toContain('navigate(`/news/${slug}`)');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: искомая подстрока исходника
    expect(copyCode).toContain('navigate(`/news/${slug}`)');
  });

  it('фильтр категорий и featured-ветка на месте', () => {
    for (const [name, code] of [
      [UPSTREAM, upstreamCode],
      [COPY, copyCode],
    ] as const) {
      expect(code, name).toContain('<FilterTabs categories={categories}');
      expect(code, name).toContain('items.find((n) => n.is_featured)');
      expect(code, name).toContain('{featured && <FeaturedCard');
    }
  });
});

describe('состояния ленты — первое расхождение с апстримом (задача #74)', () => {
  it('первая область содержит ровно три ветки состояний и ничего больше', () => {
    // ⚠️ Без этой проверки маркеры были бы дырой: под видом «состояний» в них
    // можно было бы спрятать любую правку копии, и сверка тел выше её не увидела
    // бы — область-то вырезается. Поэтому содержимое пришпилено целиком.
    expect(normalize(divergences[0] ?? '')).toBe(
      'if (isLoading && items.length === 0) { return <NewsFeedSkeleton />; } ' +
        'if (isError) { return <NewsFeedError onRetry={() => void refetch()} />; } ' +
        'if (items.length === 0) { return <NewsFeedEmpty />; }',
    );
  });

  it('копия деструктурирует isError и refetch, а апстрим — нет', () => {
    // Обе стороны утверждения нужны: апстримная лента упавший запрос от пустого
    // ответа не отличает вовсе, и как только начнёт — расхождение надо пересмотреть.
    const upstreamHead = QUERY_RESULT.exec(stripComments(upstreamSource))?.[0] ?? '';
    const copyHead = QUERY_RESULT.exec(stripComments(copySource))?.[0] ?? '';

    expect(upstreamHead).toContain('data');
    expect(upstreamHead).not.toContain('isError');
    expect(copyHead).toContain('isError');
    expect(copyHead).toContain('refetch');
  });

  it('состояния живут отдельным файлом, а не внутри копии', () => {
    // Чем меньше нашего в копии, тем больше сторож умеет сверять побайтово.
    expect(copySource).toContain(
      "import { NewsFeedEmpty, NewsFeedError, NewsFeedSkeleton } from './NewsFeedStates';",
    );
    expect(existsSync('src/simple/components/news/NewsFeedStates.tsx')).toBe(true);
    // `tSimple` в копии быть не должно: наши строки печатают состояния.
    expect(stripComments(copySource)).not.toContain('tSimple');
  });

  it('у апстрима на все три случая один ответ — `return null`', () => {
    // ⚠️ Посылка решения, а не украшение: наши состояния существуют ровно
    // потому, что апстрим пустоту, загрузку и ошибку не различает. Заведёт он
    // свои — расхождение надо будет пересматривать, а не тихо держать своё.
    // Ловится счётом: второй ранний возврат в апстримном компоненте и есть
    // признак появившегося состояния.
    const upstreamBody = stripComments(body(upstreamMain));

    expect(upstreamBody.match(/return null;/g) ?? []).toHaveLength(1);
    expect(upstreamBody).not.toContain('isError');
  });
});

describe('снятый заголовок-чип — второе расхождение с апстримом (задача #74)', () => {
  it('вторая область пуста — кода в ней нет вовсе', () => {
    // Расхождение-удаление: от чипа осталась только разметка границ, а `{}` —
    // это всё, что после нормализации остаётся от пустого узла JSX-комментария.
    // Спрячь кто-нибудь строку кода внутрь маркеров — покраснеет здесь, ровно
    // как у первой области, содержимое которой пришпилено выше.
    expect(normalize(divergences[1] ?? '')).toBe('{}');
  });

  it('чипа в копии нет ни в каком виде', () => {
    // Сверка тел выше вырезает область у копии и чип у апстрима, поэтому сама по
    // себе она не заметила бы чип, переехавший в копии в другое место.
    expect(normalize(copySource)).not.toContain(UPSTREAM_HEADER_CHIP);
    expect(stripComments(copySource)).not.toContain('NewsIcon');
  });

  it('заголовок ленты печатает апстрим, а копия — нет', () => {
    // ⚠️ Это и есть причина расхождения: на отдельной странице тем же ключом
    // подписан `h1` (`src/simple/pages/News.tsx`), и чип печатал бы «Новости»
    // второй раз на том же экране. Обе стороны утверждения нужны: перестань
    // апстрим печатать заголовок сам — расхождение надо пересматривать.
    expect(normalize(body(upstreamMain))).toContain("{t('news.title')}");
    expect(copyMainBody).not.toContain("t('news.title')");

    // А в `FilterTabs` тот же ключ остаётся подписью списка вкладок для
    // скринридера — это апстримная строка, и на экране её не видно.
    expect(normalize(copyDecls.get('FilterTabs') ?? '')).toContain("aria-label={t('news.title')}");
  });

  it('вместе с чипом не ушли ни табы категорий, ни отступ блока', () => {
    // Чип сидел в одном узле с фильтром категорий, и на этом же узле держится
    // отступ до сетки карточек — унеси их заодно, и лента осталась бы без
    // фильтра, а страница — со слипшимися блоками.
    expect(copyMainBody).toContain('className="mb-8"');
    expect(copyMainBody).toContain('<FilterTabs categories={categories} active={filter}');
  });
});
