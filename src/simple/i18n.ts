import i18n from 'i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';

/**
 * Строки простого режима живут в ОТДЕЛЬНОМ неймспейсе `simple`.
 *
 * Зачем: апстримные `src/locales/{ru,en,fa,zh}.json` дают 54 строки расхождения
 * и конфликтуют на каждом синке — апстрим постоянно добавляет туда ключи. Свой
 * неймспейс убирает наши строки из этого файла целиком.
 *
 * Языков два — русский и английский (решение владельца). Аккаунт на фарси или
 * китайском в простом режиме получит английский через обычный fallback i18next.
 */
const NS = 'simple';

function register() {
  i18n.addResourceBundle('ru', NS, ru, true, true);
  i18n.addResourceBundle('en', NS, en, true, true);
}

/**
 * Порядок импортов между `src/i18n.ts` и этим файлом не гарантирован, поэтому не
 * полагаемся на него: если инстанс ещё не поднят — дожидаемся события.
 */
if (i18n.isInitialized) {
  register();
} else {
  i18n.on('initialized', register);
}

export const SIMPLE_NS = NS;
