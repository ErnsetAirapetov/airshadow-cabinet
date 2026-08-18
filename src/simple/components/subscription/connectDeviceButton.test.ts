import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторож общей кнопки «Подключить устройство» (задача #61).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются: компонентных тестов в проекте
 * не бывает (`environment: 'node'`, alias `@/` в тестах не разрешается,
 * docs/architecture/two-modes.md, раздел «Тесты»). Цена приёма — разбор видит
 * только записанное литералом, поэтому у каждой проверки ниже есть парная
 * «разбор удался».
 *
 * Что охраняется и почему:
 *
 * 1. **Кнопка одна на два экрана.** До #61 копий было две — на главной
 *    (`SubscriptionCardActive`) и на странице подписки, — и после #59 они
 *    разошлись: акцент достался одной. Копии разъезжаются молча, со сборкой
 *    зелёной, поэтому проверяется не «обе одинаковые», а «копия ровно одна».
 * 2. **Различия мест вызова — пропами, а не ветками внутри.** Ветка внутри
 *    компонента — та же развилка, из-за которой копии и разошлись.
 * 3. **Ни один цвет не записан в компоненте.** Всё приходит из
 *    `resolveConnectButtonAccent`, то есть из палитры оператора.
 */

const BUTTON = 'src/simple/components/subscription/ConnectDeviceButton.tsx';
/** Место вызова на главной — там же жила вторая копия. */
const ACTIVE_CARD = 'src/simple/components/dashboard/SubscriptionCardActive.tsx';
/** Место вызова на странице подписки — там жила первая копия. */
const SUBSCRIPTION_PAGE = 'src/simple/pages/Subscription.tsx';
/** Апстримная страница — пара «нужное сочетание вообще встречается в коде». */
const UPSTREAM_PAGE = 'src/pages/Subscription.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны — докстринги ниже сами упоминают запрещённые слова. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const button = stripComments(read(BUTTON));
const card = stripComments(read(ACTIVE_CARD));
const page = stripComments(read(SUBSCRIPTION_PAGE));
const upstream = stripComments(read(UPSTREAM_PAGE));

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/**
 * Всё, чем в этой кодовой базе можно записать цвет.
 *
 * ⚠️ Правило от обратного: не «нет известных дефектных литералов», а «слова
 * цвета в компоненте не встречаются вовсе». Любая утилита Tailwind этого репо
 * (`text-white`, `text-dark-50`, `bg-accent-500`, `text-champagne-900`) содержит
 * одно из этих сочетаний, любой инлайн-цвет — hex или `rgb(`. Поле акцента
 * (`accent.foreground`) под правило не попадает: там точка, а не дефис.
 */
const COLOR_NEEDLES = [
  '#',
  'rgb(',
  'rgba(',
  'white',
  'black',
  'dark-',
  'light-',
  'champagne-',
  'accent-',
  'warning-',
  'success-',
  'error-',
  'critical-',
];

/** Поля акцента, которые компонент обязан использовать. */
const ACCENT_FIELDS = [
  'accent.background',
  'accent.boxShadow',
  'accent.iconBackground',
  'accent.foreground',
  'accent.foregroundMuted',
  'accent.indicatorOn',
  'accent.indicatorOff',
  'accent.indicatorGlow',
  'accent.indicatorTrack',
  'accent.limitNotice',
];

/** Все шаблонные литералы `className={`…`}` файла. */
function classNameTemplates(source: string): string[] {
  return [...source.matchAll(/className=\{`[^`]*`\}/g)].map((found) => found[0]);
}

/** Шаблоны классов, в которых перед вставкой НЕТ пробела (дефект из #59). */
function gluedClassTemplates(source: string): string[] {
  return classNameTemplates(source).filter((template) => /[^\s`]\$\{/.test(template));
}

describe('разбор удался', () => {
  it('все четыре файла прочитаны и не пусты', () => {
    // Без этого файл, переименованный или удалённый, дал бы пустую строку — и
    // все проверки «этого здесь нет» проходили бы, ничего не охраняя.
    expect(button.length).toBeGreaterThan(1000);
    expect(card.length).toBeGreaterThan(5000);
    expect(page.length).toBeGreaterThan(10_000);
    expect(upstream.length).toBeGreaterThan(10_000);
  });

  it('прочитан именно компонент кнопки', () => {
    expect(button).toContain('export function ConnectDeviceButton(');
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(read(BUTTON)).toContain('задача #61');
    expect(button).not.toContain('задача #61');
  });

  it('искомые сочетания в коде вообще встречаются — иначе запреты пустые', () => {
    // Пара для правила «цветов в компоненте нет»: на выдуманных иголках оно
    // проходило бы всегда. Апстримная страница красит ту же кнопку — значит
    // иголки настоящие и ловят живой код, а не опечатки.
    for (const needle of ['#', 'rgb(', 'rgba(', 'white', 'dark-', 'accent-']) {
      expect(`${needle}: ${upstream.includes(needle)}`).toBe(`${needle}: true`);
    }
    // Больше половины списка обязано найтись в живом файле.
    expect(COLOR_NEEDLES.filter((needle) => upstream.includes(needle)).length).toBeGreaterThan(
      COLOR_NEEDLES.length / 2,
    );
  });

  it('разбор шаблонов классов работает', () => {
    expect(classNameTemplates(button).length).toBeGreaterThan(0);
    expect(gluedClassTemplates('className={`p-3 duration-300${x ? "a" : ""}`}')).toHaveLength(1);
    expect(gluedClassTemplates('className={`p-3 duration-300 ${x ? "a" : ""}`}')).toHaveLength(0);
  });
});

describe('кнопка подключения — одна на два экрана (#61)', () => {
  it('разметка кнопки живёт ровно в одном файле', () => {
    // Заголовок кнопки — самый устойчивый признак её разметки: он есть у любой
    // копии независимо от того, как она сверстана.
    expect(countOf(button, "t('dashboard.connectDevice')")).toBe(1);
    expect(card).not.toContain('dashboard.connectDevice');
    expect(page).not.toContain('dashboard.connectDevice');
  });

  it('в апстримных копиях заголовок на месте — иначе проверка выше пустая', () => {
    expect(upstream).toContain("t('dashboard.connectDevice')");
  });

  it('оба экрана зовут общий компонент ровно по разу', () => {
    expect(countOf(card, '<ConnectDeviceButton')).toBe(1);
    expect(countOf(page, '<ConnectDeviceButton')).toBe(1);
  });

  it('переход и его адрес записаны только в компоненте', () => {
    expect(countOf(button, '/connection?sub=')).toBe(1);
    expect(button).toContain('navigate(');
    expect(card).not.toContain('/connection');
    expect(page).not.toContain('/connection?sub=');
  });

  it('состояние «упёрлись в лимит» считает сам компонент', () => {
    // Два независимых расчёта разъехались бы молча: кнопка выключена на одном
    // экране и жива на другом.
    expect(button).toContain('subscription.device_limit > 0');
    expect(card).not.toContain('isAtDeviceLimit');
    expect(page).not.toContain('isAtDeviceLimit');
  });

  it('тактильный отклик на упёртом лимите сохранён', () => {
    expect(button).toContain("haptic.notification('error')");
  });

  it('условие «ссылки подписки нет — кнопки нет» переехало внутрь', () => {
    expect(button).toContain('subscription.subscription_url');
  });
});

describe('различия мест вызова — пропами, а не ветками внутри (#61)', () => {
  it('внешний отступ приходит пропом, а не пишется в компоненте', () => {
    // Мутация «вернуть `mb-2.5` литералом» краснеет здесь.
    expect(button).toContain('className');
    expect(button).not.toMatch(/\bmb-[\d.]/);
    expect(card).toMatch(/<ConnectDeviceButton[\s\S]{0,300}?className="mb-/);
    expect(page).toMatch(/<ConnectDeviceButton[\s\S]{0,300}?className="mb-/);
  });

  it('атрибут онбординга приходит пропом и стоит только на главной', () => {
    expect(button).toContain('data-onboarding={onboardingId}');
    expect(button).not.toContain('"connect-devices"');
    expect(card).toContain('onboardingId="connect-devices"');
    expect(page).not.toContain('onboardingId=');
  });

  it('внутри компонента нет ветвления по месту вызова', () => {
    // Ветка «на главной / на странице подписки» — та же развилка, из-за
    // которой копии и разошлись.
    for (const forbidden of ['isDashboard', 'onDashboard', 'variant', 'screen', 'isSubscription']) {
      expect(button).not.toContain(forbidden);
    }
  });
});

describe('цвет берётся из палитры оператора, а не пишется в компоненте (#61)', () => {
  it('в компоненте не записано ни одного цвета', () => {
    // ⚠️ Правило от обратного. Мутация `text-white` краснеет на иголке `white`,
    // `style={{ color: '#FFF' }}` — на `#`, `bg-accent-500` — на `accent-`.
    for (const needle of COLOR_NEEDLES) {
      expect(`${needle}: ${button.includes(needle)}`).toBe(`${needle}: false`);
    }
  });

  it('каждое поле акцента реально используется', () => {
    // Пара к правилу выше: убрать цвет можно и просто перестав его задавать —
    // тогда белый текст ушёл бы вместе с любым текстом.
    for (const field of ACCENT_FIELDS) {
      expect(`${field}: ${button.includes(field)}`).toBe(`${field}: true`);
    }
  });

  it('акцент считает чистый модуль по состоянию лимита', () => {
    expect(button).toContain('resolveConnectButtonAccent(isAtDeviceLimit)');
  });

  it('акцент выдаётся инлайн-стилем, а не утилитами', () => {
    // ⚠️ Утилиты (`border-accent-*`, `shadow-glow`) в светлой теме подавляются
    // правилами карточек (#52, канон), инлайн-стиль — нет.
    expect(button).toContain('background: accent.background');
    expect(button).toContain('boxShadow: accent.boxShadow');
  });

  it('тон не зависит от зоны расхода трафика', () => {
    expect(button).not.toContain('zone.');
    expect(button).not.toContain('useTrafficZone');
    expect(button).not.toContain('mainHex');
  });

  it('HoverBorderGradient не вернулся ни в компонент, ни на экраны', () => {
    // Он и был причиной «свечение только под курсором»: правило
    // `.hover-border-gradient:hover` в globals.css, а наведения на телефоне и
    // в Telegram не существует.
    for (const source of [button, card, page]) {
      expect(source).not.toContain('HoverBorderGradient');
      expect(source).not.toContain('hover-border-gradient');
    }
  });

  it('в апстримной странице HoverBorderGradient на месте — иначе проверка выше пустая', () => {
    expect(upstream).toContain('HoverBorderGradient');
  });
});

describe('склейка классов не вернулась (#59, требование в силе)', () => {
  it('в компоненте склеек нет', () => {
    expect(gluedClassTemplates(button)).toEqual([]);
  });

  it('класс состояния действительно выдаётся, а не просто «склейки нет»', () => {
    expect(button).toContain("${isAtDeviceLimit ? 'cursor-not-allowed opacity-50' : ''}");
  });
});
