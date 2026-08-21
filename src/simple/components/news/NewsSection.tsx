import { useState, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { newsApi } from '@/api/news';
import { useHapticFeedback } from '@/platform/hooks/useHaptic';
import { cn } from '@/lib/utils';
import { ArrowIcon } from '@/components/icons';
import type { NewsListItem } from '@/types/news';
import { NewsFeedEmpty, NewsFeedError, NewsFeedSkeleton } from './NewsFeedStates';

/**
 * Копия апстримного `src/components/news/NewsSection.tsx` (задача #74).
 *
 * Зачем копия. В апстриме лента новостей — блок на главной; владелец потребовал
 * её отдельной страницей `/news` простого режима. Импортировать оригинал нельзя:
 * `src/components/news/` — не открытый каталог и не в `INFRA_ALLOWLIST`, гейт
 * границ (`scripts/check-mode-boundaries.mjs`) валит сборку, а расширять гейт
 * канон запрещает (docs/architecture/two-modes.md). Оригинал остаётся
 * экспертному режиму нетронутым.
 *
 * Скопировано КАК ЕСТЬ: спека владельца — «функционал ленты не упрощаем, берём
 * апстримный и ставим в другое место». Фильтр категорий, featured-карточка,
 * сетка, «Загрузить ещё» шагом `NEWS_LIMIT`, `safeColor`, анимации и гаптика —
 * дословно апстримные. Отличий от оригинала три, и каждое размечено в коде: имя
 * экспорта, область состояний и снятый заголовок-чип в теле компонента.
 *
 * ⚠️ Копия живая — апстрим правит оригинал каждый синк. Расхождения сторожит
 * `src/simple/components/news/newsSectionCopy.test.ts`: он сверяет с апстримом
 * каждую декларацию файла и тело компонента, вырезая размеченные области
 * расхождения. Снимать сторож можно только вместе с копией.
 */

// --- Security: hex color validation to prevent CSS injection ---
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function safeColor(color: string | null | undefined, fallback = '#888888'): string {
  if (!color || !HEX_COLOR_RE.test(color)) return fallback;
  return color;
}

// --- Animation variants ---
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

const fadeSlideUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.1,
      duration: 0.6,
      ease: EASE_OUT,
    },
  }),
};

// --- Sub-components ---

interface CategoryBadgeProps {
  category: string;
  color: string;
  className?: string;
}

const CategoryBadge = memo(function CategoryBadge({
  category,
  color,
  className,
}: CategoryBadgeProps) {
  const c = safeColor(color);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-widest',
        className,
      )}
      style={{
        color: c,
        background: `${c}15`,
        border: `1px solid ${c}30`,
      }}
    >
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full"
        style={{
          background: c,
          boxShadow: `0 0 8px ${c}`,
        }}
      />
      {category}
    </span>
  );
});

interface TagBadgeProps {
  text: string;
  color: string;
}

const TagBadge = memo(function TagBadge({ text, color }: TagBadgeProps) {
  const c = safeColor(color);
  return (
    <span
      className="inline-block rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider"
      style={{
        color: c,
        border: `1px solid ${c}33`,
        background: `${c}11`,
      }}
    >
      {text}
    </span>
  );
});

interface FilterTabsProps {
  categories: string[];
  active: string;
  onChange: (category: string) => void;
}

const FilterTabs = memo(function FilterTabs({ categories, active, onChange }: FilterTabsProps) {
  const { t } = useTranslation();
  const haptic = useHapticFeedback();

  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('news.title')}>
      {/* "All" tab — empty string means no filter */}
      <button
        role="tab"
        aria-selected={active === ''}
        onClick={() => {
          haptic.selectionChanged();
          onChange('');
        }}
        className={cn(
          'min-h-[44px] rounded-lg px-4 py-2.5 text-xs font-semibold tracking-wide transition-all duration-300',
          active === ''
            ? 'border border-accent-400 bg-accent-400 text-dark-950'
            : 'border border-dark-700 bg-dark-800 text-dark-400 hover:border-accent-400/30 hover:text-accent-400',
        )}
      >
        {t('news.filterAll')}
      </button>
      {categories.map((cat) => {
        const isActive = active === cat;
        return (
          <button
            key={cat}
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              haptic.selectionChanged();
              onChange(cat);
            }}
            className={cn(
              'min-h-[44px] rounded-lg px-4 py-2.5 text-xs font-semibold tracking-wide transition-all duration-300',
              isActive
                ? 'border border-accent-400 bg-accent-400 text-dark-950'
                : 'border border-dark-700 bg-dark-800 text-dark-400 hover:border-accent-400/30 hover:text-accent-400',
            )}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
});

interface FeaturedCardProps {
  item: NewsListItem;
  onClick: () => void;
}

const FeaturedCard = memo(function FeaturedCard({ item, onClick }: FeaturedCardProps) {
  const { t, i18n } = useTranslation();

  return (
    <motion.article
      custom={0}
      variants={fadeSlideUp}
      initial="hidden"
      animate="visible"
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="group col-span-full cursor-pointer rounded-2xl p-px transition-all duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-950"
      style={{
        background:
          'linear-gradient(135deg, rgba(var(--color-accent-400), 0.2), rgba(var(--color-dark-900), 0.2), rgba(var(--color-accent-400), 0.2))',
      }}
      whileHover={{
        background:
          'linear-gradient(135deg, rgba(var(--color-accent-400), 0.4), rgba(var(--color-accent-500), 0.4), rgba(var(--color-accent-400), 0.4))',
      }}
      onClick={onClick}
    >
      <div className="relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[15px] bg-dark-900 p-7 sm:p-10">
        {/* Corner decoration */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-[200px] w-[200px]"
          style={{
            background:
              'radial-gradient(circle at top right, rgba(var(--color-accent-400), 0.08), transparent 70%)',
          }}
        />

        {/* Shimmer top border */}
        <div
          className="absolute -top-px left-[20%] right-[20%] h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(var(--color-accent-400), 0.4), transparent)',
            animation: 'newsShimmer 3s ease-in-out infinite',
          }}
        />

        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <CategoryBadge category={item.category} color={item.category_color} />
            {item.tag && <TagBadge text={item.tag} color={item.category_color} />}
            <span className="ml-auto font-mono text-[11px] text-dark-500">
              {item.read_time_minutes} {t('news.readTime')}
            </span>
          </div>

          <h2 className="mb-3 max-w-[700px] break-words text-2xl font-extrabold leading-tight text-dark-50 transition-colors duration-300 group-hover:text-white sm:text-[28px]">
            {item.title}
          </h2>

          {item.excerpt && (
            <p className="max-w-[600px] text-[15px] leading-relaxed text-dark-400">
              {item.excerpt}
            </p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <span className="font-mono text-xs text-dark-600">
            {item.published_at ? new Date(item.published_at).toLocaleDateString(i18n.language) : ''}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-400 transition-all duration-300 group-hover:gap-2.5">
            {t('news.readMore')}
            <ArrowIcon />
          </span>
        </div>
      </div>
    </motion.article>
  );
});

interface NewsCardProps {
  item: NewsListItem;
  index: number;
  onClick: () => void;
}

const NewsCard = memo(function NewsCard({ item, index, onClick }: NewsCardProps) {
  const { t, i18n } = useTranslation();
  const color = safeColor(item.category_color);

  return (
    <motion.article
      custom={index + 1}
      variants={fadeSlideUp}
      initial="hidden"
      animate="visible"
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="group cursor-pointer rounded-[14px] p-px transition-all duration-[450ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-950"
      style={{
        background:
          'linear-gradient(160deg, rgba(var(--color-dark-700), 0.25), rgba(var(--color-dark-900), 0.25))',
      }}
      whileHover={{
        y: -4,
        background: `linear-gradient(160deg, ${color}55, transparent 60%)`,
      }}
      onClick={onClick}
    >
      <div className="relative flex h-full min-h-[210px] flex-col justify-between overflow-hidden rounded-[13px] bg-dark-900 p-7">
        {/* Subtle corner glow on hover */}
        <div
          className="pointer-events-none absolute -bottom-5 -right-5 h-[100px] w-[100px] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(circle, ${color}08, transparent 70%)`,
          }}
        />

        <div>
          <div className="mb-3.5 flex items-center gap-2.5">
            <span
              className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest"
              style={{ color }}
            >
              <span
                className="h-[5px] w-[5px] rounded-full"
                style={{
                  background: color,
                  boxShadow: `0 0 6px ${color}80`,
                }}
              />
              {item.category}
            </span>
            {item.tag && <TagBadge text={item.tag} color={color} />}
          </div>

          <h3 className="mb-2.5 break-words text-[17px] font-bold leading-snug text-dark-100 transition-colors duration-300 group-hover:text-white">
            {item.title}
          </h3>

          {item.excerpt && (
            <p className="text-[13px] leading-relaxed text-dark-400">{item.excerpt}</p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-dark-700/50 pt-3.5">
          <span className="font-mono text-[11px] text-dark-600">
            {item.published_at ? new Date(item.published_at).toLocaleDateString(i18n.language) : ''}
          </span>
          <span className="font-mono text-[11px] text-dark-500">
            {item.read_time_minutes} {t('news.readTime')}
          </span>
        </div>
      </div>
    </motion.article>
  );
});

// Thin wrapper that binds the per-item click handler without creating a new
// anonymous lambda in the parent's JSX on every render, which would defeat
// the memo on NewsCard.
interface NewsCardWrapperProps {
  item: NewsListItem;
  index: number;
  onCardClick: (slug: string) => void;
}

const NewsCardWrapper = memo(function NewsCardWrapper({
  item,
  index,
  onCardClick,
}: NewsCardWrapperProps) {
  const handleClick = useCallback(() => onCardClick(item.slug), [item.slug, onCardClick]);
  return <NewsCard item={item} index={index} onClick={handleClick} />;
});

// --- Main Component ---

const NEWS_LIMIT = 6;

export function SimpleNewsSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const haptic = useHapticFeedback();
  const [filter, setFilter] = useState<string>('');
  const [limit, setLimit] = useState(NEWS_LIMIT);

  const categoryParam = filter || undefined;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['news', 'list', categoryParam, limit],
    queryFn: () => newsApi.getNews({ category: categoryParam, limit, offset: 0 }),
    // staleTime: serve cached data for 2 min before background re-fetch.
    // gcTime: keep in cache for 10 min so navigating away and back is instant.
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  const categories = data?.categories ?? [];

  // Memoized so FeaturedCard/NewsCard receive stable object references when
  // parent state unrelated to the list changes (e.g. load-more button state).
  const { featured, regular } = useMemo(
    () => ({
      featured: items.find((n) => n.is_featured),
      regular: items.filter((n) => !n.is_featured),
    }),
    [items],
  );

  const handleCardClick = useCallback(
    (slug: string) => {
      haptic.buttonPress();
      navigate(`/news/${slug}`);
    },
    [haptic, navigate],
  );

  const handleLoadMore = useCallback(() => {
    haptic.buttonPress();
    setLimit((prev) => prev + NEWS_LIMIT);
  }, [haptic]);

  const handleFilterChange = useCallback((category: string) => {
    setFilter(category);
    setLimit(NEWS_LIMIT);
  }, []);

  // Stable reference for the featured card — avoids re-rendering FeaturedCard
  // when `featured` is a new object reference but contains the same slug.
  const featuredSlug = featured?.slug;
  const handleFeaturedClick = useCallback(() => {
    if (featuredSlug) handleCardClick(featuredSlug);
  }, [featuredSlug, handleCardClick]);

  /* ФОРК: НАЧАЛО РАСХОЖДЕНИЯ С АПСТРИМОМ — состояния ленты (задача #74).
   *
   * В апстриме здесь стоит `if (items.length === 0) return null;`, и на главной
   * это правильно: лента там — один блок среди других, и пустая она просто
   * исчезает. На ОТДЕЛЬНОЙ странице тот же `return null` даёт пустой экран под
   * заголовком «Новости и обновления»: ни объяснения, ни выхода.
   *
   * Скелетон — по той же причине, что и у апстрима комментарий про мелькание,
   * только вывод обратный: пока данных нет, показывать надо форму ленты, иначе
   * «пока новостей нет» мелькает секунду до их прихода, то есть страница врёт.
   *
   * `isError` апстрим не деструктурирует вовсе — упавший запрос там неотличим от
   * пустого ответа. Здесь он различим, и это обязательно: глобальные настройки
   * (`src/main.tsx`: `retry: 1`, `refetchOnWindowFocus: false`) означают, что
   * после одной неудачной попытки запрос сам не оживёт, и без кнопки повтора
   * человек упирается в тупик.
   *
   * ⚠️ Следующий синк с апстримом попытается «починить» это обратно в
   * `return null`. Не чинить: расхождение сознательное, оно и есть решение
   * владельца по задаче #74. Маркеры границ не декоративные — по ним сторож
   * дрейфа (`newsSectionCopy.test.ts`) вырезает область перед сверкой всего
   * остального с апстримом.
   */
  if (isLoading && items.length === 0) {
    return <NewsFeedSkeleton />;
  }

  if (isError) {
    return <NewsFeedError onRetry={() => void refetch()} />;
  }

  if (items.length === 0) {
    return <NewsFeedEmpty />;
  }
  /* ФОРК: КОНЕЦ РАСХОЖДЕНИЯ */

  return (
    <section className="relative overflow-hidden rounded-2xl bg-dark-850/80 backdrop-blur-xl">
      <div className="px-5 py-8 sm:px-6 sm:py-10">
        {/* Header */}
        <motion.div
          variants={fadeSlideUp}
          custom={0}
          initial="hidden"
          animate="visible"
          className="mb-8"
        >
          {/* ФОРК: НАЧАЛО РАСХОЖДЕНИЯ С АПСТРИМОМ — заголовок ленты (задача #74).

              Здесь у апстрима строка-чип: иконка и `news.title`. На главной она была
              нужна — лента там один блок среди других, и без подписи непонятно, что
              это за карточки. На отдельной странице тем же ключом подписан `h1`
              (`src/simple/pages/News.tsx`), и чип печатал бы «Новости» второй раз на
              том же экране. Решение владельца от 21.08.2026: снять чип, а заголовок
              страницы оставить — он держит общую вертикаль с главной и `/balance`
              (`PAGE_HEADING_BLOCK`).

              Узел `motion.div` вокруг остаётся апстримным как есть: на нём висят
              табы категорий и отступ до сетки карточек.

              ⚠️ Следующий синк принесёт чип обратно как «потерянный при
              копировании» — не возвращать. Маркеры не декоративные: по ним сторож
              дрейфа (`newsSectionCopy.test.ts`) вырезает область перед сверкой
              остального с апстримом.
              ФОРК: КОНЕЦ РАСХОЖДЕНИЯ */}

          {categories.length > 0 && (
            <FilterTabs categories={categories} active={filter} onChange={handleFilterChange} />
          )}
        </motion.div>

        {/* Grid */}
        {items.length > 0 && (
          <div className="space-y-4">
            {featured && <FeaturedCard item={featured} onClick={handleFeaturedClick} />}
            {regular.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
                {regular.map((item, i) => (
                  <NewsCardWrapper
                    key={item.id}
                    item={item}
                    index={i}
                    onCardClick={handleCardClick}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Load more */}
        {!isLoading && items.length < total && (
          <motion.div
            variants={fadeSlideUp}
            custom={6}
            initial="hidden"
            animate="visible"
            className="mt-10 text-center"
          >
            <button
              onClick={handleLoadMore}
              className="min-h-[44px] rounded-xl border border-dark-700 bg-transparent px-8 py-3 text-[13px] font-semibold tracking-wide text-dark-400 transition-all duration-300 hover:border-accent-400/30 hover:text-accent-400"
            >
              {t('news.loadMore')}
            </button>
          </motion.div>
        )}
      </div>
    </section>
  );
}
