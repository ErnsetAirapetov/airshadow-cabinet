import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа простого экрана выбора способа пополнения (задача #55).
 *
 * ⚠️ Файлы читаются ТЕКСТОМ, а не импортируются. Компонентных тестов в проекте не
 * бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * страницы потянул бы весь граф приложения и упал бы на разрешении модулей. Тот
 * же приём, что в `balancePage.test.ts` и `topUpPage.test.ts`; цена та же —
 * разбор видит только то, что записано литералом, поэтому у каждого блока ниже
 * есть парная проверка «разбор удался».
 *
 * Зачем поверх `topUpMethodSelectState.test.ts`: тот проверяет чистую функцию
 * хвоста query, но не то, что страница её ЗОВЁТ и передаёт результат карточкам.
 * Без сторожей ниже можно было выкинуть проброс целиком — и `npm test` остался бы
 * зелёным, а человек, которому не хватило денег на подписку, терял бы и
 * предзаполнение суммы, и возврат к прерванной покупке.
 */

const PAGE = 'src/simple/pages/TopUpMethodSelect.tsx';
const UPSTREAM = 'src/pages/TopUpMethodSelect.tsx';

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Комментарии вырезаны — разбор смотрит только на код. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const rawPage = read(PAGE);
const page = stripComments(rawPage);
const upstream = read(UPSTREAM);

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('разбор экрана выбора способа удался (задача #55)', () => {
  it('файл на месте и опознан', () => {
    // Без этой проверки любой сторож ниже проходил бы на пустой строке.
    //
    // ⚠️ Имя компонента сверяется С открывающей скобкой: `toContain` без неё
    // вырождается в поиск подстроки, и переименование оставило бы сторож зелёным.
    expect(rawPage.length).toBeGreaterThan(1200);
    expect(page).toMatch(/export function SimpleTopUpMethodSelect\(/);
  });

  it('комментарии вырезаны, а код — нет', () => {
    expect(rawPage).toContain('⚠️');
    expect(page).not.toContain('⚠️');
    expect(page).toContain("queryKey: ['payment-methods']");
  });
});

describe('amount и returnTo доезжают до экрана суммы (задача #55)', () => {
  it('страница зовёт чистую функцию хвоста, а не собирает его сама', () => {
    // ⚠️ Единственная причина, по которой экран существует. Правило целиком живёт
    // в `./topUpMethodSelectState`; собранный на странице `URLSearchParams`
    // означал бы, что правило переписано мимо тестов.
    expect(page).toContain("from './topUpMethodSelectState'");
    expect(page).toContain('resolveTopUpSearch(searchParams)');
    expect(page).toContain('useSearchParams()');
  });

  it('результат уходит карточкам пропом search', () => {
    // Вычислить хвост и не передать его — ровно тот молчаливый провал, из-за
    // которого проверка выше в одиночку ничего не стоит.
    expect(page).toMatch(/<PaymentMethodsGrid[^>]*search=\{search\}/s);
  });

  it('хвост не собирается на странице руками', () => {
    // ⚠️ Второй источник истины разъехался бы с первым молча: апстрим кладёт в
    // адрес именно `amount` и `returnTo`, и правило про них должно быть одно.
    expect(countOf(page, 'new URLSearchParams(')).toBe(0);
    expect(countOf(page, "searchParams.get('amount')")).toBe(0);
    expect(countOf(page, "searchParams.get('returnTo')")).toBe(0);
  });
});

describe('состояния экрана сохранены (задача #55)', () => {
  it('заголовок остался — контекст «вы выбираете способ»', () => {
    expect(page).toContain("t('balance.selectPaymentMethod')");
  });

  it('спиннер загрузки на месте', () => {
    // Апстримный экран показывает спиннер, пока запрос способов не ответил.
    expect(page).toContain('isLoading');
    expect(page).toContain('animate-spin');
  });

  it('пустое состояние объяснено текстом', () => {
    // ⚠️ Именно этим экран лучше блока способов на балансе: там пустой список
    // скрывает блок целиком, а здесь пустой экран без объяснения был бы тупиком.
    expect(page).toContain("t('balance.noPaymentMethods')");
    expect(page).toMatch(/paymentMethods\.length === 0/);
  });

  it('ключ запроса общий с балансом и экраном суммы', () => {
    // Дедупликация: те же способы уже запрошены на балансе, лишнего обращения к
    // API экран не добавляет.
    expect(page).toContain("queryKey: ['payment-methods']");
    expect(page).toContain('balanceApi.getPaymentMethods');
  });
});

describe('иконок способов на экране нет (задача #55)', () => {
  it('апстримный PaymentMethodIcon не импортирован', () => {
    // ⚠️ Требование владельца: иконки способов ему не нравятся. Апстримный
    // компонент запрещено и копировать, и импортировать (границы задачи #55).
    expect(page).not.toContain('PaymentMethodIcon');
  });

  it('разбор апстримного экрана удался, и иконки там ЕСТЬ', () => {
    // Парная проверка к предыдущей: без неё она проходила бы и на пустой строке,
    // и при переименовании апстримного компонента. Заодно видно, что экспертный
    // режим свои иконки сохранил — трогать `src/pages/**` задача запрещает.
    expect(upstream.length).toBeGreaterThan(1500);
    expect(upstream).toContain('PaymentMethodIcon');
  });
});
