import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа копий блоков покупки (задача #29).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются. Компонентных тестов в проекте
 * не бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * компонента потянул бы весь граф приложения. Тот же приём, что в
 * `topUpMethodSelectPage.test.ts`; цена та же — разбор видит только литералы,
 * поэтому у каждого блока есть парная проверка «разбор удался».
 *
 * Что охраняется. Спека владельца от 18.08.2026 разрешает на экране покупки
 * ровно ОДНО изменение — убрать виджет промо-группы из витрины тарифов. Всё
 * остальное скопировано из апстрима как есть. Копия без сторожа расходится
 * молча в обе стороны:
 *
 *   - апстрим правит оригинал (он это делает каждый синк), копия остаётся
 *     вчерашней, и простой режим тихо теряет починенный баг;
 *   - кто-нибудь «немного упрощает» копию, и экран перестаёт быть тем, что
 *     владелец принял на стенде.
 *
 * Поэтому сравнение здесь не по списку известных строк, а ПОЛНОЕ: копия обязана
 * совпасть с оригиналом после нормализации путей импорта, вырезания комментариев
 * и схлопывания пробелов. У витрины тарифов из оригинала вычитается ровно блок
 * промо-группы — и результат обязан совпасть с копией. Любая другая правка с
 * любой стороны краснеет.
 */

const COPIES: { copy: string; upstream: string }[] = [
  {
    copy: 'src/simple/components/subscription/purchase/TariffPurchaseForm.tsx',
    upstream: 'src/components/subscription/purchase/TariffPurchaseForm.tsx',
  },
  {
    copy: 'src/simple/components/subscription/purchase/ClassicPurchaseWizard.tsx',
    upstream: 'src/components/subscription/purchase/ClassicPurchaseWizard.tsx',
  },
  {
    copy: 'src/simple/components/subscription/sheets/SwitchTariffSheet.tsx',
    upstream: 'src/components/subscription/sheets/SwitchTariffSheet.tsx',
  },
  {
    copy: 'src/simple/components/InsufficientBalancePrompt.tsx',
    upstream: 'src/components/InsufficientBalancePrompt.tsx',
  },
  {
    copy: 'src/simple/components/WebBackButton.tsx',
    upstream: 'src/components/WebBackButton.tsx',
  },
];

const PICKER_COPY = 'src/simple/components/subscription/purchase/TariffPickerGrid.tsx';
const PICKER_UPSTREAM = 'src/components/subscription/purchase/TariffPickerGrid.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны — разбор смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Приводит файл к виду, в котором копия и оригинал обязаны совпасть.
 *
 * Три нормализации, и каждая закрывает свою законную разницу:
 *
 *   1. путь импорта → имя модуля. Копия ходит через alias `@/`, оригинал —
 *      относительными путями; модуль при этом один и тот же;
 *   2. комментарии вырезаны. Копия несёт свой заголовок «это копия, задача #29»,
 *      и требовать его отсутствия было бы вредно;
 *   3. `{}` (то, что осталось от JSX-комментариев) и пробелы схлопнуты —
 *      иначе сторож ловил бы переносы строк вместо кода.
 */
function normalize(source: string): string {
  return stripComments(source)
    .replace(/from '[^']*\/([^'/]+)'/g, "from '<$1>'")
    .replace(/\{\s*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('разбор копий удался (задача #29)', () => {
  it('нормализация схлопывает законные различия и НЕ схлопывает код', () => {
    // Пара «разбор удался» для самой нормализации: без неё сравнения ниже могли
    // бы проходить на пустых строках или на схлопнутом в ничто тексте.
    expect(normalize("import { X } from '../../../hooks/useCurrency';")).toBe(
      normalize("import { X } from '@/hooks/useCurrency';"),
    );
    expect(normalize('/* заголовок копии */ const a = 1;')).toBe('const a = 1;');
    expect(normalize('const a = 1;')).not.toBe(normalize('const a = 2;'));
    expect(normalize('')).toBe('');
  });

  it('все файлы на месте и непусты', () => {
    for (const { copy, upstream } of [
      ...COPIES,
      { copy: PICKER_COPY, upstream: PICKER_UPSTREAM },
    ]) {
      expect(normalize(read(copy)).length, copy).toBeGreaterThan(500);
      expect(normalize(read(upstream)).length, upstream).toBeGreaterThan(500);
    }
  });
});

describe('копии блоков покупки совпадают с апстримом (задача #29)', () => {
  for (const { copy, upstream } of COPIES) {
    it(`${copy} — байт в байт после нормализации`, () => {
      // ⚠️ Полное сравнение, а не выборка строк. «Немного упростить» копию спека
      // не разрешает: владелец принял на стенде именно апстримный экран.
      expect(normalize(read(copy))).toBe(normalize(read(upstream)));
    });
  }
});

describe('витрина тарифов — копия минус виджет промо-группы (задача #29)', () => {
  const copy = normalize(read(PICKER_COPY));
  const upstream = normalize(read(PICKER_UPSTREAM));

  /** Границы апстримного блока промо-группы в нормализованном тексте. */
  const bannerStart = upstream.indexOf('{tariffs.some((tariff) => tariff.promo_group_name) && (');
  const bannerEnd = upstream.indexOf('{isMultiTariff &&', bannerStart);

  it('блок промо-группы в апстриме найден — иначе вычитание было бы пустым', () => {
    // ⚠️ Парная проверка. Переименуй апстрим поле или перепиши условие — и
    // вычитание ниже стало бы бессмысленным, а сторож зелёным.
    expect(bannerStart).toBeGreaterThan(-1);
    expect(bannerEnd).toBeGreaterThan(bannerStart);
    expect(upstream).toContain("t('subscription.promoGroup.yourGroup'");
    expect(upstream).toContain("t('subscription.promoGroup.personalDiscountsApplied')");
  });

  it('копия — это апстрим ровно без блока промо-группы', () => {
    // Сердце сторожа: вычитаем из оригинала только баннер и требуем полного
    // совпадения. Любая ДРУГАЯ правка копии — или правка оригинала апстримом —
    // краснеет здесь.
    const withoutBanner = upstream.slice(0, bannerStart) + upstream.slice(bannerEnd);

    expect(copy).toBe(withoutBanner);
  });

  it('в копии не осталось следов виджета', () => {
    expect(copy).not.toContain('promo_group_name');
    expect(copy).not.toContain('promoGroup.yourGroup');
    expect(copy).not.toContain('personalDiscountsApplied');
  });

  it('скидки промо-группы в ценах остались — убран баннер, а не скидка', () => {
    // ⚠️ Легко потерять вместе с баннером. Спека требует «убрать виджет», а не
    // «перестать считать персональные скидки»: человек должен видеть свою цену.
    expect(copy).toContain('usePromoDiscount');
    expect(copy).toContain('applyPromoDiscount(');
    expect(copy).toContain('isPromoGroup');
  });

  it('сортировка «текущий тариф вперёд» и ветки кнопок сохранены', () => {
    expect(copy).toContain('aIsCurrent');
    expect(copy).toContain("t('subscription.currentTariff')");
    expect(copy).toContain("t('subscription.tariff.selectForRenewal')");
    expect(copy).toContain("t('subscription.switchTariff.switch')");
    expect(copy).toContain("t('subscription.purchase')");
  });
});

describe('экспертный режим не тронут (задача #29)', () => {
  it('апстримная витрина по-прежнему показывает виджет промо-группы', () => {
    // Границы задачи: `src/components/**` не правим. Оригинал обязан остаться
    // с баннером — иначе изъятие уехало не в ту сторону.
    expect(read(PICKER_UPSTREAM)).toContain('promo_group_name');
    expect(read(PICKER_UPSTREAM)).toContain("t('subscription.promoGroup.yourGroup'");
  });
});
