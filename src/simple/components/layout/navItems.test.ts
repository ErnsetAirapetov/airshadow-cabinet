import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isSimpleNavActive,
  resolveNavLabel,
  SIMPLE_BOTTOM_NAV_ITEMS,
  SIMPLE_NAV_ITEMS,
} from './navItems';

/**
 * Сторожа состава навигации простого режима (#66).
 *
 * Дефект, ради которого заведён файл: состав был записан ТРИЖДЫ — десктопное
 * меню, нижнее меню, бургер. Копии разъехались молча, при зелёной сборке: на
 * десктопе шесть пунктов, в бургере два. Владелец увидел это на стенде.
 *
 * Поэтому сторожей здесь две породы, и обе нужны:
 *
 *   1. **Импортом** — состав и производное подмножество. `navItems.ts` намеренно
 *      не импортирует ничего из `@/**` (ни иконок, ни `t`), и именно поэтому его
 *      можно прочитать тестом как есть. Тот же приём и по той же причине, что у
 *      `passthrough.ts`: `vitest.config.ts` апстримный (`environment: 'node'`,
 *      alias `@/` нет), и модуль с иконками в тест не втащить.
 *   2. **Текстом** — что потребители читают общий список, а НЕ держат своего
 *      перечня. Это и есть предмет задачи: дописать недостающие пункты в бургер
 *      третьим перечнем — значит через месяц разъехаться снова.
 *
 * Цена текстового приёма прежняя: разбор видит только литералы, поэтому у
 * каждого текстового сторожа есть пара «разбор удался».
 */
const shellSource = readFileSync('src/simple/components/layout/SimpleShell.tsx', 'utf8');
const headerSource = readFileSync('src/simple/components/layout/SimpleHeader.tsx', 'utf8');
const bottomSource = readFileSync('src/simple/components/layout/MobileBottomNav.tsx', 'utf8');
const iconsSource = readFileSync('src/simple/components/layout/navIcons.ts', 'utf8');

/**
 * Комментарии выбрасываем до поиска — иначе сторож бумажный.
 *
 * Все три потребителя объясняют своё поведение докстрингами, которые цитируют и
 * пути, и имена символов. Без этого шага цитаты в комментарии хватило бы, чтобы
 * сторож остался зелёным при потерянном коде. Тот же приём, что в
 * `passthrough.test.ts`, `entryPoint.test.ts` и `scripts/check-mode-boundaries.mjs`.
 */
function stripComments(code: string): string {
  return code
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const shellCode = stripComments(shellSource);
const headerCode = stripComments(headerSource);
const bottomCode = stripComments(bottomSource);
const iconsCode = stripComments(iconsSource);

/** Все три потребителя общего списка, по имени файла — для внятного отчёта. */
const consumers = [
  ['SimpleShell.tsx', shellCode],
  ['SimpleHeader.tsx', headerCode],
  ['MobileBottomNav.tsx', bottomCode],
] as const;

const navPaths = SIMPLE_NAV_ITEMS.map((item) => item.path);
const bottomPaths = SIMPLE_BOTTOM_NAV_ITEMS.map((item) => item.path);

describe('состав пунктов простого режима', () => {
  it('разбор удался — список прочитан импортом и непустой', () => {
    // Пара к сторожам ниже: пустой список делал бы их вечно зелёными.
    expect(SIMPLE_NAV_ITEMS.length).toBeGreaterThan(0);
  });

  it('список — ровно семь пунктов, назначенных владельцем', () => {
    // Сторож состава: сверка полная, а не «содержит». Добавление или удаление
    // пункта обязано быть осознанным и видным в дифе. Седьмым в #74 пришли
    // новости — только в меню, нижняя панель осталась четвёркой.
    expect([...navPaths]).toEqual([
      '/',
      '/subscriptions',
      '/balance',
      '/support',
      '/profile',
      '/info',
      '/news',
    ]);
  });

  it('подписи — ключи локали, а не готовый текст', () => {
    // В модуле нет `t`: он чистый, иначе его не прочитать импортом из теста
    // (alias `@/` в vitest нет). Значит подпись — ключ, и переводит потребитель.
    expect(SIMPLE_NAV_ITEMS.map((item) => item.labelKey)).toEqual([
      'nav.dashboard',
      'nav.subscription',
      'nav.balance',
      'nav.support',
      'nav.profile',
      'nav.info',
      // ⚠️ Имя то же, что у апстримного `news.title` («Новости и обновления»),
      // но с #75 это ключ НАШЕГО неймспейса (`ownLabel: true`, см. проверку
      // ниже) со своим текстом «Новости»: владелец потребовал именно так, а
      // подходящего апстримного ключа со значением «Новости» нет — есть только
      // `admin.nav.news` и `profile.notifications.news`, чужая семантика.
      'news.title',
    ]);
  });

  it('признак `ownLabel` стоит ровно у одного пункта — новостей (задача #75)', () => {
    // ⚠️ До #75 такого поля не было вовсе: подпись всегда читалась апстримным
    // `t`. Признак — это и есть механизм, которым потребители различают, каким
    // переводчиком печатать пункт, не держа своего списка путей и не заводя
    // ветку «если это новости» (см. проверки потребителей ниже).
    expect(
      SIMPLE_NAV_ITEMS.filter((item) => 'ownLabel' in item && item.ownLabel).map(
        (item) => item.path,
      ),
    ).toEqual(['/news']);
  });

  it('пути в списке не повторяются', () => {
    // Дубль ничего бы не сломал заметно — просто нарисовал бы пункт дважды.
    expect(navPaths).toHaveLength(new Set(navPaths).size);
  });
});

/**
 * Нижнее меню — ПОДМНОЖЕСТВО общего списка, а не свой перечень.
 *
 * До #66 это был четвёртый литеральный перечень путей. Признак в списке вместо
 * перечня — единственный способ сохранить свойство «нижнее меню не может
 * показать пункт, которого нет в меню».
 */
describe('нижнее меню — подмножество общего списка', () => {
  it('разбор удался — подмножество непустое', () => {
    expect(SIMPLE_BOTTOM_NAV_ITEMS.length).toBeGreaterThan(0);
  });

  it('те же четыре пункта, что стояли внизу до правки', () => {
    // Критерий приёмки: нижнее меню осталось прежним.
    expect([...bottomPaths]).toEqual(['/', '/subscriptions', '/balance', '/support']);
  });

  it('каждый пункт — тот же объект общего списка, а не копия', () => {
    // Сравнение по ссылке, а не по значению: копия объекта прошла бы сверку
    // путей и при этом снова стала бы вторым источником истины.
    const foreign = SIMPLE_BOTTOM_NAV_ITEMS.filter(
      (item) => !SIMPLE_NAV_ITEMS.some((known) => known === item),
    );

    expect(foreign).toEqual([]);
  });

  it('порядок сохранён относительно общего списка', () => {
    const expected = navPaths.filter((path) => bottomPaths.includes(path));

    expect([...bottomPaths]).toEqual(expected);
  });

  it('признак стоит ровно у четырёх пунктов — профиль, информация и новости только в меню', () => {
    // ⚠️ Прямая половина критерия «внизу по-прежнему четыре»: сверка выше говорит,
    // ЧТО стоит внизу, а эта — что всё остальное туда не просочилось.
    expect(SIMPLE_NAV_ITEMS.filter((item) => !item.inBottomNav).map((item) => item.path)).toEqual([
      '/profile',
      '/info',
      '/news',
    ]);
    expect(SIMPLE_BOTTOM_NAV_ITEMS).toHaveLength(4);
  });
});

/**
 * Главное требование владельца: «что в меню на десктопе, то и в мобилке
 * доступно для перехода. То что это дублируется в меню снизу — неважно».
 *
 * Проверяется не количество ссылок (тест не рендерит React — окружение `node`),
 * а то, что оба места перебирают ОДИН И ТОТ ЖЕ список ЦЕЛИКОМ. Пока это так,
 * наборы путей совпадают по построению, и разъехаться им нечем.
 */
describe('бургер и десктопное меню отдают одинаковый набор путей', () => {
  it('разбор удался — оба файла прочитаны и навигация в них найдена', () => {
    // Без пары переименование класса или файла дало бы вечно зелёные проверки.
    expect(shellCode).toContain('simple-desktop-nav-active');
    expect(headerCode).toContain('mobile-menu-content');
  });

  it('десктопное меню перебирает общий список целиком', () => {
    expect(shellCode).toContain('SIMPLE_NAV_ITEMS.map(');
    // Отсечь пункты фильтром — тот же дефект другими словами.
    expect(shellCode).not.toMatch(/SIMPLE_NAV_ITEMS\.(filter|slice)\(/);
  });

  it('бургер перебирает тот же общий список целиком', () => {
    // Мутация «убрать пункт из бургера» краснеет здесь и в стороже ниже.
    expect(headerCode).toContain('SIMPLE_NAV_ITEMS.map(');
    expect(headerCode).not.toMatch(/SIMPLE_NAV_ITEMS\.(filter|slice)\(/);
  });

  it('нижнее меню читает производное подмножество, а не фильтрует само', () => {
    expect(bottomCode).toContain('SIMPLE_BOTTOM_NAV_ITEMS.map(');
    expect(bottomCode).not.toContain('SIMPLE_NAV_ITEMS');
  });

  it('ни один потребитель не держит своего перечня путей', () => {
    // Сердце задачи. Литерал пути в потребителе — это и есть второй перечень,
    // с которого начался разъезд. `/` исключён: это ссылка логотипа в шапках,
    // а не пункт меню.
    const ownLiterals = consumers.flatMap(([name, code]) =>
      navPaths
        .filter((path) => path !== '/')
        .filter((path) => code.includes(`'${path}'`) || code.includes(`"${path}"`))
        .map((path) => `${name}: ${path}`),
    );

    expect(ownLiterals).toEqual([]);
  });

  it('объяснение «сюда не дублируются» переписано вместе с кодом', () => {
    // Читается СЫРОЙ текст, с комментариями: сторож ровно про комментарий.
    // Оставить объяснение противоположного решения — значит завести
    // документацию, которая спорит с реализацией. Фраз две: одна стояла в
    // докстринге файла, вторая — над самим `<nav>` ящика.
    expect(headerSource).not.toContain('сюда не дублируются');
    expect(headerSource).not.toContain('дублировать четыре кнопки');
  });
});

/**
 * Иконки живут отдельным модулем — он импортирует `@/components/icons`, а
 * значит в тест не втаскивается. Полноту карты сторожит не тест, а `tsc`:
 * `Record<SimpleNavPath, …>` не собирается, если у пункта нет иконки. Здесь
 * проверяется, что типизация именно такая, а не `Record<string, …>`.
 */
describe('иконки — по одной на пункт, полноту сторожит tsc', () => {
  it('разбор удался — файл иконок прочитан', () => {
    expect(iconsSource.length).toBeGreaterThan(100);
    expect(iconsCode).toContain('SIMPLE_NAV_ICONS');
  });

  it('карта иконок меню типизирована путями списка', () => {
    // `Record<string, …>` молча разрешил бы пункт без иконки.
    expect(iconsCode).toMatch(/SIMPLE_NAV_ICONS:\s*Record<SimpleNavPath,/);
  });

  it('иконки нижнего меню наследуются от меню, а не перечисляются заново', () => {
    // Иначе это снова копия, которая разъедется. Отличие ровно одно и оно
    // осознанное: у баланса внизу кошелёк, и нижнее меню осталось прежним.
    expect(iconsCode).toMatch(/SIMPLE_BOTTOM_NAV_ICONS:\s*Record<SimpleNavPath,/);
    expect(iconsCode).toContain('...SIMPLE_NAV_ICONS');
    expect(iconsCode).toMatch(/'\/balance':\s*WalletIcon/);
  });
});

/**
 * Каждый потребитель берёт СВОЮ карту иконок — сторож на потребителя, а не на
 * карту.
 *
 * Отличие карт ровно одно: у баланса внизу кошелёк, а в меню — карта. Оно и есть
 * та часть критерия «нижнее меню осталось прежним», которую карта сама
 * защитить не может: `SIMPLE_BOTTOM_NAV_ICONS` может стоять на месте и
 * оставаться верной, пока нижнее меню читает не её. Подмена карты в
 * `MobileBottomNav.tsx` не краснела ни в одном стороже — иконка баланса внизу
 * молча стала бы картой, и наоборот.
 *
 * Проверяется текстом: карты — значения с апстримным типом иконки, модуль
 * `navIcons.ts` импортирует `@/components/icons` и в тест импортом не втаскивается
 * (`environment: 'node'`, alias `@/` нет). Поэтому у сторожей ниже есть пара
 * «разбор удался».
 */
describe('каждое меню читает свою карту иконок', () => {
  it('разбор удался — во всех трёх потребителях найдено обращение к карте', () => {
    // Без пары переименование обеих карт оставило бы сторожей вечно зелёными.
    const withoutLookup = consumers
      .filter(([, code]) => !/NAV_ICONS\[/.test(code))
      .map(([name]) => name);

    expect(withoutLookup).toEqual([]);
  });

  it('нижнее меню берёт иконки нижнего меню', () => {
    expect(bottomCode).toContain('SIMPLE_BOTTOM_NAV_ICONS[');
    // Карта меню внизу дала бы балансу карту вместо кошелька — молча.
    expect(bottomCode).not.toContain('SIMPLE_NAV_ICONS');
  });

  it('десктопное меню и бургер берут иконки меню', () => {
    const wrongMap = consumers
      .filter(([name]) => name !== 'MobileBottomNav.tsx')
      .filter(
        ([, code]) => !code.includes('SIMPLE_NAV_ICONS[') || code.includes('BOTTOM_NAV_ICONS'),
      )
      .map(([name]) => name);

    expect(wrongMap).toEqual([]);
  });
});

/**
 * Предикат подсветки тоже был записан трижды, и третья копия — в бургере — до
 * #66 отличалась: без особого случая для `/`. Пока в бургере не было главной,
 * отличие ничего не портило; с шестью пунктами `startsWith('/')` подсветил бы
 * ВСЕ пункты сразу. Поэтому предикат общий.
 */
describe('isSimpleNavActive — один предикат на три места', () => {
  it('главная активна только точным совпадением', () => {
    expect(isSimpleNavActive('/', '/')).toBe(true);
    expect(isSimpleNavActive('/balance', '/')).toBe(false);
  });

  it('остальные пункты активны и на вложенном экране', () => {
    expect(isSimpleNavActive('/balance/top-up', '/balance')).toBe(true);
    expect(isSimpleNavActive('/subscriptions/12', '/subscriptions')).toBe(true);
  });

  it('чужой путь пункт не подсвечивает', () => {
    expect(isSimpleNavActive('/support', '/balance')).toBe(false);
    expect(isSimpleNavActive('/admin', '/profile')).toBe(false);
  });

  it('все три места зовут общий предикат, своего не объявляют', () => {
    const own = consumers
      .filter(([, code]) => !code.includes('isSimpleNavActive(') || /const isActive\b/.test(code))
      .map(([name]) => name);

    expect(own).toEqual([]);
  });
});

/**
 * Механизм подписи (#75): апстримный ключ и наш (`simple`) читаются двумя
 * разными переводчиками, и решает это признак `ownLabel` у пункта, а не путь и
 * не потребитель. `resolveNavLabel` — общая функция вместо копии условия в
 * каждом месте, тот же приём, что у `isSimpleNavActive` выше.
 */
describe('resolveNavLabel — один переводчик на признак, без ветки под новости', () => {
  /**
   * Потребители, обязанные звать `resolveNavLabel`, — весь список целиком.
   * `MobileBottomNav.tsx` сюда не входит намеренно: он берёт производное
   * подмножество, пунктов с `ownLabel` в нём нет, и это отдельно проверяется.
   */
  const labelConsumers = [
    ['SimpleShell.tsx', shellCode],
    ['SimpleHeader.tsx', headerCode],
  ] as const;

  const t = (key: string) => `upstream:${key}`;
  const tSimple = (key: string) => `simple:${key}`;

  it('пункт без `ownLabel` печатается апстримным `t`', () => {
    expect(resolveNavLabel({ labelKey: 'nav.balance' }, t, tSimple)).toBe('upstream:nav.balance');
  });

  it('пункт с `ownLabel: false` — тоже апстримным `t`', () => {
    expect(resolveNavLabel({ labelKey: 'nav.balance', ownLabel: false }, t, tSimple)).toBe(
      'upstream:nav.balance',
    );
  });

  it('пункт с `ownLabel: true` печатается нашим `tSimple`', () => {
    expect(resolveNavLabel({ labelKey: 'news.title', ownLabel: true }, t, tSimple)).toBe(
      'simple:news.title',
    );
  });

  it('на живом списке новости уходят в `tSimple`, остальные шесть — в `t`', () => {
    const resolved = SIMPLE_NAV_ITEMS.map((item) => resolveNavLabel(item, t, tSimple));

    expect(resolved).toEqual([
      'upstream:nav.dashboard',
      'upstream:nav.subscription',
      'upstream:nav.balance',
      'upstream:nav.support',
      'upstream:nav.profile',
      'upstream:nav.info',
      'simple:news.title',
    ]);
  });

  it('разбор удался — оба потребителя прочитаны и вызов функции в них найден', () => {
    // Пара к сторожу ниже: он ищет литерал вызова целиком, и на пустом или
    // непрочитанном файле остался бы вечно зелёным.
    for (const [name, code] of labelConsumers) {
      expect(code.length, name).toBeGreaterThan(100);
      expect(code, name).toContain('resolveNavLabel(');
    }
  });

  it('десктопное меню и бургер передают в общую функцию `t` и `tSimple` — в этом порядке', () => {
    // ⚠️ Мутации, которые ловит эта проверка:
    //   1. подмена вызова на копию условия в потребителе —
    //      `item.path === '/news' ? tSimple(item.labelKey) : t(item.labelKey)`:
    //      второй источник истины по одному пункту, разъедется с `navItems.ts`
    //      молча;
    //   2. ПЕРЕСТАНОВКА переводчиков — `resolveNavLabel(item, tSimple, t)`;
    //   3. один и тот же переводчик дважды — `resolveNavLabel(item, t, t)`.
    //
    // Мутации 2 и 3 `tsc` не поймает в принципе: оба параметра объявлены как
    // `(key: string) => string`, любая их комбинация типизируется, сборка
    // зелёная. А на экране пункт «Новости» молча превращается в апстримные
    // «Новости и обновления» — ровно тот дефект, который чинит #75. Поэтому
    // сверяется литерал вызова целиком, а не имя функции: проверка на
    // `includes('resolveNavLabel(')` подмену переводчиков не видит.
    //
    // Нижнее меню сюда не входит: `MobileBottomNav.tsx` печатает подпись сам
    // апстримным `t` — про него отдельная проверка ниже.
    //
    // Хвостовая запятая допущена намеренно: разбитый переносами вызов biome
    // обратно в строку не схлопывает из-за magic trailing comma, и без `,?`
    // сторож краснел бы на чистом переформатировании — чинить пришлось бы его,
    // а не код. Чего регулярка по-прежнему не переживёт: переименования `item`
    // или `tSimple` и четвёртого аргумента. Это не дефект: отличить такую
    // правку от ПОТЕРИ вызова помогает парный «разбор удался» выше — он
    // остаётся зелёным, пока `resolveNavLabel(` в обоих потребителях на месте.
    const CALL = /resolveNavLabel\(\s*item\s*,\s*t\s*,\s*tSimple\s*,?\s*\)/;

    const wrong = labelConsumers.filter(([, code]) => !CALL.test(code)).map(([name]) => name);

    expect(wrong).toEqual([]);
  });

  it('в нижнем меню нет пунктов с `ownLabel` — оно печатает подпись мимо функции', () => {
    // `MobileBottomNav.tsx` про `ownLabel` не знает: подпись там берётся
    // апстримным `t` напрямую. Пункт с нашим ключом внизу дал бы апстримный
    // текст молча, при зелёной сборке — тот же дефект, что чинит #75, только
    // на другом экране. Пока таких пунктов внизу нет, это безопасно; прежде чем
    // снимать проверку — научи нижнее меню звать `resolveNavLabel`.
    expect(SIMPLE_BOTTOM_NAV_ITEMS.filter((item) => 'ownLabel' in item && item.ownLabel)).toEqual(
      [],
    );
  });

  it('ни один потребитель не решает по пути или по имени ключа новостей', () => {
    // Литерал `/news` или `news.title` в условии потребителя — это и есть
    // запрещённая канон-ом «ветка если это новости»: она разъедется с составом
    // `navItems.ts` молча при следующем ключе с `ownLabel`.
    const branching = consumers
      .filter(
        ([, code]) =>
          /path\s*===?\s*['"]\/news['"]/.test(code) ||
          /labelKey\s*===?\s*['"]news\.title['"]/.test(code),
      )
      .map(([name]) => name);

    expect(branching).toEqual([]);
  });
});
