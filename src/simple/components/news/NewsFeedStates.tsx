import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { NewsIcon } from '@/components/icons';
import { SIMPLE_NS } from '../../i18n';

/**
 * Состояния ленты новостей: загрузка, ошибка, пусто (задача #74).
 *
 * ⚠️ Это НЕ копия апстрима, а наше добавление — единственное, чем простая лента
 * отличается от апстримной. У апстримного `NewsSection` всех трёх состояний нет:
 * пустой ответ, первая загрузка и упавший запрос одинаково дают `return null`.
 * На главной, где лента была одним блоком среди других, это уместно; на
 * отдельной странице `/news` тот же `return null` оставляет человека перед
 * пустым экраном под заголовком.
 *
 * ⚠️ Файл отдельный от копии намеренно, и это не вкусовщина. Копия живая, её
 * сторожит `newsSectionCopy.test.ts` сверкой с апстримом; чем меньше в ней наших
 * строк, тем больше сторож умеет сверять побайтово. Здесь состояния живут
 * целиком, а в копии от них остаются три ветки в одной размеченной области.
 *
 * Строки — наши, из неймспейса `simple`: в апстримных локалях есть только
 * `news.noNews`, а состояний у нас три и каждому нужны заголовок и пояснение.
 * Апстримные `news.*` (`title`, `filterAll`, `readMore`, `loadMore`) при этом
 * продолжают читаться апстримным `t` внутри самой копии.
 */

/**
 * Рамка состояния — та же, что у ленты.
 *
 * Классы повторяют внешний `<section>` копии дословно: состояние обязано занимать
 * на странице ровно то же место и ту же форму, что займёт лента, — иначе экран
 * дёргается в момент прихода данных.
 */
function NewsStateShell({ children }: { children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-dark-850/80 backdrop-blur-xl">
      <div className="px-5 py-8 sm:px-6 sm:py-10">{children}</div>
    </section>
  );
}

/**
 * Первая загрузка.
 *
 * Повторяет форму ленты: строка заголовка, ряд фильтров, featured-карточка и
 * два места под обычные. Высоты взяты из самой ленты (`min-h-[220px]` у
 * featured, `min-h-[210px]` у карточки), чтобы подмена скелетона данными не
 * сдвигала страницу.
 */
export function NewsFeedSkeleton() {
  return (
    <NewsStateShell>
      <div className="mb-8 space-y-3">
        <div className="h-5 w-40 animate-pulse rounded bg-dark-700" />
        <div className="flex flex-wrap gap-1.5">
          <div className="h-11 w-20 animate-pulse rounded-lg bg-dark-700" />
          <div className="h-11 w-24 animate-pulse rounded-lg bg-dark-700" />
          <div className="h-11 w-16 animate-pulse rounded-lg bg-dark-700" />
        </div>
      </div>
      <div className="space-y-4">
        <div className="h-[220px] animate-pulse rounded-2xl bg-dark-800" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="h-[210px] animate-pulse rounded-[14px] bg-dark-800" />
          <div className="h-[210px] animate-pulse rounded-[14px] bg-dark-800" />
        </div>
      </div>
    </NewsStateShell>
  );
}

/**
 * Запрос упал.
 *
 * Вид и поведение — те же, что у ветки ошибки простой главной
 * (`src/simple/pages/Dashboard.tsx`, `state.kind === 'error'`): заголовок,
 * пояснение и кнопка повтора во всю ширину. Второй вид сообщения об ошибке в
 * одном режиме означал бы, что человек учит интерфейс заново на каждом экране.
 */
export function NewsFeedError({ onRetry }: { onRetry: () => void }) {
  const { t: tSimple } = useTranslation(SIMPLE_NS);

  return (
    <NewsStateShell>
      <h2 className="text-base font-semibold text-dark-100">{tSimple('news.errorTitle')}</h2>
      <p className="mt-1 text-sm text-dark-400">{tSimple('news.errorHint')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-500 p-3.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-600"
      >
        {tSimple('news.retry')}
      </button>
    </NewsStateShell>
  );
}

/**
 * Новостей нет вовсе.
 *
 * Кнопки здесь нет намеренно: звать некуда — новости пишет админ, а не
 * пользователь, и «Обновить» на пустом списке предлагало бы человеку чинить то,
 * что не сломано.
 */
export function NewsFeedEmpty() {
  const { t: tSimple } = useTranslation(SIMPLE_NS);

  return (
    <NewsStateShell>
      <div className="py-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-linear-lg bg-dark-800">
          <NewsIcon className="h-8 w-8 text-dark-500" />
        </div>
        <div className="text-base font-semibold text-dark-100">{tSimple('news.emptyTitle')}</div>
        <p className="mt-1 text-sm text-dark-400">{tSimple('news.emptyHint')}</p>
      </div>
    </NewsStateShell>
  );
}
