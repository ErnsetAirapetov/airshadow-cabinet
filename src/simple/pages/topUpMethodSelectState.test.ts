import { describe, expect, it } from 'vitest';
import { resolveTopUpSearch } from './topUpMethodSelectState';

/**
 * Query-хвост экрана выбора способа пополнения (задача #55).
 *
 * ⚠️ Это НЕ мелочь, а единственная функция экрана, которой нет у блока способов
 * на балансе. `amount` (недостача в рублях) и `returnTo` (путь прерванной
 * покупки) кладёт `src/components/InsufficientBalancePrompt.tsx` — он вызывается
 * из десяти мест покупки, продления и допоплат трафика и устройств. Потеряв их
 * здесь, человек лишается и предзаполнения суммы, и возврата к покупке: его
 * выкинет на баланс, а покупку он будет собирать заново.
 *
 * Правило вынесено в чистый модуль, потому что компонентных тестов в проекте не
 * бывает (`vitest.config.ts` — `environment: 'node'`): иначе проброс проверялся бы
 * только руками на стенде.
 */

function search(init: Record<string, string>): URLSearchParams {
  return new URLSearchParams(init);
}

describe('resolveTopUpSearch (задача #55)', () => {
  it('оба параметра доезжают, порядок апстримный', () => {
    // Порядок `amount`, потом `returnTo` — как в апстримном
    // `src/pages/TopUpMethodSelect.tsx`. Экран суммы читает параметры по имени,
    // так что порядок для него безразличен, но расхождение с апстримом на пустом
    // месте нам ни к чему.
    expect(resolveTopUpSearch(search({ amount: '150', returnTo: '/subscription' }))).toBe(
      '?amount=150&returnTo=%2Fsubscription',
    );
  });

  it('одна недостающая сумма без возврата', () => {
    expect(resolveTopUpSearch(search({ amount: '150' }))).toBe('?amount=150');
  });

  it('один возврат без суммы — так делает карточка истёкшей подписки', () => {
    expect(resolveTopUpSearch(search({ returnTo: '/subscription' }))).toBe(
      '?returnTo=%2Fsubscription',
    );
  });

  it('обычный вход на экран даёт пустой хвост, а не одинокий вопросительный знак', () => {
    // ⚠️ `'?'` в адресе — не косметика: он остался бы в истории и в ссылке,
    // которой человек может поделиться.
    expect(resolveTopUpSearch(search({}))).toBe('');
  });

  it('пустые значения не превращаются в параметры', () => {
    // `?amount=` бэкенду и экрану суммы ничего не говорит, а `parseFloat('')`
    // даёт `NaN` — экран суммы обрабатывает это как «предзаполнения нет», но
    // тащить мусор в адрес всё равно не надо.
    expect(resolveTopUpSearch(search({ amount: '', returnTo: '' }))).toBe('');
  });

  it('посторонние параметры не переносятся', () => {
    // ⚠️ Осознанно: экран суммы читает только эти два, а всё прочее в адресе —
    // либо мусор от рекламных ссылок, либо параметры возврата платёжного шлюза,
    // которым на экране суммы делать нечего.
    expect(
      resolveTopUpSearch(search({ amount: '150', utm_source: 'bot', status: 'success' })),
    ).toBe('?amount=150');
  });

  it('returnTo кодируется, а не склеивается сырым', () => {
    // Сырой путь с query внутри разорвал бы хвост на части.
    expect(resolveTopUpSearch(search({ returnTo: '/subscription/purchase?id=7&promo=a b' }))).toBe(
      '?returnTo=%2Fsubscription%2Fpurchase%3Fid%3D7%26promo%3Da+b',
    );
  });
});
