import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { balanceApi } from '@/api/balance';
import { subscriptionApi } from '@/api/subscription';
import { API } from '@/config/constants';
import { useCurrency } from '@/hooks/useCurrency';
import { usePlatform } from '@/platform';
import { useAuthStore } from '@/store/auth';
import { displayName } from '@/utils/displayName';
import { uiLocale } from '@/utils/uiLocale';
import { SIMPLE_NS } from '../i18n';
import {
  resolveDashboardSubscription,
  resolveRenewHref,
  type SimpleSubscription,
} from './dashboardState';

/**
 * Главная простого режима.
 *
 * Состав задан владельцем и намеренно короткий: приветствие, баланс, состояние
 * подписки. Рефералка и заработок, промо-предложения, колесо фортуны, лента
 * новостей, подарки, онбординг и чип промо-группы остаются экспертному режиму —
 * это не «пока не сделали», а решение по составу (docs/architecture/two-modes.md).
 *
 * Логику наследуем, пикселями владеем: запросы те же, что у апстримной главной
 * (те же ключи кэша — данные переиспользуются при переключении режима), а вид
 * свой. Отступы, максимальную ширину и навигацию даёт `SimpleShell`.
 */

const ACCENT_BUTTON =
  'flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-500 p-3.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-60';

const SUBTLE_BUTTON =
  'flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-500/15 p-3.5 text-sm font-medium text-accent-400 transition-colors hover:bg-accent-500/25';

const CAPTION = 'text-[11px] font-semibold uppercase tracking-wider text-dark-400';

function formatDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(uiLocale());
}

export function SimpleDashboard() {
  const { t } = useTranslation(SIMPLE_NS);
  const queryClient = useQueryClient();
  const { haptic } = usePlatform();
  const { formatAmount, currencySymbol } = useCurrency();
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);

  // Имя и статус аккаунта могли измениться со времени логина — апстримная
  // главная обновляет их на монтировании, и терять это при подмене страницы
  // нельзя: иначе в простом режиме приветствие отстаёт от профиля.
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const { data: balanceData } = useQuery({
    queryKey: ['balance'],
    queryFn: balanceApi.getBalance,
    staleTime: API.BALANCE_STALE_TIME_MS,
    refetchOnMount: 'always',
  });

  // Список нужен всегда: из него узнаётся сам режим (multi_tariff_enabled), то
  // есть откуда брать подписку. В мультитарифе `/cabinet/subscription` выключен.
  const { data: listData } = useQuery({
    queryKey: ['subscriptions-list'],
    queryFn: () => subscriptionApi.getSubscriptions(),
    staleTime: 60_000,
  });
  const isMultiTariff = listData?.multi_tariff_enabled ?? false;

  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => subscriptionApi.getSubscription(),
    retry: false,
    staleTime: API.BALANCE_STALE_TIME_MS,
    refetchOnMount: 'always',
    enabled: listData !== undefined && !isMultiTariff,
  });

  const state = resolveDashboardSubscription({
    list: listData,
    status: statusData,
    statusLoading,
  });

  const { data: trialInfo } = useQuery({
    queryKey: ['trial-info'],
    queryFn: () => subscriptionApi.getTrialInfo(),
    enabled: state.kind === 'none',
  });

  const activateTrial = useMutation({
    mutationFn: () => subscriptionApi.activateTrial(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['trial-info'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      refreshUser();
    },
  });

  const tap = () => haptic.impact('light');
  const userName = displayName(user);
  const balanceRubles = balanceData?.balance_rubles ?? 0;

  return (
    <div className="space-y-5">
      {/*
        Приветствие двумя строками: мелким «Добро пожаловать,» и крупным именем.
        Одной строкой «Добро пожаловать, Станислав Манченко» рвётся по ширине в
        произвольном месте — имя оказывается разорванным пополам.
      */}
      <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">
        <span className="block text-base font-medium text-dark-300 sm:text-lg">
          {userName ? t('dashboard.greeting') : t('dashboard.greetingNoName')}
        </span>
        {userName && <span className="block">{userName}</span>}
      </h1>

      {/*
        Баланс ВЫШЕ подписки — так решил владелец, когда правил апстримную
        главную (#22): деньги проверяют чаще, чем дату окончания.
      */}
      <div className="bento-card flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className={CAPTION}>{t('dashboard.balance')}</div>
          <div className="mt-1 truncate text-2xl font-bold text-dark-50">
            {formatAmount(balanceRubles)} {currencySymbol}
          </div>
        </div>
        <Link
          to="/balance/top-up"
          onClick={tap}
          className="shrink-0 rounded-2xl bg-accent-500 px-5 py-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-600"
        >
          {t('dashboard.topUp')}
        </Link>
      </div>

      {state.kind === 'loading' && <SubscriptionSkeleton />}

      {state.kind === 'active' && (
        <ActiveCard subscription={state.subscription} onTap={tap} t={t} />
      )}

      {state.kind === 'expired' && (
        <ExpiredCard subscription={state.subscription} onTap={tap} t={t} />
      )}

      {state.kind === 'none' && (
        <div className="space-y-3">
          {trialInfo?.is_available && (
            <div className="bento-card space-y-3">
              <div>
                <div className={CAPTION}>{t('dashboard.trialTitle')}</div>
                <div className="mt-1 text-xl font-bold text-dark-50">
                  {trialInfo.requires_payment
                    ? t('dashboard.trialDaysPaid', {
                        count: trialInfo.duration_days,
                        price: `${formatAmount(trialInfo.price_rubles)} ${currencySymbol}`,
                      })
                    : t('dashboard.trialDaysFree', { count: trialInfo.duration_days })}
                </div>
              </div>
              <button
                type="button"
                className={ACCENT_BUTTON}
                disabled={activateTrial.isPending}
                onClick={() => {
                  tap();
                  activateTrial.mutate();
                }}
              >
                {activateTrial.isPending
                  ? t('dashboard.trialActivating')
                  : t('dashboard.trialActivate')}
              </button>
              {activateTrial.isError && (
                <p className="text-sm text-error-400">
                  {trialErrorText(activateTrial.error) ?? t('dashboard.trialError')}
                </p>
              )}
            </div>
          )}

          <div className="bento-card space-y-3">
            <div>
              <div className="text-lg font-bold text-dark-50">{t('dashboard.noneTitle')}</div>
              <p className="mt-1 text-sm text-dark-400">{t('dashboard.noneHint')}</p>
            </div>
            <Link
              to="/subscription/purchase"
              onClick={tap}
              className={trialInfo?.is_available ? SUBTLE_BUTTON : ACCENT_BUTTON}
            >
              {t('dashboard.choosePlan')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Текст ошибки от бэкенда, если он есть: он конкретнее нашего общего. */
function trialErrorText(error: unknown): string | null {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === 'string' && detail.length > 0 ? detail : null;
}

type CardProps = {
  subscription: SimpleSubscription;
  onTap: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
};

function ActiveCard({ subscription, onTap, t }: CardProps) {
  return (
    <div className="bento-card space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className={CAPTION}>{t('dashboard.subscriptionTitle')}</span>
        {subscription.isTrial && (
          <span className="rounded-md border border-accent-400/25 bg-accent-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-accent-400">
            {t('dashboard.trialBadge')}
          </span>
        )}
      </div>

      <div>
        <div className="text-xl font-bold text-dark-50">
          {t('dashboard.activeUntil', { date: formatDate(subscription.endDate) })}
        </div>
        {/*
          Остаток дней кликабелен и ведёт на продление — правило и его причины
          в resolveRenewHref: у триала и суточного тарифа продлевать нечего, для
          них ссылка ведёт в витрину, а не на тупиковую страницу продления.
        */}
        <Link
          to={resolveRenewHref(subscription)}
          onClick={onTap}
          className="mt-1 inline-flex items-baseline gap-1.5 text-sm text-dark-300 underline-offset-4 transition-colors hover:text-accent-400 hover:underline"
        >
          <span className="font-semibold">
            {t('dashboard.daysLeft', { count: subscription.daysLeft })}
          </span>
          <span className="text-dark-400">{t('dashboard.daysLeftCaption')}</span>
        </Link>
      </div>

      {/*
        Страница подключения сама тянет ссылку и инструкции по параметру `sub`,
        поэтому кнопке не нужен `subscription_url`: она не пропадает, когда
        панель отдала подписку без готовой ссылки (у апстрима блок подключения
        в этом случае исчезает целиком, и человеку некуда нажать).
      */}
      <Link to={`/connection?sub=${subscription.id}`} onClick={onTap} className={ACCENT_BUTTON}>
        {t('dashboard.connect')}
      </Link>
    </div>
  );
}

function ExpiredCard({ subscription, onTap, t }: CardProps) {
  return (
    <div className="bento-card space-y-4">
      <div>
        <span className={CAPTION}>{t('dashboard.subscriptionTitle')}</span>
        <div className="mt-1 text-xl font-bold text-dark-50">{t('dashboard.expiredTitle')}</div>
        <p className="mt-1 text-sm text-dark-400">
          {subscription.endDate
            ? t('dashboard.expiredAt', { date: formatDate(subscription.endDate) })
            : t('dashboard.expiredHint')}
        </p>
      </div>

      <Link to={resolveRenewHref(subscription)} onClick={onTap} className={ACCENT_BUTTON}>
        {t('dashboard.renew')}
      </Link>
    </div>
  );
}

function SubscriptionSkeleton() {
  return (
    <div className="bento-card">
      <div className="skeleton h-4 w-24" />
      <div className="skeleton mt-3 h-7 w-48" />
      <div className="skeleton mt-2 h-4 w-28" />
      <div className="skeleton mt-4 h-12 w-full rounded-2xl" />
    </div>
  );
}
