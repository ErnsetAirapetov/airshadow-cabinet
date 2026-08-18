import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа простой страницы подписки (задача #28).
 *
 * Задача была про РАЗДЕЛЕНИЕ, а не про упрощение: апстримный
 * `src/pages/Subscription.tsx` вернулся к `upstream/main` побайтово, а всё, что
 * форк успел в нём накопить, переехало в копию `src/simple/pages/Subscription.tsx`.
 * Накопил форк ровно две правки, и обе стоит потерять молча: убранный индикатор
 * зоны расхода и `PurchaseCTAButton` без пропа `isMultiTariff`. Ни одна из них не
 * видна ни сборке, ни типам — вернувшийся индикатор просто нарисуется, а лишний
 * проп кнопка примет и поведёт продление в витрину вместо страницы продления.
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются. Компонентных тестов в проекте
 * не бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * страницы потянул бы весь граф приложения и упал бы на разрешении модулей. Тот
 * же приём, что в `balancePage.test.ts` и `topUpPage.test.ts`; цена та же —
 * разбор видит только записанное литералом, поэтому у каждой проверки ниже есть
 * парная «разбор удался».
 *
 * Пара здесь устроена сильнее обычного: каждое утверждение «в копии этого нет»
 * стоит рядом с утверждением «в апстримной странице это есть». Проверка «нет
 * подстроки» проходит и на пустой строке, и на переименованном файле — соседняя
 * проверка на апстримном оригинале не даёт стороже охранять пустоту.
 */

const PAGE = 'src/simple/pages/Subscription.tsx';
/** Апстримная страница — она же ожидаемый результат отката, читаем только текстом. */
const UPSTREAM_PAGE = 'src/pages/Subscription.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const page = read(PAGE);
const upstream = read(UPSTREAM_PAGE);

/** Вызов кнопки покупки — единственный, поэтому берём его целиком тегом. */
function ctaTag(source: string): string {
  return source.match(/<PurchaseCTAButton[^>]*\/>/)?.[0] ?? '';
}

describe('разбор удался', () => {
  it('обе страницы прочитаны и не пусты', () => {
    // Без этого файл, переименованный или удалённый, дал бы пустую строку — и
    // все проверки «в копии этого нет» проходили бы, ничего не охраняя.
    expect(page.length).toBeGreaterThan(10_000);
    expect(upstream.length).toBeGreaterThan(10_000);
  });

  it('копия — простая страница подписки, а не что-то другое', () => {
    expect(page).toContain('export function SimpleSubscription()');
  });

  it('апстримная страница осталась апстримной по форме экспорта', () => {
    expect(upstream).toContain('export default function Subscription()');
  });

  it('вызов кнопки покупки найден в обеих страницах', () => {
    // Пара для проверок ниже: они смотрят на содержимое тега, и сломанная
    // регулярка дала бы пустую строку, в которой `isMultiTariff` не встречается
    // никогда.
    expect(ctaTag(page)).toContain('PurchaseCTAButton');
    expect(ctaTag(upstream)).toContain('PurchaseCTAButton');
  });
});

describe('правка 1: индикатора зоны расхода в копии нет', () => {
  it('в апстримной странице индикатор на месте — иначе проверка ниже пустая', () => {
    // Она же проверка отката: индикатор — то самое, что форк из апстримного
    // файла вырезал, и его возвращение и есть признак чистого апстрима.
    expect(upstream).toContain('t(zone.labelKey)');
  });

  it('в копии подписи зоны нет', () => {
    expect(page).not.toContain('zone.labelKey');
  });

  it('обоснование удаления перенесено в копию, а не потеряно', () => {
    // Комментарий объясняет, почему блока нет; без него следующий читатель
    // вернёт индикатор как «случайно потерянный при копировании».
    expect(page).toContain('Индикатор зоны расхода убран целиком');
  });
});

describe('правка 2: кнопка покупки в нашем варианте', () => {
  it('в апстримной странице проп передаётся — иначе проверка ниже пустая', () => {
    expect(ctaTag(upstream)).toContain('isMultiTariff');
  });

  it('копия зовёт кнопку без isMultiTariff', () => {
    // С пропом апстримная кнопка уводит продление в витрину тарифов вместо
    // `/subscriptions/:id/renew` — молча, со сборкой зелёной.
    expect(ctaTag(page)).not.toContain('isMultiTariff');
  });

  it('копия зовёт нашу кнопку, а не апстримную', () => {
    // Наш вариант живёт в `src/simple/components/subscription/`; апстримный
    // остался экспертному режиму и принимает другой набор пропов.
    expect(page).toContain("from '../components/subscription/PurchaseCTAButton'");
    expect(page).not.toContain("from '@/components/subscription/PurchaseCTAButton'");
  });
});
