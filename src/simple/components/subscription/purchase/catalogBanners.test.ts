import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCatalogBanners } from './catalogBanners';

/**
 * Какие предупреждения показывает секция каталога (задача #71).
 *
 * ⚠️ Перебор — единственный способ это проверить: компонентных тестов в проекте
 * не бывает (`environment: 'node'`, alias `@/` в тестах не разрешается), а
 * состояние «тариф снят с продажи» воспроизводится одной заведённой вручную
 * учёткой. Каждая проверка ниже доказана мутацией в описании.
 */

describe('resolveCatalogBanners: снятый тариф забирает слово у общего баннера (#71)', () => {
  it('баннер про снятый тариф показан — «подписка истекла» молчит', () => {
    // ⚠️ Сердце задачи. Владелец увидел на стенде два предупреждения подряд,
    // говорящие одно и то же: «выберите тариф». Более точное — про снятый
    // тариф — остаётся, общее уходит. Мутация «показывать оба» краснеет здесь.
    expect(
      resolveCatalogBanners({
        unsupportedTariff: true,
        subscriptionExpired: true,
        tariffSelected: false,
      }),
    ).toEqual({ unsupportedTariff: true, expired: false });
  });

  it('истёкшая подписка с живым тарифом — общий баннер на месте', () => {
    // ⚠️ Обратный случай, прямо оговорённый задачей. Сюда приходит человек с
    // витрины `/subscription/purchase`: тариф у него в продаже, снятого тарифа
    // нет, и единственное, что ему надо сказать — что подписка истекла.
    expect(
      resolveCatalogBanners({
        unsupportedTariff: false,
        subscriptionExpired: true,
        tariffSelected: false,
      }),
    ).toEqual({ unsupportedTariff: false, expired: true });
  });

  it('человек выбрал тариф — баннер про старый убран, но и общий не всплывает', () => {
    // ⚠️ Молчание общего баннера считается по ВХОДУ, а не по видимости первого.
    // Считай мы по видимости — на форме оплаты вместо исчезнувшего баннера про
    // снятый тариф всплыл бы «подписка истекла», то есть два баннера
    // превратились бы в один мигающий. Мутация «expired = ... && !unsupportedTariff-видимый»
    // краснеет здесь.
    expect(
      resolveCatalogBanners({
        unsupportedTariff: true,
        subscriptionExpired: true,
        tariffSelected: true,
      }),
    ).toEqual({ unsupportedTariff: false, expired: false });
  });

  it('подписка не истекла и тариф жив — не показываем ничего', () => {
    expect(
      resolveCatalogBanners({
        unsupportedTariff: false,
        subscriptionExpired: false,
        tariffSelected: false,
      }),
    ).toEqual({ unsupportedTariff: false, expired: false });
  });

  it('снятый тариф без признака «истекла» — свой баннер всё равно нужен', () => {
    // Тариф снимают с продажи и у действующей подписки: `subscription_is_expired`
    // тогда `false`, а сказать про снятый тариф всё равно надо.
    expect(
      resolveCatalogBanners({
        unsupportedTariff: true,
        subscriptionExpired: false,
        tariffSelected: false,
      }),
    ).toEqual({ unsupportedTariff: true, expired: false });
  });

  it('выбранный тариф общий баннер НЕ гасит — гасит его только снятый тариф', () => {
    // ⚠️ Витрина: человек с истёкшей подпиской открыл форму покупки. Баннера
    // про снятый тариф там нет вовсе, и глушить «подписка истекла» нечем —
    // апстримное поведение сохраняется дословно.
    expect(
      resolveCatalogBanners({
        unsupportedTariff: false,
        subscriptionExpired: true,
        tariffSelected: true,
      }),
    ).toEqual({ unsupportedTariff: false, expired: true });
  });
});

/**
 * ⚠️ Второй слой сторожа: правило посчитано верно — но следует ли ему разметка?
 *
 * Секция читается ТЕКСТОМ, а не импортируется: компонентных тестов в проекте не
 * бывает. Цена приёма — разбор видит только литералы, поэтому у блока есть
 * парная проверка «разбор удался».
 */

const SECTION = 'src/simple/components/subscription/purchase/TariffCatalogSection.tsx';
const RULE = 'src/simple/components/subscription/purchase/catalogBanners.ts';

/** Все исходники простого режима — для сторожа «во всём слое одна копия». */
function simpleSources(dir = 'src/simple'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) return simpleSources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

/** Комментарии вырезаны — разбор смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const rawSection = readFileSync(SECTION, 'utf8');
const section = stripComments(rawSection);

describe('разметка каталога следует правилу, а не заводит своё (задача #71)', () => {
  it('секция на месте и опознана', () => {
    // Без этой пары все запреты ниже проходили бы на пустой строке.
    expect(rawSection.length).toBeGreaterThan(1200);
    expect(section).toMatch(/export function TariffCatalogSection\(/);
    expect(rawSection).toContain('⚠️');
    expect(section).not.toContain('⚠️');
  });

  it('оба баннера рисуются по результату одного вызова правила', () => {
    expect(section).toContain('resolveCatalogBanners({');
    expect(section).toContain('{banners.unsupportedTariff && (');
    expect(section).toContain('{banners.expired && (');
    expect(countOf(section, 'resolveCatalogBanners(')).toBe(1);
  });

  it('прежних независимых условий в разметке не осталось', () => {
    // ⚠️ Ровно они и давали два баннера подряд: каждое проверяло своё и про
    // соседа не знало. Мутация «вернуть условие в разметку» краснеет здесь.
    expect(countOf(section, 'unsupportedTariffBanner && !showTariffPurchase')).toBe(0);
    expect(countOf(section, 'purchaseOptions.subscription_is_expired && (')).toBe(0);
  });

  it('оба текста баннеров на месте — убрано условие, а не сообщение', () => {
    // ⚠️ Апстримный блок «подписка истекла» НЕ удалён: у истёкшей подписки с
    // живым тарифом он показывается как раньше. Удали его — красное здесь.
    expect(section).toContain("tSimple('subscription.unsupportedTariff.title')");
    expect(section).toContain("t('subscription.expiredBanner.title')");
    expect(section).toContain("t('subscription.expiredBanner.selectTariff')");
  });

  it('правило записано в единственном месте', () => {
    const owners = simpleSources().filter((file) =>
      readFileSync(file, 'utf8').includes('export function resolveCatalogBanners('),
    );

    expect(owners).toEqual([RULE]);
  });
});
