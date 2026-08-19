import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа простого экрана покупки (задача #29).
 *
 * ⚠️ Файл читается ТЕКСТОМ, а не импортируется: компонентных тестов в проекте не
 * бывает (`environment: 'node'`, alias `@/` в тестах не разрешается). Цена
 * приёма — разбор видит только литералы, поэтому у каждого блока ниже есть
 * парная проверка «разбор удался».
 *
 * Зачем поверх `subscriptionPurchaseState.test.ts`: тот доказывает, что выбор
 * режима продаж посчитан правильно, но не то, что страница этим выбором
 * ПОЛЬЗУЕТСЯ. Обе ветки продаж обязаны работать; на стенде видна одна, и
 * потерянная вторая обнаружилась бы только жалобой с чужой инсталляции.
 */

const PAGE = 'src/simple/pages/SubscriptionPurchase.tsx';
const UPSTREAM = 'src/pages/SubscriptionPurchase.tsx';
/**
 * Каталог уехал в общую секцию (#69): тот же блок показывает единый экран
 * оплаты, когда тариф подписки отвалился. Сторожа блока переехали вместе с ним
 * — предмет проверки не изменился, изменился адрес.
 */
const SECTION = 'src/simple/components/subscription/purchase/TariffCatalogSection.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны — разбор смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const rawPage = read(PAGE);
const page = stripComments(rawPage);
const rawSection = read(SECTION);
const section = stripComments(rawSection);
const upstream = stripComments(read(UPSTREAM));

/** Все исходники простого режима — для сторожей «во всём слое одна копия». */
function simpleSources(dir = 'src/simple'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) return simpleSources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('разбор экрана покупки удался (задача #29)', () => {
  it('файл на месте и опознан', () => {
    expect(rawPage.length).toBeGreaterThan(1200);
    expect(page).toMatch(/export function SimpleSubscriptionPurchase\(/);
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(rawPage).toContain('⚠️');
    expect(page).not.toContain('⚠️');
    expect(page).toContain("queryKey: ['purchase-options', subscriptionId]");
  });

  it('секция каталога на месте и опознана (#69)', () => {
    // Пара «разбор удался» для всех сторожей секции ниже: без неё они
    // проходили бы на пустой строке после любого переименования файла.
    expect(rawSection.length).toBeGreaterThan(1200);
    expect(section).toMatch(/export function TariffCatalogSection\(/);
    expect(rawSection).toContain('⚠️');
    expect(section).not.toContain('⚠️');
  });

  it('апстримный экран разобран — иначе запреты ниже проходили бы на пустоте', () => {
    expect(upstream.length).toBeGreaterThan(1200);
    expect(upstream).toContain("purchaseOptions?.sales_mode === 'tariffs'");
    expect(upstream).toContain('TariffPickerGrid');
    expect(upstream).toContain('ClassicPurchaseWizard');
  });
});

describe('обе ветки режима продаж доезжают до разметки (задача #29)', () => {
  it('витрина тарифов показывается по showTariffsSection', () => {
    expect(section).toMatch(/\{showTariffsSection && \(/);
    expect(section).toContain('<TariffPickerGrid');
    expect(section).toContain('<TariffPurchaseForm');
  });

  it('классический мастер показывается по showClassicSection', () => {
    // ⚠️ Ветка, которой не видно на стенде: на инсталляции без тарифов это
    // единственный способ купить подписку. Потеряй её — экран там пустой.
    expect(section).toMatch(/\{showClassicSection && classicOptions && \(/);
    expect(section).toContain('<ClassicPurchaseWizard');
    expect(section).toContain('classicOptions={classicOptions}');
  });

  it('«вариантов нет» показывается по showNoOptionsFallback', () => {
    expect(section).toMatch(/\{showNoOptionsFallback && \(/);
    expect(section).toContain("t('subscription.noOptionsAvailable'");
  });

  it('смена тарифа не потеряна', () => {
    // ⚠️ Требование #69 дословно: «Сменить тариф» не трогаем. Лист смены живёт
    // в той же секции и вызывается тем же обработчиком, что до переезда.
    expect(section).toContain('<SwitchTariffSheet');
    expect(section).toContain('onSwitchTariff={(tariffId) => setSwitchTariffId(tariffId)}');
  });

  it('страница каталог сама не рисует — она зовёт секцию (#69)', () => {
    expect(page).toContain('<TariffCatalogSection');
    expect(countOf(page, '<TariffPickerGrid')).toBe(0);
    expect(countOf(page, '<ClassicPurchaseWizard')).toBe(0);
    expect(countOf(page, '<SwitchTariffSheet')).toBe(0);
  });

  it('витрина НЕ показывает баннер про отвалившийся тариф (#69)', () => {
    // ⚠️ Критерий приёмки: человек без подписки видит сетку без баннера.
    // Сюда он и приходит с чистого листа — «Оформить подписку». Сообщение
    // «ваш тариф больше не поддерживается» было бы ложью: терять ему нечего.
    // Мутация «включить баннер в секции по умолчанию» краснеет здесь.
    expect(countOf(page, 'unsupportedTariffBanner')).toBe(0);
    expect(section).toContain('unsupportedTariffBanner = false,');
  });
});

describe('переход «сразу к форме» существует в ЕДИНСТВЕННОЙ реализации (#69)', () => {
  it('состояние выбранного тарифа живёт только в секции', () => {
    // ⚠️ Прямое требование задачи: второй реализации перехода к форме не
    // заводить. Мутация «завести своё showTariffPurchase на экране оплаты»
    // краснеет здесь.
    expect(countOf(section, 'setShowTariffPurchase(true)')).toBe(2);
    expect(countOf(page, 'setShowTariffPurchase')).toBe(0);
    expect(countOf(page, 'selectedTariff')).toBe(0);
  });

  it('оба входа в форму кладут тариф в ОДНО состояние', () => {
    // Выбор в сетке и возврат из листа смены тарифа — две двери, одна комната.
    expect(section).toContain('onExpiredFallback={(tariff) => {');
    expect(section).toContain('onSelectTariff={(tariff) => {');
    expect(countOf(section, 'setSelectedTariff(tariff);')).toBe(2);
  });

  it('во всём простом режиме этот переход написан один раз', () => {
    // ⚠️ Сторож по всему слою, а не по двум файлам: третья копия появится
    // где-нибудь ещё, и её никто не заметит. Список файлов собирается с диска.
    const owners = simpleSources().filter((file) =>
      readFileSync(file, 'utf8').includes('setShowTariffPurchase('),
    );

    expect(owners).toEqual([SECTION]);
  });
});

describe('ветвление живёт в чистом модуле, страница — оболочка (задача #29)', () => {
  it('страница зовёт правила, а не переписывает их', () => {
    expect(page).toContain("from './subscriptionPurchaseState'");
    expect(section).toContain('resolveSalesMode(purchaseOptions)');
    expect(page).toContain('resolvePurchaseScreen({');
    expect(page).toContain('resolvePurchaseTitleKey({');
    expect(page).toContain('resolvePurchaseBackTarget(subscriptionId)');
    expect(page).toContain('resolvePurchaseSubscriptionId(searchParams)');
  });

  it('признак режима продаж ни на странице, ни в секции не вычисляется', () => {
    // ⚠️ Второй источник истины разъехался бы с первым молча: правило про
    // `sales_mode` должно быть одно, и оно покрыто тестами чистого модуля.
    for (const source of [page, section]) {
      expect(countOf(source, 'sales_mode')).toBe(0);
      expect(countOf(source, "'tariffs' in purchaseOptions")).toBe(0);
      expect(countOf(source, 'as ClassicPurchaseOptions')).toBe(0);
    }
  });

  it('лестница заголовка на странице не повторена', () => {
    expect(countOf(page, "t('subscription.newTariff'")).toBe(0);
    expect(countOf(page, "t('subscription.getSubscription')")).toBe(0);
    expect(page).toContain('{t(resolvePurchaseTitleKey({');
  });
});

describe('блоки берутся из своих копий, а не из апстрима (задача #29)', () => {
  it('импорты ведут в src/simple/components', () => {
    // Гейт `scripts/check-mode-boundaries.mjs` это тоже ловит и роняет сборку;
    // сторож здесь дублирует его дёшево и объясняет причину на месте.
    expect(page).toContain("from '../components/subscription/purchase/TariffCatalogSection'");
    expect(page).toContain("from '../components/WebBackButton'");
    expect(section).toContain("from './TariffPickerGrid'");
    expect(section).toContain("from './TariffPurchaseForm'");
    expect(section).toContain("from './ClassicPurchaseWizard'");
    expect(section).toContain("from '../sheets/SwitchTariffSheet'");
  });

  it('апстримные компоненты и страницы не импортируются', () => {
    for (const source of [page, section]) {
      expect(countOf(source, "from '@/components/subscription")).toBe(0);
      expect(countOf(source, "from '@/pages/")).toBe(0);
    }
  });
});

describe('блок «Выберите тариф для продолжения» убран (задача #29)', () => {
  it('в простой копии его нет', () => {
    // ⚠️ Второй изъятый блок экрана. До этой задачи он был убран прямо в
    // апстримном файле; правка откачена, смысл переехал в копию. Вернись блок
    // сюда — простой экран снова начал бы с плашки, которую владелец на стенде
    // не видел и убрать которую просил.
    expect(page).not.toContain('trialUpgrade');
    expect(page).not.toContain('SparklesIcon');
    expect(section).not.toContain('trialUpgrade');
    expect(section).not.toContain('SparklesIcon');
  });

  it('в апстриме он ЕСТЬ — экспертный режим откачен к апстриму', () => {
    // Парная проверка: без неё запрет выше проходил бы на пустой строке и при
    // переименовании апстримных ключей. Заодно видно, что откат состоялся —
    // блок вернулся в экспертный режим, и это принятая цена канона.
    expect(upstream).toContain("t('subscription.trialUpgrade.title')");
    expect(upstream).toContain("t('subscription.trialUpgrade.description')");
    expect(upstream).toContain('subscription?.is_trial &&');
  });

  it('причина изъятия записана в копии, а не только в истории', () => {
    // Комментарий вырезан из `page`, поэтому ищем в сыром тексте: следующий
    // читатель должен понять, почему блока нет, не поднимая git log.
    expect(rawSection).toContain('subscription.trialUpgrade');
    expect(rawSection).toContain('Выберите тариф для продолжения');
  });
});

describe('остальное перенесено как есть (задача #29)', () => {
  it('предупреждения об истёкшей и legacy-подписке сохранены', () => {
    // Спека разрешает убрать ОДИН блок — виджет промо-группы. Эти два несут
    // информацию и остаются.
    expect(section).toContain("t('subscription.expiredBanner.title')");
    expect(section).toContain("t('subscription.legacy.selectTariffTitle')");
  });

  it('закрытие модалок по глобальному уведомлению об успехе сохранено', () => {
    expect(section).toContain('useCloseOnSuccessNotification(handleCloseAllModals)');
  });

  it('признаки рекуррентных оплат доезжают до формы покупки', () => {
    expect(section).toContain('platega_recurrent_enabled');
    expect(section).toContain('lava_recurrent_enabled');
  });

  it('форма покупки пересоздаётся на смене тарифа', () => {
    // `key={selectedTariff.id}` — единственное, что сбрасывает состояние формы.
    expect(section).toContain('key={selectedTariff.id}');
  });

  it('повтор загрузки после ошибки на месте', () => {
    // Один вызов остался странице (ошибка загрузки), второй уехал в секцию
    // пропом `onRetry` — пустое состояние рисует она.
    expect(countOf(page, 'refetchOptions()')).toBe(2);
    expect(section).toContain('onClick={onRetry}');
  });
});
