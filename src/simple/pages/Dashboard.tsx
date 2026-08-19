import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { balanceApi } from '@/api/balance';
import { giftApi } from '@/api/gift';
import { referralApi } from '@/api/referral';
import { subscriptionApi } from '@/api/subscription';
import { API } from '@/config/constants';
import { useAuthStore } from '@/store/auth';
import { displayName } from '@/utils/displayName';
import PromoOffersSection from '../components/PromoOffersSection';
import PendingGiftCard from '../components/dashboard/PendingGiftCard';
import StatsGrid from '../components/dashboard/StatsGrid';
import SubscriptionCardActive from '../components/dashboard/SubscriptionCardActive';
import SubscriptionCardExpired from '../components/dashboard/SubscriptionCardExpired';
import TrialOfferCard from '../components/dashboard/TrialOfferCard';
import { SIMPLE_NS } from '../i18n';
import { resolveDashboardSubscription, resolveSubscriptionPollMs } from './dashboardState';

/**
 * Главная простого режима.
 *
 * ⚠️ Это НЕ новый интерфейс. Простой режим — апстримная главная, сделанная в
 * несколько раз проще: те же блоки, часть выкинута, остальные упрощаются.
 * Отправная точка — наша упрощённая главная из `src/pages/Dashboard.tsx`
 * (коммит `4b1a766`), перенесённая сюда вместе с блоками, которые она рендерит.
 * Блоки лежат копиями в `src/simple/components/**`: апстримные оригиналы
 * остаются экспертному режиму нетронутыми, а копии мы упрощаем дальше.
 *
 * Уже упрощено относительно апстрима: нет онбординга, нет ленты новостей, нет
 * чипа промо-группы, баланс (в `StatsGrid`) стоит выше подписки, приветствие
 * двумя строками, в карточке подписки нет индикатора зоны расхода, остаток дней
 * кликабелен и ведёт на продление.
 *
 * Дальнейшее упрощение владелец диктует по одному блоку за раз.
 */
export function SimpleDashboard() {
  const { t } = useTranslation();
  // Строки простого режима живут в своём неймспейсе; всё, что копии блоков
  // унаследовали от апстрима, продолжает читаться из общего словаря.
  const { t: tSimple } = useTranslation(SIMPLE_NS);
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const queryClient = useQueryClient();
  const [trialError, setTrialError] = useState<string | null>(null);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const { data: balanceData, refetch: refetchBalance } = useQuery({
    queryKey: ['balance'],
    queryFn: balanceApi.getBalance,
    staleTime: API.BALANCE_STALE_TIME_MS,
    refetchOnMount: 'always',
  });

  // ⚠️ Одна подписка — один запрос. Мультитарифных веток здесь нет: дев
  // одно-тарифный, прод уходит с мультитарифа до раскатки нового интерфейса
  // (docs/architecture/two-modes.md). Запрос не ждёт никого — главная это
  // LCP-экран, и запросы уходят параллельно.
  const {
    data: subscriptionResponse,
    isLoading: subLoading,
    isError: subError,
    refetch: refetchSubscription,
  } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => subscriptionApi.getSubscription(),
    retry: false,
    staleTime: API.BALANCE_STALE_TIME_MS,
    refetchOnMount: 'always',
    // ⚠️ Остаток на плитке считается только из полей ответа, а `staleTime` плюс
    // глобально выключенный `refetchOnWindowFocus` держали снапшот до
    // перезагрузки вкладки: корректное «Меньше минуты» (#50) через минуту
    // становилось ложью и висело часами (#58). Шаг опроса зависит от ступени
    // остатка — правило целиком в `resolveSubscriptionPollMs`, здесь только
    // вызов. Читаем данные запроса, а не `state` ниже: `refetchInterval`
    // вычисляется до того, как состояние собрано.
    refetchInterval: (query) => resolveSubscriptionPollMs(query.state.data),
  });

  const state = resolveDashboardSubscription({
    status: subscriptionResponse,
    isLoading: subLoading,
    isError: subError,
  });
  const subscription = subscriptionResponse?.subscription ?? null;

  const { data: trialInfo, isLoading: trialLoading } = useQuery({
    queryKey: ['trial-info'],
    queryFn: () => subscriptionApi.getTrialInfo(),
    enabled: state.kind === 'none',
  });

  const { data: devicesData } = useQuery({
    queryKey: ['devices'],
    queryFn: () => subscriptionApi.getDevices(),
    enabled: !!subscription,
    staleTime: API.BALANCE_STALE_TIME_MS,
  });

  const { data: referralInfo, isLoading: refLoading } = useQuery({
    queryKey: ['referral-info'],
    queryFn: referralApi.getReferralInfo,
  });

  const { data: pendingGifts } = useQuery({
    queryKey: ['pending-gifts'],
    queryFn: giftApi.getPendingGifts,
    staleTime: 30_000,
    retry: false,
  });

  const activateTrialMutation = useMutation({
    mutationFn: () => subscriptionApi.activateTrial(),
    onSuccess: () => {
      setTrialError(null);
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['trial-info'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
      refreshUser();
    },
    onError: (error: { response?: { data?: { detail?: string } } }) => {
      setTrialError(error.response?.data?.detail || t('common.error'));
    },
  });

  // ── Обновление трафика: состояние, мутация, кулдаун ────────────────────
  const [trafficRefreshCooldown, setTrafficRefreshCooldown] = useState(0);
  const [trafficData, setTrafficData] = useState<{
    traffic_used_gb: number;
    traffic_used_percent: number;
    is_unlimited: boolean;
  } | null>(null);

  const refreshTrafficMutation = useMutation({
    mutationFn: () => subscriptionApi.refreshTraffic(subscription?.id),
    onSuccess: (data) => {
      setTrafficData({
        traffic_used_gb: data.traffic_used_gb,
        traffic_used_percent: data.traffic_used_percent,
        is_unlimited: data.is_unlimited,
      });
      localStorage.setItem(
        `traffic_refresh_ts_${subscription?.id ?? 'default'}`,
        Date.now().toString(),
      );
      if (data.rate_limited && data.retry_after_seconds) {
        setTrafficRefreshCooldown(data.retry_after_seconds);
      } else {
        setTrafficRefreshCooldown(30);
      }
      queryClient.invalidateQueries({ queryKey: ['subscription', subscription?.id] });
    },
    onError: (error: {
      response?: { status?: number; headers?: { get?: (key: string) => string } };
    }) => {
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers?.get?.('Retry-After');
        setTrafficRefreshCooldown(retryAfter ? parseInt(retryAfter, 10) : 30);
      }
    },
  });

  useEffect(() => {
    if (trafficRefreshCooldown <= 0) return;
    const timer = setInterval(() => {
      setTrafficRefreshCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [trafficRefreshCooldown]);

  // Автообновление трафика при монтировании, с кэшем на 30 секунд.
  const hasAutoRefreshed = useRef(false);

  useEffect(() => {
    if (!subscription) return;
    if (hasAutoRefreshed.current) return;
    hasAutoRefreshed.current = true;

    const lastRefresh = localStorage.getItem(`traffic_refresh_ts_${subscription?.id ?? 'default'}`);
    const now = Date.now();
    const cacheMs = API.TRAFFIC_CACHE_MS;

    if (lastRefresh && now - parseInt(lastRefresh, 10) < cacheMs) {
      const elapsed = now - parseInt(lastRefresh, 10);
      const remaining = Math.ceil((cacheMs - elapsed) / 1000);
      if (remaining > 0) {
        setTrafficRefreshCooldown(remaining);
      }
      return;
    }

    refreshTrafficMutation.mutate();
  }, [subscription, refreshTrafficMutation]);

  const userName = displayName(user);

  return (
    <div className="space-y-6">
      {/* Приветствие и имя — разными строками. Одной строкой «Добро пожаловать,
          Станислав Манченко» рвётся по ширине экрана в произвольном месте; так
          имя всегда целиком на своей строке и читается как акцент. */}
      <div>
        {userName ? (
          <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">
            <span className="block text-base font-medium text-dark-300 sm:text-lg">
              {tSimple('dashboard.greeting')}
            </span>
            <span className="block">{userName}</span>
          </h1>
        ) : (
          <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">
            {t('dashboard.welcomeNoName')}
          </h1>
        )}
      </div>

      {/* Ожидающие активации подарки */}
      {pendingGifts && pendingGifts.length > 0 && <PendingGiftCard gifts={pendingGifts} />}

      {/* Баланс и рефералка — выше подписки: деньги проверяют чаще, чем дату. */}
      <StatsGrid
        balanceRubles={balanceData?.balance_rubles || 0}
        referralCount={referralInfo?.total_referrals || 0}
        earningsRubles={referralInfo?.available_balance_rubles || 0}
        refLoading={refLoading}
      />

      {/* Карточка подписки */}
      {state.kind === 'loading' && (
        <div className="bento-card">
          <div className="mb-4 flex items-center justify-between">
            <div className="skeleton h-5 w-20" />
            <div className="skeleton h-6 w-16 rounded-full" />
          </div>
          <div className="skeleton mb-3 h-10 w-32" />
          <div className="skeleton mb-3 h-4 w-40" />
          <div className="skeleton h-3 w-full rounded-full" />
          <div className="mt-5">
            <div className="skeleton h-12 w-full rounded-xl" />
          </div>
        </div>
      )}

      {/* Запрос упал и показать нечего. Без этой ветки экран покупки залипал бы
          на скелете навсегда: у запроса `retry: false`, а `refetchOnWindowFocus`
          выключен глобально — сам он не оживёт. */}
      {state.kind === 'error' && (
        <div className="bento-card">
          <h3 className="text-base font-semibold text-dark-100">
            {tSimple('dashboard.errorTitle')}
          </h3>
          <p className="mt-1 text-sm text-dark-400">{tSimple('dashboard.errorHint')}</p>
          <button
            type="button"
            onClick={() => {
              refetchSubscription();
              refetchBalance();
            }}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-500 p-3.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-600"
          >
            {tSimple('dashboard.retry')}
          </button>
        </div>
      )}

      {(state.kind === 'expired' || state.kind === 'limited') && (
        <SubscriptionCardExpired
          subscription={state.subscription}
          balanceKopeks={balanceData?.balance_kopeks ?? 0}
          balanceRubles={balanceData?.balance_rubles ?? 0}
        />
      )}

      {state.kind === 'active' && (
        <SubscriptionCardActive
          subscription={state.subscription}
          trafficData={trafficData}
          refreshTrafficMutation={refreshTrafficMutation}
          trafficRefreshCooldown={trafficRefreshCooldown}
          connectedDevices={devicesData?.total ?? 0}
        />
      )}

      {/* Нет подписки: показываем триал (если доступен) и ВСЕГДА одну явную
          кнопку покупки. Триал не обязателен, чтобы попасть в витрину — раньше
          при доступном триале это был единственный экран без кнопки покупки
          (Telegram-баг #605056/#605063). */}
      {state.kind === 'none' && !trialLoading && (
        <div className="space-y-3">
          {trialInfo?.is_available && (
            <TrialOfferCard
              trialInfo={trialInfo}
              balanceKopeks={balanceData?.balance_kopeks || 0}
              balanceRubles={balanceData?.balance_rubles || 0}
              activateTrialMutation={activateTrialMutation}
              trialError={trialError}
            />
          )}
          <Link
            to="/subscription/purchase"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-500 p-3.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-600"
          >
            <span className="text-base">+</span>{' '}
            {t('subscriptions.browsePlans', 'Посмотреть тарифы и купить подписку')}
          </Link>
        </div>
      )}

      {/* Промо-предложения */}
      <PromoOffersSection />

      {/* Баннера колеса фортуны здесь нет намеренно: решение владельца от
          19.08.2026 — колесо в простом режиме не используется вовсе (#66).
          Вместе с баннером ушёл и запрос `wheel-config`, и запись `/wheel` из
          сквозного списка (`src/simple/passthrough.ts`): вести туда стало нечему,
          а список существует ровно для адресов наших кнопок. Прямая ссылка
          работает по-прежнему — апстримная страница в апстримной оболочке.
          Решение обратимо одной строкой в каждом месте. */}
    </div>
  );
}
