import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Сторожа самой страницы баланса простого режима (задача #30).
 *
 * ⚠️ Файл читается ТЕКСТОМ, а не импортируется. Компонентных тестов в проекте не
 * бывает: `vitest.config.ts` задаёт `environment: 'node'`, jsdom и
 * testing-library в репе нет, а alias `@/` в тестах не разрешается — импорт
 * страницы потянул бы весь граф приложения и упал бы на разрешении модулей. Тот
 * же приём, что в `src/simple/components/headerActions.test.ts`; цена та же —
 * разбор видит только то, что записано литералом, поэтому у каждого сторожа ниже
 * есть парная проверка «разбор удался».
 *
 * Зачем эти сторожа поверх `balanceState.test.ts`: тот проверяет чистые функции,
 * но не то, что страница их ЗОВЁТ. Без сторожей ниже можно было удалить со
 * страницы весь перехват возврата от платёжного шлюза (или вызов `refreshUser`)
 * — и `npm test` остался бы зелёным.
 *
 * ⚠️ Сторожа акцентной карточки, бенто-сетки и hover-подсветки жили здесь до #55 и
 * уехали в `src/simple/components/paymentMethodsGrid.test.ts` вместе с самим
 * блоком: карточки способов рисует теперь общий компонент, и охранять их по месту
 * прежней прописки было бы охраной пустоты.
 */

const PAGE = 'src/simple/pages/Balance.tsx';

const page = existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : '';

/**
 * Тела вызовов `useEffect(...)` — от слова `useEffect` до парной закрывающей
 * скобки. Балансировка скобок, а не регулярка: у эффекта перехвата внутри свои
 * вызовы со скобками, и `.*?\)` оборвал бы тело на первом же из них.
 */
function useEffectCalls(source: string): string[] {
  const marker = 'useEffect(';
  const calls: string[] = [];
  let from = 0;

  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) break;

    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    calls.push(source.slice(start, i + 1));
    from = i + 1;
  }

  return calls;
}

/** Сколько раз в тексте встречается подстрока. */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('способы пополнения на балансе (задачи #30, #55)', () => {
  it('разбор страницы удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(page.length).toBeGreaterThan(3000);
    expect(page).toContain('export function SimpleBalance');
  });

  it('карточки способов рисует общий компонент, а не своя разметка', () => {
    // Состав акцента, hover и бенто-раскладку сторожит
    // `paymentMethodsGrid.test.ts`; здесь — только то, что страница делегирует.
    expect(page).toContain('<PaymentMethodsGrid methods={paymentMethods} />');
  });

  it('на балансе хвост query карточкам не передаётся', () => {
    // ⚠️ Осознанно: `amount` и `returnTo` живут на экране выбора способа
    // (`/balance/top-up`), а на баланс их никто не кладёт — обе страницы баланса
    // ведут на `/balance/top-up/<id>` без query, так делает и апстрим. Проп
    // `search`, появившийся здесь, означал бы, что параметры взялись из воздуха.
    //
    // ⚠️ Проверка привязана к самому тегу, а не к файлу целиком: `not.toContain`
    // по всей странице уронил бы тест на любом будущем неродственном `search={…}`
    // — например у поля поиска в истории операций — и сообщение про хвост query
    // соврало бы про причину (замечено на ревью MR !35).
    const tags = [...page.matchAll(/<PaymentMethodsGrid\b[^>]*>/g)].map((match) => match[0]);

    // Разбор удался: тег на странице есть ровно один.
    expect(tags).toHaveLength(1);

    expect(tags[0]).not.toContain('search=');
  });

  it('при пустом списке способов блок скрыт целиком', () => {
    // ⚠️ Отличие от экрана выбора способа, и оно намеренное: там пустой список
    // объясняется текстом (`balance.noPaymentMethods`), потому что пустой экран
    // без объяснения — тупик; здесь же вокруг есть и баланс, и промокод, и
    // история, так что блок просто не рисуется.
    expect(page).toContain('paymentMethods && paymentMethods.length > 0');
  });
});

describe('страница зовёт свои же чистые функции (задача #30)', () => {
  const effects = useEffectCalls(page);

  it('разбор эффектов удался — иначе сторожа ниже проходили бы всегда', () => {
    expect(effects.length).toBeGreaterThanOrEqual(2);
    for (const effect of effects) {
      expect(effect).toContain('=> {');
      expect(effect.endsWith(')')).toBe(true);
    }
  });

  it('перехват возврата от платёжного шлюза стоит внутри эффекта', () => {
    // Без него человек, вернувшийся от провайдера, видит баланс и не понимает,
    // прошла оплата или нет.
    expect(page).toContain('resolvePaymentReturnRedirect,');
    expect(page).toContain("} from './balanceState'");

    const intercepting = effects.filter(
      (effect) =>
        effect.includes('resolvePaymentReturnRedirect(searchParams)') &&
        effect.includes('navigate(') &&
        effect.includes('replace: true'),
    );

    expect(intercepting).toHaveLength(1);
    expect(intercepting[0]).toContain('[searchParams, navigate]');
  });

  it('перехват не продублирован в мёртвом коде вне эффектов', () => {
    // Все вызовы разрешителя в файле должны быть внутри тел эффектов: иначе
    // проверка выше остаётся зелёной, пока рабочий вызов уехал в недостижимую
    // ветку, а в эффекте лежит его копия.
    const inEffects = effects.reduce(
      (sum, effect) => sum + countOf(effect, 'resolvePaymentReturnRedirect('),
      0,
    );

    expect(countOf(page, 'resolvePaymentReturnRedirect(')).toBe(inEffects);
  });

  it('пользователь обновляется на маунте — баланс в сторе совпадает с экраном', () => {
    const refreshing = effects.filter(
      (effect) => effect.includes('refreshUser()') && effect.includes('[refreshUser]'),
    );

    expect(refreshing).toHaveLength(1);
  });
});
