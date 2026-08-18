import { existsSync, readFileSync } from 'node:fs';
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

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны — разбор смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const rawPage = read(PAGE);
const page = stripComments(rawPage);
const upstream = stripComments(read(UPSTREAM));

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

  it('апстримный экран разобран — иначе запреты ниже проходили бы на пустоте', () => {
    expect(upstream.length).toBeGreaterThan(1200);
    expect(upstream).toContain("purchaseOptions?.sales_mode === 'tariffs'");
    expect(upstream).toContain('TariffPickerGrid');
    expect(upstream).toContain('ClassicPurchaseWizard');
  });
});

describe('обе ветки режима продаж доезжают до разметки (задача #29)', () => {
  it('витрина тарифов показывается по showTariffsSection', () => {
    expect(page).toMatch(/\{showTariffsSection && \(/);
    expect(page).toContain('<TariffPickerGrid');
    expect(page).toContain('<TariffPurchaseForm');
  });

  it('классический мастер показывается по showClassicSection', () => {
    // ⚠️ Ветка, которой не видно на стенде: на инсталляции без тарифов это
    // единственный способ купить подписку. Потеряй её — экран там пустой.
    expect(page).toMatch(/\{showClassicSection && classicOptions && \(/);
    expect(page).toContain('<ClassicPurchaseWizard');
    expect(page).toContain('classicOptions={classicOptions}');
  });

  it('«вариантов нет» показывается по showNoOptionsFallback', () => {
    expect(page).toMatch(/\{showNoOptionsFallback && \(/);
    expect(page).toContain("t('subscription.noOptionsAvailable'");
  });

  it('смена тарифа не потеряна', () => {
    expect(page).toContain('<SwitchTariffSheet');
    expect(page).toContain('onSwitchTariff={(tariffId) => setSwitchTariffId(tariffId)}');
  });
});

describe('ветвление живёт в чистом модуле, страница — оболочка (задача #29)', () => {
  it('страница зовёт правила, а не переписывает их', () => {
    expect(page).toContain("from './subscriptionPurchaseState'");
    expect(page).toContain('resolveSalesMode(purchaseOptions)');
    expect(page).toContain('resolvePurchaseScreen({');
    expect(page).toContain('resolvePurchaseTitleKey({');
    expect(page).toContain('resolvePurchaseBackTarget(subscriptionId)');
    expect(page).toContain('resolvePurchaseSubscriptionId(searchParams)');
  });

  it('признак режима продаж на странице не вычисляется', () => {
    // ⚠️ Второй источник истины разъехался бы с первым молча: правило про
    // `sales_mode` должно быть одно, и оно покрыто тестами чистого модуля.
    expect(countOf(page, 'sales_mode')).toBe(0);
    expect(countOf(page, "'tariffs' in purchaseOptions")).toBe(0);
    expect(countOf(page, 'as ClassicPurchaseOptions')).toBe(0);
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
    expect(page).toContain("from '../components/subscription/purchase/TariffPickerGrid'");
    expect(page).toContain("from '../components/subscription/purchase/TariffPurchaseForm'");
    expect(page).toContain("from '../components/subscription/purchase/ClassicPurchaseWizard'");
    expect(page).toContain("from '../components/subscription/sheets/SwitchTariffSheet'");
    expect(page).toContain("from '../components/WebBackButton'");
  });

  it('апстримные компоненты и страницы не импортируются', () => {
    expect(countOf(page, "from '@/components/subscription")).toBe(0);
    expect(countOf(page, "from '@/pages/")).toBe(0);
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
    expect(rawPage).toContain('subscription.trialUpgrade');
    expect(rawPage).toContain('Выберите тариф для продолжения');
  });
});

describe('остальное перенесено как есть (задача #29)', () => {
  it('предупреждения об истёкшей и legacy-подписке сохранены', () => {
    // Спека разрешает убрать ОДИН блок — виджет промо-группы. Эти два несут
    // информацию и остаются.
    expect(page).toContain("t('subscription.expiredBanner.title')");
    expect(page).toContain("t('subscription.legacy.selectTariffTitle')");
  });

  it('закрытие модалок по глобальному уведомлению об успехе сохранено', () => {
    expect(page).toContain('useCloseOnSuccessNotification(handleCloseAllModals)');
  });

  it('признаки рекуррентных оплат доезжают до формы покупки', () => {
    expect(page).toContain('platega_recurrent_enabled');
    expect(page).toContain('lava_recurrent_enabled');
  });

  it('форма покупки пересоздаётся на смене тарифа', () => {
    // `key={selectedTariff.id}` — единственное, что сбрасывает состояние формы.
    expect(page).toContain('key={selectedTariff.id}');
  });

  it('повтор загрузки после ошибки на месте', () => {
    expect(countOf(page, 'refetchOptions()')).toBe(2);
  });
});
