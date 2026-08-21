import { uiLocale } from '@/utils/uiLocale';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { UseMutationResult } from '@tanstack/react-query';
import TrafficProgressBar from './TrafficProgressBar';
import { useTheme } from '@/hooks/useTheme';
import { useTrafficZone } from '@/hooks/useTrafficZone';
import { formatTraffic } from '@/utils/formatTraffic';
import { getGlassColors } from '@/utils/glassTheme';
import { CalendarIcon, RefreshIcon } from '@/components/icons';
import type { Subscription } from '@/types';
import { ConnectDeviceButton } from '../subscription/ConnectDeviceButton';
import { SIMPLE_NS } from '../../i18n';
import { resolveRenewHref, resolveTimeLeftDisplay } from '../../pages/dashboardState';

/**
 * Копия апстримной `src/components/dashboard/SubscriptionCardActive.tsx`.
 *
 * Простой режим владеет пикселями: оригинал остаётся экспертному режиму
 * нетронутым, а эту копию мы упрощаем дальше по указаниям владельца. Уже
 * упрощено относительно апстрима: убран индикатор зоны расхода (осталась метка
 * пробного периода), убрана ссылка «Посмотреть подписку», остаток дней
 * кликабелен и ведёт на продление.
 *
 * ⚠️ Порядок блоков перебран в #72 и держится на одном правиле: сверху то, зачем
 * человек пришёл. Метка триала → плитки «Тариф» и «Осталось» → кнопка
 * «Подключить устройство» → компактный расход трафика.
 *
 * Что удалено там же и почему — чтобы следующий заход не вернул это обратно:
 *
 *   - **шапка с заголовком «Расход трафика» и процентом в 38-м кегле справа.**
 *     Это и был ложный акцент главной: самая громкая цифра экрана — о трафике,
 *     хотя приходят сюда за балансом и кнопкой подключения. Цифра расхода
 *     осталась в компактном блоке, где ей и место;
 *   - **некомпактный `TrafficProgressBar` и отдельная строка кнопки
 *     обновления.** Обе роли забрал компактный блок — три блока об одном и том
 *     же занимали половину высоты карточки;
 *   - **`Sparkline` вместе с `dailyUsage`.** Массив объявлялся пустым литералом
 *     («placeholder, пока API не отдаёт посуточный расход»), условие
 *     `dailyUsage.length >= 2` не выполнялось никогда, блок не рендерился ни
 *     разу. Отдаст бэкенд посуточный расход — блок пишется заново по живым
 *     данным; копия компонента в простом режиме удалена вместе с ним, апстримный
 *     оригинал остался экспертному режиму нетронутым.
 */

interface SubscriptionCardActiveProps {
  subscription: Subscription;
  trafficData: {
    traffic_used_gb: number;
    traffic_used_percent: number;
    is_unlimited: boolean;
  } | null;
  refreshTrafficMutation: UseMutationResult<unknown, unknown, void, unknown>;
  trafficRefreshCooldown: number;
  connectedDevices: number;
}

export default function SubscriptionCardActive({
  subscription,
  trafficData,
  refreshTrafficMutation,
  trafficRefreshCooldown,
  connectedDevices,
}: SubscriptionCardActiveProps) {
  const { t } = useTranslation();
  const { t: tSimple } = useTranslation(SIMPLE_NS);
  const { isDark } = useTheme();
  const g = getGlassColors(isDark);

  const usedPercent = trafficData?.traffic_used_percent ?? subscription.traffic_used_percent;
  const usedGb = trafficData?.traffic_used_gb ?? subscription.traffic_used_gb;
  const isUnlimited = trafficData?.is_unlimited ?? subscription.traffic_limit_gb === 0;
  // Рамка карточки по-прежнему красится зоной расхода — крупная цифра процента
  // ушла (#72), сам сигнал остался.
  const zone = useTrafficZone(usedPercent);

  const formattedDate = new Date(subscription.end_date).toLocaleDateString(uiLocale());
  const daysLeft = subscription.days_left;
  // Продление недоступно для триала, суточного тарифа и подписки без id — тогда
  // ведём в витрину тарифов вместо тупиковой страницы продления.
  const daysLeftHref = resolveRenewHref(subscription);

  // Последние сутки: бэкенд отдаёт days_left = 0 (`delta.days`, округление
  // вниз), и плитка показывала бы «0 дн.» живой подписке — человек читает это
  // как «уже кончилась» (#34). Тем же округлением вниз в последний час
  // обнуляется и hours_left — без запасной единицы плитка показывала бы
  // «0 ч.» (#38). Правило (спускаться на следующую единицу) заимствовано у
  // апстримного приёма на странице подписки (Subscription.tsx), вынесено в
  // resolveTimeLeftDisplay — см. докстринг и сторож в dashboardState.test.ts.
  // Ниже минуты единицы нет, поэтому на последней ступени цифры не существует:
  // живой подписке вместо «0 м» достаётся терминальная формулировка (#50).
  const timeLeft = resolveTimeLeftDisplay(subscription);
  const timeLeftValue = timeLeft.kind === 'unit' ? timeLeft.value : null;
  const timeLeftLabel =
    timeLeft.kind === 'underMinute'
      ? tSimple('dashboard.timeLeftUnderMinute')
      : timeLeft.unit === 'days'
        ? t('subscription.daysShort')
        : timeLeft.unit === 'hours'
          ? t('subscription.hours')
          : t('subscription.minutes');

  return (
    // ⚠️ Внутренние поля — КЛАССАМИ, а не инлайном (#72): на мобилке они
    // уменьшены (20/20/16 вместо 28/28/24), на `sm:` и шире остались прежними, а
    // инлайн-стиль брейкпоинтов не умеет. Это половина резерва высоты, из
    // которого базовая главная влезает в 390×844; вторая половина — ритм самой
    // страницы, см. `pages/Dashboard.tsx`.
    <div
      className="relative overflow-hidden rounded-3xl p-5 pb-4 sm:p-7 sm:pb-6 lg:backdrop-blur-xl"
      style={{
        background: g.cardBg,
        border: subscription.is_trial
          ? '1px solid rgba(var(--color-accent-400), 0.15)'
          : isDark
            ? `1px solid ${g.cardBorder}`
            : `1px solid rgba(${zone.mainVarRaw}, 0.14)`,
        boxShadow: isDark
          ? g.shadow
          : `0 2px 16px rgba(${zone.mainVarRaw}, 0.07), 0 0 0 1px rgba(${zone.mainVarRaw}, 0.03)`,
      }}
    >
      {/* ─── Метка пробного периода ───
           Всё, что осталось от шапки (#72). Заголовок «Расход трафика» и крупный
           процент справа удалены НАМЕРЕННО, и возвращать их не надо: 38-й кегль
           делал расход самым громким элементом главной, хотя человек приходит
           сюда за балансом и кнопкой «Подключить устройство». Сама цифра расхода
           не потерялась — она в компактном блоке внизу карточки, рядом с
           прогресс-баром, которому и принадлежит. */}
      {subscription.is_trial && (
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-accent-400/25 bg-accent-400/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-accent-400">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t('subscription.trialStatus')}
          </span>
        </div>
      )}

      {/* ─── Stats row: Tariff + Days Left ─── */}
      <div className="mb-2.5 flex gap-2.5">
        {/* Tariff badge — clickable. Neutral chrome: the tariff name has
            no traffic-zone semantics, so tinting it by the traffic zone
            (DESIGN.md Status-Hue Lockout) was wrong. */}
        <Link
          to={`/subscriptions/${subscription.id}`}
          className="flex-1 rounded-[14px] p-3.5 transition-colors"
          style={{
            background: g.innerBg,
            border: `1px solid ${g.innerBorder}`,
          }}
        >
          <div
            className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: g.textFaint }}
          >
            {t('dashboard.tariff')}
          </div>
          <div className="min-w-0 truncate text-base font-bold leading-tight tracking-tight text-dark-50">
            {subscription.tariff_name || t('subscription.currentPlan')}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-dark-50/30">
            {t('dashboard.validUntil', { date: formattedDate })}
          </div>
        </Link>

        {/* Days remaining — clickable: renew for a paid subscription, or
            move to the purchase showcase when leaving a trial (a trial has
            nothing to "renew"). */}
        <Link
          to={daysLeftHref}
          className="flex-1 rounded-[14px] p-3.5 transition-colors duration-300"
          style={{
            background: g.innerBg,
            border:
              daysLeft <= 3
                ? '1px solid rgba(var(--color-warning-400), 0.2)'
                : `1px solid ${g.innerBorder}`,
          }}
        >
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-dark-50/35">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-[7px] transition-colors duration-300"
              style={{
                background: daysLeft <= 3 ? 'rgba(var(--color-warning-400), 0.1)' : g.hoverBg,
              }}
            >
              <span
                style={{
                  color: daysLeft <= 3 ? 'rgb(var(--color-warning-400))' : g.textSecondary,
                }}
                aria-hidden="true"
              >
                <CalendarIcon className="h-[13px] w-[13px]" />
              </span>
            </div>
            {t('dashboard.remaining')}
          </div>
          <div className="flex items-baseline gap-1">
            {/* Терминальная ветка (#50) печатает одну формулировку вместо пары
                «цифра + единица»: цифры для неё не существует, а «0 м» живой
                подписке читается как «уже кончилась». Кегль меньше, чем у
                цифры, — фраза длиннее и в половину ширины строки иначе не
                влезает; цвет остаётся предупреждающим, как у остатка в три дня. */}
            {timeLeftValue === null ? (
              <span
                className="text-[15px] font-bold leading-tight tracking-tight transition-colors duration-300"
                // ⚠️ Цвет здесь БЕЗУСЛОВНЫЙ, и это не упрощение, а починка (#58).
                // Раньше стояло `daysLeft <= 3 ? warning : g.text` — выбор,
                // который всегда считался в warning: в терминальную ветку
                // попадают только нулевые (и отрицательные) дни. Мёртвая
                // развилка читается как настоящая и врёт про правило.
                style={{ color: 'rgb(var(--color-warning-400))' }}
              >
                {timeLeftLabel}
              </span>
            ) : (
              <>
                <span
                  className="text-[22px] font-bold tracking-tight transition-colors duration-300"
                  style={{ color: daysLeft <= 3 ? 'rgb(var(--color-warning-400))' : g.text }}
                >
                  {timeLeftValue}
                </span>
                <span className="text-xs font-medium text-dark-50/25">{timeLeftLabel}</span>
              </>
            )}
          </div>
        </Link>
      </div>

      {/* ─── Connect Device Button ───
           Общий компонент с страницей подписки (#61): до него копий было две, и
           после #59 они разошлись — акцент достался только странице. Различия
           мест вызова здесь ровно два, и оба пропами: отступ и онбординг.

           ⚠️ Стоит ПОД плитками и НАД трафиком (#72): это главное действие
           экрана, и оно должно попадать в первый экран телефона раньше цифр
           расхода. */}
      <ConnectDeviceButton
        subscription={subscription}
        connectedDevices={connectedDevices}
        className="mb-4 sm:mb-5"
        onboardingId="connect-devices"
      />

      {/* ─── Компактный расход трафика ───
           По образцу страницы подписки (`pages/Subscription.tsx`): строка-подпись,
           «использовано / лимит», кнопка обновления и тонкий бар под ними.

           ⚠️ Заменяет собой ТРИ прежних блока — шапку с крупным процентом,
           некомпактный прогресс-бар и отдельную строку кнопки обновления. Все три
           говорили об одном и том же, занимая половину высоты карточки, а
           38-й кегль процента делал расход самым громким элементом главной. Не
           «убрали трафик», а перестали повторять его трижды. */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-dark-50/40">
            {t('subscription.traffic')}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-dark-50/30">
              {isUnlimited
                ? formatTraffic(usedGb)
                : `${formatTraffic(usedGb)} / ${formatTraffic(subscription.traffic_limit_gb)}`}
            </span>
            <button
              onClick={() => refreshTrafficMutation.mutate()}
              disabled={refreshTrafficMutation.isPending || trafficRefreshCooldown > 0}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-dark-50/30 transition-colors hover:bg-dark-50/[0.05] hover:text-dark-50/50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t('common.refresh')}
            >
              <RefreshIcon className="h-3 w-3" spinning={refreshTrafficMutation.isPending} />
              {trafficRefreshCooldown > 0 ? `${trafficRefreshCooldown}s` : t('common.refresh')}
            </button>
          </div>
        </div>
        {subscription.traffic_reset_mode && subscription.traffic_reset_mode !== 'NO_RESET' && (
          <div className="mb-2 text-[10px] text-dark-50/25">
            {t(`subscription.trafficReset.${subscription.traffic_reset_mode}`)}
          </div>
        )}
        <TrafficProgressBar
          usedGb={usedGb}
          limitGb={subscription.traffic_limit_gb}
          percent={usedPercent}
          isUnlimited={isUnlimited}
          compact
        />
      </div>
    </div>
  );
}
