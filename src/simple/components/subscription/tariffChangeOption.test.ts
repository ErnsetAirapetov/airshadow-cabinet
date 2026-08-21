import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторож пункта «Сменить тариф» в блоке «Дополнительные опции» (задача #61).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ: компонентных тестов в проекте не бывает
 * (`environment: 'node'`, alias `@/` в тестах не разрешается,
 * docs/architecture/two-modes.md, раздел «Тесты»). У каждой проверки поэтому
 * есть парная «разбор удался».
 *
 * Требование владельца дословно: пункт должен быть «теми же элементами, что уже
 * лежат там, — чтобы блок был единообразным». Проверяется это не глазами и не
 * списком известных классов, а СВЕРКОЙ С ОБРАЗЦОМ: набор классов пункта обязан
 * совпасть с набором классов соседнего триггера шторки. Разъехавшись, они не
 * уронили бы ни сборку, ни один другой тест.
 */

const OPTION = 'src/simple/components/subscription/TariffChangeOption.tsx';
/** Образец соседнего элемента блока — триггер шторки покупки устройств. */
const SAMPLE = 'src/simple/components/subscription/sheets/DeviceTopupSheet.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const option = read(OPTION);
const sample = read(SAMPLE);

/**
 * Классы «корпуса» элемента — первый шаблонный `className` файла с веткой темы.
 *
 * У образца это триггер шторки (ветка `if (!open)`), у пункта — единственный
 * шаблон вообще. Возвращает `null`, если разбор не удался: считать несовпадение
 * совпадением молча нельзя.
 */
function shellClasses(source: string): Set<string> | null {
  const template = /className=\{`([^`]*isDark[^`]*)`\}/.exec(source)?.[1];
  if (!template) return null;

  const classes = template
    .replace(/\$\{[^}]*\}/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  return classes.length === 0 ? null : new Set(classes);
}

/** Ветки темы шаблона: `isDark ? '…' : '…'` — обе строки целиком. */
function themeBranches(source: string): string[] {
  const template = /className=\{`([^`]*isDark[^`]*)`\}/.exec(source)?.[1] ?? '';
  return [...template.matchAll(/'([^']*)'/g)].map((found) => found[1]);
}

const optionShell = shellClasses(option);
const sampleShell = shellClasses(sample);

describe('разбор удался', () => {
  it('оба файла прочитаны и не пусты', () => {
    expect(option.length).toBeGreaterThan(500);
    expect(sample.length).toBeGreaterThan(1000);
  });

  it('классы корпуса извлечены из обоих файлов', () => {
    // Без этого «наборы совпали» проходило бы на двух пустых множествах.
    expect(optionShell).not.toBeNull();
    expect(sampleShell).not.toBeNull();
    expect(optionShell?.size).toBeGreaterThan(3);
    expect(sampleShell?.size).toBeGreaterThan(3);
  });

  it('ветки темы извлечены из обоих файлов', () => {
    expect(themeBranches(option)).toHaveLength(2);
    expect(themeBranches(sample)).toHaveLength(2);
  });

  it('разбор классов работает на синтетическом шаблоне', () => {
    // Самопроверка: сломайся регулярка — и сверка ниже молчала бы.
    const probe = shellClasses("className={`w-full p-4 ${isDark ? 'a-1' : 'b-2'}`}");
    expect(probe && [...probe].sort()).toEqual(['p-4', 'w-full']);
  });
});

describe('пункт выглядит теми же элементами, что соседи по блоку (#61)', () => {
  it('набор классов корпуса совпадает с образцом с точностью до block', () => {
    // ⚠️ `block` — единственное расхождение, и оно вынужденное: соседи это
    // `<button>` (блочный по умолчанию), а пункт — `<Link>`, то есть `<a>`,
    // строчный. Без `block` ширина и отступы поехали бы.
    const extra = [...(optionShell ?? [])].filter((name) => !sampleShell?.has(name));
    const missing = [...(sampleShell ?? [])].filter((name) => !optionShell?.has(name));

    expect(extra).toEqual(['block']);
    expect(missing).toEqual([]);
  });

  it('ветки темы повторены дословно', () => {
    expect(themeBranches(option)).toEqual(themeBranches(sample));
  });

  it('внутренняя раскладка — заголовок, подпись, шеврон — как у образца', () => {
    for (const fragment of [
      '<div className="flex items-center justify-between">',
      '<div className="font-medium text-dark-100">',
      '<div className="mt-1 text-sm text-dark-400">',
      '<ChevronRightIcon className="text-dark-400" />',
    ]) {
      expect(`${fragment} в пункте: ${option.includes(fragment)}`).toBe(
        `${fragment} в пункте: true`,
      );
      expect(`${fragment} в образце: ${sample.includes(fragment)}`).toBe(
        `${fragment} в образце: true`,
      );
    }
  });
});

describe('пункт ведёт на страницу смены тарифа, а не открывает шторку (#61)', () => {
  it('это ссылка, и адрес приходит готовым из правила покупки', () => {
    // Спека: адрес брать из существующего правила в `purchaseCta.ts`, а не
    // писать второй раз.
    expect(option).toContain('to={action.to}');
    expect(option).toContain("from './purchaseCta'");
  });

  it('своего адреса в пункте не записано', () => {
    expect(option).not.toContain('/subscription/purchase');
  });

  it('подписи тоже приходят из правила, а не литералами', () => {
    expect(option).toContain('t(action.labelKey)');
    // Подпись читается нашим переводчиком с #33: апстримных ключей под неё
    // больше нет, `src/locales/*.json` откачены. Разбор — в докстринге
    // `PurchaseCTAButton.tsx`, сторож пары — `upstreamLocalesDrift.test.ts`.
    expect(option).toContain('tSimple(action.hintKey)');
  });

  it('шторки у пункта нет', () => {
    for (const forbidden of ['onOpen', 'onClose', 'open ?', 'useState']) {
      expect(`${forbidden}: ${option.includes(forbidden)}`).toBe(`${forbidden}: false`);
    }
  });
});
