import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа раскола страницы поддержки (задача #63).
 *
 * Задача была про РАЗДЕЛЕНИЕ, а не про упрощение: сегодняшняя страница форка
 * уехала копией в `src/simple/pages/Support.tsx`, а апстримный
 * `src/pages/Support.tsx` вернулся к `upstream/main`. Накопил форк в апстримном
 * файле ровно одну правку — карточку «Ответы на частые вопросы» со ссылкой на
 * `/info`, — и потеряться она может молча в обе стороны: вернувшись в
 * экспертный режим (тогда откат неполон) или исчезнув из копии (тогда стенд
 * стал беднее, а сборка зелёная).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются. Компонентных тестов в проекте
 * не бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не резолвится — импорт
 * страницы потянул бы весь граф приложения и упал бы на разрешении модулей. Тот
 * же приём, что в `subscriptionPage.test.ts`; цена та же — разбор видит только
 * записанное литералом, поэтому у каждой проверки ниже есть парная «разбор
 * удался».
 *
 * Пара здесь устроена сильнее обычного: каждое утверждение «в апстриме этого
 * нет» стоит рядом с утверждением «а в копии это есть», и наоборот. Проверка
 * «нет подстроки» проходит и на пустой строке, и на переименованном файле —
 * соседняя проверка не даёт стороже охранять пустоту.
 */

const PAGE = 'src/simple/pages/Support.tsx';
/** Апстримная страница — она же ожидаемый результат отката. */
const UPSTREAM = 'src/pages/Support.tsx';
const REGISTRY = 'src/simple/routes.tsx';

const UPSTREAM_LOCALES = ['ru', 'en', 'fa', 'zh'].map((lng) => `src/locales/${lng}.json`);
const SIMPLE_LOCALES = ['ru', 'en'].map((lng) => `src/simple/locales/${lng}.json`);

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны — разбор смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const page = stripComments(read(PAGE));
const upstream = stripComments(read(UPSTREAM));
const registry = read(REGISTRY);

/** `support` из JSON локали; `{}` — если файла или ветки нет. */
function supportKeys(path: string): Record<string, unknown> {
  const raw = read(path);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as { support?: Record<string, unknown> };
  return parsed.support ?? {};
}

describe('разбор удался (задача #63)', () => {
  it('обе страницы прочитаны и не пусты', () => {
    // Без этого файл, переименованный или удалённый, дал бы пустую строку — и
    // все проверки «этого здесь нет» проходили бы, ничего не охраняя.
    expect(page.length).toBeGreaterThan(10_000);
    expect(upstream.length).toBeGreaterThan(10_000);
  });

  it('копия — простая страница поддержки, а не что-то другое', () => {
    expect(page).toContain('export function SimpleSupport()');
  });

  it('апстримная страница осталась апстримной по форме экспорта', () => {
    expect(upstream).toContain('export default function Support()');
  });

  it('обе страницы — про тикеты, а не однофамильцы', () => {
    // Пара для проверок ниже: они смотрят на содержимое страницы поддержки, и
    // подмена файла чем-то посторонним оставила бы их зелёными.
    expect(page).toContain("t('support.title')");
    expect(upstream).toContain("t('support.title')");
    expect(page).toContain('<MessageMediaGrid');
    expect(upstream).toContain('<MessageMediaGrid');
  });
});

describe('карточка FAQ живёт в копии (задача #63)', () => {
  it('ссылка на /info и обе подписи на месте', () => {
    expect(page).toContain('<Link to="/info"');
    expect(page).toContain("tSimple('support.faqLinkTitle')");
    expect(page).toContain("tSimple('support.faqLinkHint')");
  });

  it('карточка стоит ПЕРЕД формой обращения, как на сегодняшнем стенде', () => {
    // Смысл правки — «типовые вопросы решаются без тикета». Съехав ниже формы,
    // карточка перестаёт работать: человек уже пишет обращение.
    const faq = page.indexOf('<Link to="/info"');
    const form = page.indexOf("t('support.yourTickets')");

    // Разбор удался: обе точки найдены, иначе сравнение индексов бессмысленно.
    expect(faq).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(-1);
    expect(faq).toBeLessThan(form);
  });

  it('подписи читаются из НАШЕГО неймспейса, а не из апстримного', () => {
    // ⚠️ Дыра, описанная в #58: подмена `useTranslation(SIMPLE_NS)` на
    // `useTranslation()` оставляла все сторожа зелёными, а на экране печатался
    // сырой ключ. Поэтому проверяется не только литерал ключа, но и привязка.
    expect(page).toContain("import { SIMPLE_NS } from '../i18n'");
    expect(page).toContain('useTranslation(SIMPLE_NS)');
    expect(page).toContain('const { t: tSimple } = useTranslation(SIMPLE_NS)');

    // И обратное: ключи карточки не должны читаться апстримным `t`, иначе после
    // удаления их из апстримных локалей на экране будет сырой ключ.
    expect(page).not.toContain("t('support.faqLinkTitle')");
    expect(page).not.toContain("t('support.faqLinkHint')");
  });

  it('всё остальное на странице продолжает читаться из апстримного неймспейса', () => {
    // Спека: в наш неймспейс уезжают только два ключа нашего патча. Уехавшая
    // следом апстримная строка означала бы, что мы начали дублировать локали.
    expect(page).toContain('const { t } = useTranslation();');

    const ourKeys = [...page.matchAll(/tSimple\('([^']+)'/g)].map((found) => found[1]);

    expect(ourKeys.sort()).toEqual(['support.faqLinkHint', 'support.faqLinkTitle']);
  });
});

describe('копия ходит в наш слой, а не за границу (задача #63)', () => {
  it('Card, transitions и галерея вложений берутся из src/simple/components', () => {
    // Гейт границ это же проверяет и валит сборку, но там сообщение общее.
    // Здесь — адресно: видно, какая именно копия перестала использоваться.
    expect(page).toContain("from '../components/data-display/Card'");
    expect(page).toContain("from '../components/motion/transitions'");
    expect(page).toContain("from '../components/tickets/MessageMediaGrid'");
  });

  it('апстримных адресов этих трёх в копии не осталось', () => {
    expect(page).not.toContain("from '@/components/data-display/Card'");
    expect(page).not.toContain("from '@/components/motion/transitions'");
    expect(page).not.toContain("from '@/components/tickets/MessageMediaGrid'");
  });

  it('апстримная страница по-прежнему ходит к апстримным оригиналам', () => {
    // Пара к проверке выше: границы задачи запрещают править `src/components/**`
    // и трогать апстримные импорты, откат обязан вернуть именно их.
    expect(upstream).toContain("from '@/components/data-display/Card'");
    expect(upstream).toContain("from '@/components/motion/transitions'");
    expect(upstream).toContain("from '../components/tickets/MessageMediaGrid'");
  });
});

describe('экспертный режим откачен к апстриму (задача #63)', () => {
  it('в апстримной странице нет ни ключей карточки, ни ссылки на /info', () => {
    expect(upstream).not.toContain('faqLinkTitle');
    expect(upstream).not.toContain('faqLinkHint');
    expect(upstream).not.toContain('to="/info"');
  });

  it('в апстримной странице нет импортов, которые тянула карточка', () => {
    // `InfoIcon`, `ArrowRightIcon` и `Link` пришли в апстримный файл вместе с
    // карточкой и уходят вместе с ней. Оставшийся импорт — признак недоотката:
    // сборка зелёная, а расхождение с апстримом живёт дальше.
    expect(upstream).not.toContain('InfoIcon');
    expect(upstream).not.toContain('ArrowRightIcon');
    expect(upstream).not.toContain("from 'react-router'");
  });

  it('в копии всё это есть — иначе проверки выше охраняли бы пустоту', () => {
    expect(page).toContain('InfoIcon');
    expect(page).toContain('ArrowRightIcon');
    expect(page).toContain("from 'react-router'");
  });

  it('откат не задел апстримную механику страницы', () => {
    // Пара «файл не выпотрошен»: то, что было в апстриме и должно там остаться.
    expect(upstream).toContain('staggerContainer');
    expect(upstream).toContain("t('support.createTicket')");
    expect(upstream).toContain('resolveSupportContact');
  });
});

describe('ключи карточки переехали в наш неймспейс (задача #63)', () => {
  it('разбор локалей удался — ветка support читается во всех шести файлах', () => {
    // Без этого битый путь или сломанный JSON дал бы пустой объект, и проверки
    // «ключа нет» проходили бы всегда.
    for (const path of UPSTREAM_LOCALES) {
      expect(Object.keys(supportKeys(path)).length, path).toBeGreaterThan(10);
      expect(supportKeys(path).title, path).toBeTruthy();
    }
    for (const path of SIMPLE_LOCALES) {
      expect(Object.keys(supportKeys(path)).length, path).toBeGreaterThan(0);
    }
  });

  it('в апстримных локалях всех четырёх языков наших ключей нет', () => {
    // Канон, раздел «Локали»: апстримные `ru/en/fa/zh.json` не трогаем — они
    // конфликтуют на каждом синке, потому что апстрим постоянно добавляет ключи.
    for (const path of UPSTREAM_LOCALES) {
      expect(supportKeys(path).faqLinkTitle, path).toBeUndefined();
      expect(supportKeys(path).faqLinkHint, path).toBeUndefined();
    }
  });

  it('в наших локалях оба ключа есть на обоих языках', () => {
    for (const path of SIMPLE_LOCALES) {
      expect(supportKeys(path).faqLinkTitle, path).toBeTruthy();
      expect(supportKeys(path).faqLinkHint, path).toBeTruthy();
    }
  });
});

describe('запись реестра (задача #63)', () => {
  it('разбор реестра удался', () => {
    expect(registry.length).toBeGreaterThan(1000);
    expect(registry).toContain('export const simpleRoutes');
  });

  it('/support зарегистрирован строковым литералом в одну строку', () => {
    // ⚠️ Требование самого реестра: сторож покрытия в `routes.test.tsx` читает
    // файл текстом, и путь, собранный из переменной, он не увидит.
    expect(registry).toContain("{ path: '/support', component: SimpleSupport }");
    expect(registry).toContain("import { SimpleSupport } from './pages/Support'");
  });
});

describe('переход из колокольчика /support?ticket=<id> (задача #63)', () => {
  it('колокольчик по-прежнему ведёт на /support с параметром запроса', () => {
    // Пара «разбор удался» для проверки ниже: пропади этот переход из апстрима,
    // и охранять было бы нечего.
    const bell = read('src/components/TicketNotificationBell.tsx');

    expect(bell).toContain('/support?ticket=');
  });

  it('копия обращается с параметром так же, как апстрим, — никак', () => {
    // ⚠️ Апстримная страница параметр `ticket` НЕ читает: он остаётся в query, а
    // тикет пользователь выбирает руками. Спека требует «работает так же, как
    // сейчас», поэтому копия обязана вести себя так же — своя обработка была бы
    // новым поведением, которого владелец не заказывал.
    //
    // Сам адрес подменяется: шов сверяет `location.pathname`, а хвост `?…` в
    // pathname не входит, так что запись реестра `/support` его покрывает.
    expect(upstream).not.toContain('useSearchParams');
    expect(page).not.toContain('useSearchParams');
  });
});
