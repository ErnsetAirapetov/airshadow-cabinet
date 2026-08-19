import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import ru from './locales/ru.json';

/**
 * Апстримные локали вернулись к `upstream/main` — по ключам, а не по ощущению
 * (задача #33).
 *
 * ⚠️ Зачем отдельный сторож, если есть `git diff`. Дифф показывает расхождение
 * только тому, кто его запустил и посмотрел; здесь же обе стороны обмена
 * проверяются заодно. Откат локалей — единственный шаг #33, который умеет
 * сломать экран МОЛЧА: строка исчезает из `src/locales/*.json`, потребитель
 * продолжает её звать, i18next не находит ключ и печатает сам ключ. Ни `tsc`,
 * ни сборка, ни сторожа страниц этого не видят — они смотрят на литерал ключа в
 * исходнике, а он на месте.
 *
 * Поэтому проверяется пара утверждений на каждую группу строк:
 *
 *   1. нашей строки в апстримных локалях больше нет (откат состоялся);
 *   2. потребитель этой строки читает её оттуда, где она теперь лежит.
 *
 * Обратная сторона тоже сторожится: ключи, которые в апстримных локалях обязаны
 * ОСТАТЬСЯ. Их два вида — апстримные (`subscription.cta.activeHint`, его читает
 * экспертный `src/components/subscription/PurchaseCTAButton.tsx`) и наши,
 * принадлежащие файлу из корзины «оставляем» (`auth.*` для `src/pages/Login.tsx`).
 * Слепой откат первого не вернул бы, а слепое «выкинуть всё наше» унесло бы
 * второе — обе ошибки дают на экране сырой ключ или чужой язык.
 */

const UPSTREAM_LOCALES = ['ru', 'en', 'fa', 'zh'].map(
  (lng) =>
    [
      `src/locales/${lng}.json`,
      JSON.parse(readFileSync(`src/locales/${lng}.json`, 'utf8')),
    ] as const,
);

const SIMPLE_LOCALES = [
  ['src/simple/locales/ru.json', ru],
  ['src/simple/locales/en.json', en],
] as const;

type Tree = { [key: string]: Tree | string };

/** Значение по точечному пути или `undefined`. */
function at(tree: Tree, path: string): Tree | string | undefined {
  let node: Tree | string | undefined = tree;
  for (const step of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[step];
  }
  return node;
}

/**
 * Ключи, ЗАВЕДЁННЫЕ форком в апстримных локалях и убранные откатом #33.
 *
 * Общее у всех: апстрим их не знает, а наш потребитель читает теперь свою копию
 * из `src/simple/locales/`.
 */
const MOVED_OUT = [
  // Переехали в `simple`: приветствие главной и метки промокода (#58).
  'dashboard.welcomeGreeting',
  'promoCode.expiredLabel',
  'promoCode.disabledLabel',
  // Две подписи кнопок подписки, которых в апстриме нет вовсе: суточный тариф и
  // смена тарифа — наши состояния, апстрим их не различает.
  'subscription.cta.changeHint',
  'subscription.cta.dailyHint',
];

/**
 * Ключи, которые в апстримных локалях обязаны ОСТАТЬСЯ с апстримным текстом.
 *
 * ⚠️ Тонкое место: часть из них форк не добавлял, а ПЕРЕПИСЫВАЛ — тем же именем,
 * другими словами. Удалить такой ключ нельзя (его читает экспертный режим),
 * оставить наш текст — тоже (тогда наши слова навязаны экспертному режиму).
 * Развязка одна: апстримный текст остаётся здесь, наш живёт в `simple` под тем
 * же именем, и каждый режим читает свой неймспейс. Отсюда `subscription.cta.renewHint`
 * и три ключа поддержки, которые есть в ОБОИХ наборах локалей и это не ошибка.
 */
const KEPT_UPSTREAM = [
  // Читает экспертный `src/components/subscription/PurchaseCTAButton.tsx`. Наш
  // патч этот ключ УДАЛЯЛ, и до #33 экспертный режим печатал на его месте сырой
  // ключ — дефект, который откат заодно чинит.
  'subscription.cta.activeHint',
  // Апстримные подписи, которые форк переписывал: у апстрима renewHint про
  // истёкшую подписку, у нас — про оплату текущего тарифа на новый срок.
  'subscription.cta.renewHint',
  'subscription.cta.expiredHint',
  'subscription.cta.trialHint',
  // Апстримные формулировки поддержки: форк переписывал их в `ru.json` ради
  // простого экрана, теперь наши тексты живут в `simple`.
  'support.newTicket',
  'support.yourTickets',
  'support.selectTicket',
];

/** Наши ключи, которые из апстримных локалей НЕ уходят. */
const KEPT_OURS = [
  // Их читает `src/pages/Login.tsx` — файл из корзины «оставляем»: вход общий
  // для обоих режимов, своего простого экрана у него нет. Убрать ключ из
  // `fa`/`zh` тоже нельзя: на экране появится английский фолбэк.
  'auth.orContinueWith',
  'auth.createAccount',
];

/** Строки, переехавшие в наш неймспейс, — обязаны там быть на обоих языках. */
const MOVED_IN = [
  'subscription.cta.expiredHint',
  'subscription.cta.trialHint',
  'subscription.cta.renewHint',
  'subscription.cta.changeHint',
  'subscription.cta.dailyHint',
  'support.newTicket',
  'support.yourTickets',
  'support.selectTicket',
];

describe('разбор удался (задача #33)', () => {
  it('все шесть файлов локалей прочитаны и не пусты', () => {
    // Битый путь дал бы пустой объект, и все проверки «ключа нет» проходили бы
    // всегда — сторож охранял бы пустоту.
    for (const [path, tree] of UPSTREAM_LOCALES) {
      expect(Object.keys(tree as Tree).length, path).toBeGreaterThan(10);
    }
    for (const [path, tree] of SIMPLE_LOCALES) {
      expect(Object.keys(tree as Tree).length, path).toBeGreaterThan(0);
    }
  });
});

describe('апстримные локали откачены (задача #33)', () => {
  it('наших переехавших строк там нет ни на одном языке', () => {
    const found: string[] = [];

    for (const [path, tree] of UPSTREAM_LOCALES) {
      for (const key of MOVED_OUT) {
        if (at(tree as Tree, key) !== undefined) found.push(`${path}: ${key}`);
      }
    }

    expect(found).toEqual([]);
  });

  it('апстримные ключи на месте — откат вернул, а не выпотрошил', () => {
    const missing: string[] = [];

    for (const [path, tree] of UPSTREAM_LOCALES) {
      for (const key of KEPT_UPSTREAM) {
        if (typeof at(tree as Tree, key) !== 'string') missing.push(`${path}: ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('строки логина остались — их читает файл из корзины «оставляем»', () => {
    const missing: string[] = [];

    for (const [path, tree] of UPSTREAM_LOCALES) {
      for (const key of KEPT_OURS) {
        if (typeof at(tree as Tree, key) !== 'string') missing.push(`${path}: ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });
});

describe('переехавшие строки живут в нашем неймспейсе (задача #33)', () => {
  it('оба языка знают каждую', () => {
    const missing: string[] = [];

    for (const [path, tree] of SIMPLE_LOCALES) {
      for (const key of MOVED_IN) {
        if (typeof at(tree as Tree, key) !== 'string') missing.push(`${path}: ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('потребители подписей подписки читают их через `tSimple`', () => {
    // Ключи приходят переменной (`action.hintKey`), поэтому сторож неймспейса
    // из `i18nNamespace.test.tsx` их не видит: он ловит только литералы.
    for (const path of [
      'src/simple/components/subscription/PurchaseCTAButton.tsx',
      'src/simple/components/subscription/TariffChangeOption.tsx',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).toContain('tSimple(action.hintKey)');
      expect(source, path).not.toContain('t(action.hintKey)');
    }
  });

  it('у одноимённых ключей тексты РАЗНЫЕ — иначе переезд был бы бессмысленным', () => {
    // Четыре ключа живут в обоих неймспейсах, и ровно ради разных слов. Совпади
    // тексты — переезд стал бы дублированием апстримной строки, то есть тем
    // самым, что канон запрещает; а привести их к апстримным словами значило бы
    // молча откатить дизайн-правку простого экрана.
    const ruUpstream = JSON.parse(readFileSync('src/locales/ru.json', 'utf8')) as Tree;
    const same: string[] = [];

    for (const key of [
      'subscription.cta.renewHint',
      'support.newTicket',
      'support.yourTickets',
      'support.selectTicket',
    ]) {
      const ours = at(ru as Tree, key);
      const theirs = at(ruUpstream, key);
      expect(typeof ours, `${key} — нашего текста нет`).toBe('string');
      expect(typeof theirs, `${key} — апстримного текста нет`).toBe('string');
      if (ours === theirs) same.push(key);
    }

    expect(same).toEqual([]);
  });

  it('заголовки кнопок по-прежнему апстримные — дублировать локали не начали', () => {
    // Пара к проверке выше: `labelKey` указывает на апстримные ключи, которых
    // мы не касались, и уезжать им в наш неймспейс не за чем.
    for (const path of [
      'src/simple/components/subscription/PurchaseCTAButton.tsx',
      'src/simple/components/subscription/TariffChangeOption.tsx',
    ]) {
      expect(readFileSync(path, 'utf8'), path).toContain('t(action.labelKey)');
    }
  });
});
