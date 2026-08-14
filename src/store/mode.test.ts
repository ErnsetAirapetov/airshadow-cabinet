import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStoredMode } from './mode';

/**
 * Тесты репы гоняются в окружении `node` без DOM (vitest.config.ts), поэтому
 * `localStorage` здесь не существует и его надо подставлять руками. Заодно это
 * ровно тот случай, который функция обязана пережить: недоступное хранилище.
 */
function stubStorage(value: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: () => value,
  });
}

describe('readStoredMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('без сохранённого значения отдаёт простой режим — он дефолтный', () => {
    stubStorage(null);
    expect(readStoredMode()).toBe('simple');
  });

  it('возвращает экспертный, если он сохранён', () => {
    stubStorage('expert');
    expect(readStoredMode()).toBe('expert');
  });

  it('на мусор в хранилище отвечает простым режимом, а не мусором', () => {
    stubStorage('EXPERT!!');
    expect(readStoredMode()).toBe('simple');
  });

  it('не падает, когда localStorage бросает исключение', () => {
    // Приватный режим и часть webview именно так себя и ведут. Падать из-за
    // настройки вида нельзя.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });

    expect(() => readStoredMode()).not.toThrow();
    expect(readStoredMode()).toBe('simple');
  });

  it('не падает, когда localStorage вообще отсутствует', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readStoredMode()).toBe('simple');
  });
});
