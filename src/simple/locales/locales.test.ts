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
