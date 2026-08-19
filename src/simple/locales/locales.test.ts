import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';

/**
 * Синхронность локалей простого режима.
 *
 * Дыра здесь молчит вдвойне: `src/i18n.ts` задаёт `FALLBACK_LNG = 'ru'`
 * глобально, поэтому ключ, забытый в `en.json`, отдаёт англоязычному
 * пользователю русский текст — не пустоту и не ключ, а просто чужой язык.
 * Ровно так весь namespace `resetPassword.*` однажды уехал в прод по-русски
 * (см. `src/locales/locales.test.ts`, тот же сторож для апстримных локалей).
 *
 * Языков в простом режиме два — русский и английский, поэтому и сравнение
 * попарное, без исключений и списков известных дыр.
 */

// Плюральные категории i18next: ru использует _one/_few/_many, en — _one/_other.
// Сравниваем БАЗОВЫЕ ключи, без плюрального суффикса.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

type Tree = { [key: string]: Tree | string };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else {
      for (const [nested, nestedValue] of flatten(value, path)) {
        out.set(nested, nestedValue);
      }
    }
  }
  return out;
}

const enFlat = flatten(en as Tree);
const ruFlat = flatten(ru as Tree);

const baseKeys = (flat: Map<string, string>): Set<string> =>
  new Set([...flat.keys()].map((key) => key.replace(PLURAL_SUFFIX, '')));

const enBases = baseKeys(enFlat);
const ruBases = baseKeys(ruFlat);

describe('синхронность локалей простого режима', () => {
  it('разбор удался — иначе сторож сверял бы пустоту', () => {
    expect(ruBases.size).toBeGreaterThan(0);
    expect(enBases.size).toBeGreaterThan(0);
  });

  it('каждый ru-ключ есть в en', () => {
    expect([...ruBases].filter((key) => !enBases.has(key))).toEqual([]);
  });

  it('каждый en-ключ есть в ru', () => {
    expect([...enBases].filter((key) => !ruBases.has(key))).toEqual([]);
  });

  it('плейсхолдеры {{...}} совпадают в общих ключах', () => {
    // Разошедшийся плейсхолдер не падает, а печатает `{{date}}` как есть.
    const PLACEHOLDER = /\{\{[^}]+\}\}/g;
    const mismatches: string[] = [];

    for (const [key, ruValue] of ruFlat) {
      const enValue = enFlat.get(key);
      if (enValue === undefined) {
        continue;
      }
      const ruPlaceholders = (ruValue.match(PLACEHOLDER) ?? []).sort().join(',');
      const enPlaceholders = (enValue.match(PLACEHOLDER) ?? []).sort().join(',');
      if (ruPlaceholders !== enPlaceholders) {
        mismatches.push(`${key}: ru=[${ruPlaceholders}] en=[${enPlaceholders}]`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('пустых строк нет ни в одной локали', () => {
    const empty = [...ruFlat, ...enFlat].filter(([, value]) => value.trim() === '');

    expect(empty).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Что видит пользователь с `fa` или `zh` (задача #63).
 *
 * Наш неймспейс живёт на двух языках, а переключатель языка в простом режиме
 * показывает все четыре языка аккаунта — решение владельца от 14.08.2026.
 * Канон обещает, что персу и китайцу достанется РУССКИЙ по `fallbackLng`, а не
 * сырой ключ. Обещание держится на одной строке чужого файла (`FALLBACK_LNG` в
 * `src/i18n.ts`) и на том, что у неймспейса нет своего `fallbackLng`: убери
 * первое или добавь второе — и на экране появится `support.faqLinkTitle`
 * вместо текста, молча, при зелёной сборке.
 *
 * Поэтому здесь не текстовый сторож, а НАСТОЯЩИЙ i18next: конфиг собирается по
 * значениям, вычитанным из исходников, и резолв ключей проверяется исполнением.
 * Alias `@/` тут не нужен — сам `i18next` резолвится как пакет.
 * ══════════════════════════════════════════════════════════════════════════ */

const APP_I18N = readFileSync('src/i18n.ts', 'utf8');
const SIMPLE_I18N = readFileSync('src/simple/i18n.ts', 'utf8');

/** Запасной язык приложения — общий для обоих неймспейсов. */
const fallbackLng = APP_I18N.match(/const FALLBACK_LNG = '([^']+)'/)?.[1] ?? '';
/** Имя нашего неймспейса. */
const simpleNs = SIMPLE_I18N.match(/const NS = '([^']+)'/)?.[1] ?? '';
/** Языки аккаунта — ровно те, что грузит `src/i18n.ts`. */
const appLanguages = [...APP_I18N.matchAll(/^\s*(\w+): \(\) => import\('\.\/locales\//gm)].map(
  (found) => found[1],
);

/** Инстанс i18next с нашим неймспейсом и языком `lng`. */
function instanceFor(lng: string) {
  const instance = createInstance();
  instance.init({
    lng,
    fallbackLng,
    supportedLngs: appLanguages,
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  instance.addResourceBundle('ru', simpleNs, ru, true, true);
  instance.addResourceBundle('en', simpleNs, en, true, true);
  return instance;
}

describe('языки без нашей локали не показывают сырых ключей (задача #63)', () => {
  it('разбор конфигов удался — иначе проверки ниже гоняли бы выдуманный i18next', () => {
    // Пара «разбор удался»: переименуй апстрим константу или наш неймспейс — и
    // тест собрал бы инстанс с пустыми значениями, где резолв ничего не значит.
    expect(fallbackLng).toBe('ru');
    expect(simpleNs).toBe('simple');
    expect([...appLanguages].sort()).toEqual(['en', 'fa', 'ru', 'zh']);

    // ⚠️ И то, что константы реально подключены к `init`. Без этой пары тест
    // читал бы объявление, а приложение жило бы по другому конфигу: замена
    // `fallbackLng: FALLBACK_LNG` на `fallbackLng: false` вернула бы персу
    // сырой ключ, а сторож остался бы зелёным.
    expect(APP_I18N).toContain('fallbackLng: FALLBACK_LNG');
    expect(APP_I18N).toContain('supportedLngs: SUPPORTED_LANGS');
    expect(APP_I18N).toContain('const SUPPORTED_LANGS = Object.keys(localeLoaders)');
  });

  it('своего fallbackLng у неймспейса нет — иначе обещание держится не на том', () => {
    // ⚠️ Разбор по коду БЕЗ КОММЕНТАРИЕВ: докстринг `src/simple/i18n.ts` сам
    // объясняет, что своего `fallbackLng` там нет и почему, — на сыром тексте
    // проверка падала бы по этой прозе, то есть по ложной причине.
    const code = SIMPLE_I18N.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    // Разбор удался: код неймспейса на месте, а не выгрызен вместе с прозой.
    expect(code).toContain('addResourceBundle');
    expect(code).not.toContain('fallbackLng');
  });

  it('каждый ключ на каждом языке аккаунта резолвится в текст, а не в имя ключа', () => {
    const raw: string[] = [];

    for (const lng of appLanguages) {
      const instance = instanceFor(lng);
      for (const key of ruBases) {
        const value = instance.t(key, { ns: simpleNs });
        if (typeof value !== 'string' || value.trim() === '' || value === key) {
          raw.push(`${lng}: ${key}`);
        }
      }
    }

    // Пусто — значит ни фарси, ни китайский не упираются в сырой ключ.
    expect(raw).toEqual([]);
  });

  it('fa и zh получают именно РУССКИЙ текст — цена, признанная каноном', () => {
    // Не «что-нибудь непустое», а конкретно запасной язык: подмени кто-нибудь
    // `fallbackLng` на `en`, и проверка выше осталась бы зелёной, а канон —
    // соврал бы. Ключ карточки FAQ взят как представитель неймспейса.
    const key = 'support.faqLinkTitle';

    // Разбор удался: ключ в наших локалях действительно есть.
    expect(ruBases.has(key)).toBe(true);

    for (const lng of ['fa', 'zh']) {
      expect(instanceFor(lng).t(key, { ns: simpleNs }), lng).toBe(
        instanceFor('ru').t(key, { ns: simpleNs }),
      );
    }
  });
});
