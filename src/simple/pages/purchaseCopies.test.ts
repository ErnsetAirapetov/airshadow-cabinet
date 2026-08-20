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

const FORM_COPY = 'src/simple/components/subscription/purchase/TariffPurchaseForm.tsx';
const FORM_UPSTREAM = 'src/components/subscription/purchase/TariffPurchaseForm.tsx';

/**
 * Правки формы покупки, разрешённые задачей #71 — и никаких других.
 *
 * ⚠️ Форма выехала из списка «байт в байт» (`COPIES`) не потому, что сторож
 * ослаб, а потому что владелец потребовал изменить ровно эту её часть: список
 * сроков был написан ДВАЖДЫ — здесь и на экране оплаты, — и две реализации
 * разъехались вплоть до разных подписей («1 месяц» против «30 дней»). Приём тот
 * же, что уже применён к витрине тарифов ниже: из оригинала вычитается
 * поимённый список правок, и результат обязан совпасть с копией ПОЛНОСТЬЮ.
 * Любая другая правка — с нашей стороны или со стороны апстрима — краснеет.
 *
 * ⚠️ Фрагменты пишутся исходным текстом и нормализуются тем же `normalize`:
 * переносы строк и отступы схлопываются, так что сверяется код, а не вёрстка
 * этого файла.
 */
const FORM_EDITS: { name: string; from: string; to: string }[] = [
  {
    name: 'импорты: цена за месяц уехала в общий компонент, подпись — в общее правило',
    from: `
      import { getMonthlyPriceKopeks } from '@/utils/pricing';
      import InsufficientBalancePrompt from '../../InsufficientBalancePrompt';
    `,
    to: `
      import InsufficientBalancePrompt from '../../InsufficientBalancePrompt';
      import { PeriodOptionList } from './PeriodOptionList';
      import { formatPeriodLabel } from './periodLabel';
    `,
  },
  {
    name: 'помощник подписи срока рядом с помощником цены',
    from: `
      const formatPrice = (kopeks: number) =>
        kopeks === 0
          ? t('subscription.free', 'Бесплатно')
          : \`\${formatAmount(kopeks / 100)} \${currencySymbol}\`;

      const [selectedTariffPeriod, setSelectedTariffPeriod] = useState<TariffPeriod | null>(
    `,
    to: `
      const formatPrice = (kopeks: number) =>
        kopeks === 0
          ? t('subscription.free', 'Бесплатно')
          : \`\${formatAmount(kopeks / 100)} \${currencySymbol}\`;

      const periodLabel = (days: number) => formatPeriodLabel(days, (key, params) => t(key, params));

      const [selectedTariffPeriod, setSelectedTariffPeriod] = useState<TariffPeriod | null>(
    `,
  },
  {
    name: 'своя сетка сроков заменена общим компонентом',
    from: `
      className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tariff.periods.map((period) => {
          const promoPeriod = applyPromoDiscount(
            period.price_kopeks,
            period.original_price_kopeks,
          );
          const displayDiscount = promoPeriod.percent;
          const displayOriginal = promoPeriod.original;
          const displayPrice = promoPeriod.price;
          const displayPerMonth = getMonthlyPriceKopeks(displayPrice, period.days);

          return (
            <button
              key={period.days}
              onClick={() => {
                setSelectedTariffPeriod(period);
                setUseCustomDays(false);
              }}
              className={\`relative rounded-xl border p-4 text-left transition-all \${
                selectedTariffPeriod?.days === period.days && !useCustomDays
                  ? 'border-accent-500 bg-accent-500/10'
                  : 'border-dark-700/50 bg-dark-800/50 hover:border-dark-600'
              }\`}
            >
              {displayDiscount && displayDiscount > 0 && (
                <div
                  className={\`absolute -right-2 -top-2 rounded-full px-2 py-0.5 text-xs font-medium text-white \${
                    promoPeriod.isPromoGroup ? 'bg-success-500' : 'bg-warning-500'
                  }\`}
                >
                  -{displayDiscount}%
                </div>
              )}
              <div className="text-lg font-semibold text-dark-100">{period.label}</div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-accent-400">
                  {formatPrice(displayPrice)}
                </span>
                {displayOriginal && displayOriginal > displayPrice && (
                  <span className="text-sm text-dark-500 line-through">
                    {formatPrice(displayOriginal)}
                  </span>
                )}
              </div>
              {displayPerMonth !== null && (
                <div className="mt-1 text-xs text-dark-500">
                  {formatPrice(displayPerMonth)}/{t('subscription.month')}
                </div>
              )}
            </button>
          );
        })}
    `,
    to: `
      className="mb-4">
        <PeriodOptionList
          options={tariff.periods.map((period) => {
            const promoPeriod = applyPromoDiscount(
              period.price_kopeks,
              period.original_price_kopeks,
            );

            return {
              days: period.days,
              priceKopeks: promoPeriod.price,
              originalPriceKopeks: promoPeriod.original,
              discountPercent: promoPeriod.percent ?? 0,
              missingKopeks: null,
            };
          })}
          selectedDays={useCustomDays ? null : (selectedTariffPeriod?.days ?? null)}
          onSelect={(days) => {
            const picked = tariff.periods.find((period) => period.days === days);
            if (picked) setSelectedTariffPeriod(picked);
            setUseCustomDays(false);
          }}
        />
    `,
  },
  {
    name: 'подпись базового тарифа в сводке — по общему правилу',
    from: `{t('subscription.baseTariff')}: {selectedTariffPeriod.label}`,
    to: `{t('subscription.baseTariff')}:{' '} {periodLabel(selectedTariffPeriod.days)}`,
  },
  {
    name: 'подпись срока в сводке — по общему правилу',
    from: `selectedTariffPeriod.label,`,
    to: `periodLabel(selectedTariffPeriod.days),`,
  },
];

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
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

describe('форма покупки — апстрим ровно с правками задачи #71', () => {
  const copy = normalize(read(FORM_COPY));
  const upstream = normalize(read(FORM_UPSTREAM));

  it('оба файла на месте и опознаны', () => {
    // Пара «разбор удался»: без неё сверка ниже проходила бы на пустых строках.
    expect(copy.length).toBeGreaterThan(500);
    expect(upstream.length).toBeGreaterThan(500);
    expect(copy).toContain('export function TariffPurchaseForm(');
    expect(upstream).toContain('export function TariffPurchaseForm(');
  });

  for (const edit of FORM_EDITS) {
    it(`правка разобрана: ${edit.name}`, () => {
      // ⚠️ Каждая правка обязана находиться в оригинале РОВНО ОДИН раз.
      // Иначе вычитание ниже било бы не туда, а сторож остался бы зелёным —
      // ровно та молчаливая поломка, от которой этот файл и заведён.
      expect(normalize(edit.from)).not.toBe('');
      expect(countOf(upstream, normalize(edit.from))).toBe(1);
    });
  }

  it('копия — это апстрим ровно с перечисленными правками и ничем больше', () => {
    // ⚠️ Сердце сторожа. Полное сравнение, а не выборка строк: «немного
    // упростить» форму задача не разрешает — там живут оформление по СБП с
    // привязкой, произвольное число дней и промо-логика, и владелец сказал
    // прямо «главное чтобы работало». Тронь их — красное здесь.
    let expected = upstream;
    for (const edit of FORM_EDITS) {
      expected = expected.replace(normalize(edit.from), normalize(edit.to));
    }

    expect(copy).toBe(expected);
  });

  it('в апстриме своя сетка сроков ОСТАЛАСЬ — экспертный режим не тронут', () => {
    // Границы задачи: `src/components/**` не правим. Заодно парная проверка к
    // вычитанию: правки выше сняты с копии, а не с оригинала.
    expect(upstream).toContain('sm:grid-cols-3');
    expect(upstream).toContain('{period.label}');
    expect(upstream).toContain('getMonthlyPriceKopeks(displayPrice, period.days)');
  });
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
