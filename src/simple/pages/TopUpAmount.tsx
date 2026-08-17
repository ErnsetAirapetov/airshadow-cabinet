import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';

import { balanceApi } from '@/api/balance';
import { subscriptionApi } from '@/api/subscription';
import {
  CardIcon,
  CheckIcon,
  CopyIcon,
  CryptoIcon,
  ExclamationIcon,
  ExternalLinkIcon,
  SparklesIcon,
  StarIcon,
} from '@/components/icons';
import BentoCard from '@/components/ui/BentoCard';
import { useCurrency } from '@/hooks/useCurrency';
import { usePromoDiscount } from '@/hooks/usePromoDiscount';
import { useHaptic, usePlatform } from '@/platform';
import { useCloseOnSuccessNotification } from '@/store/successNotification';
import type { PaymentMethod, PaymentMethodOption } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { openPaymentUrl } from '@/utils/openPaymentUrl';
import { checkRateLimit, getRateLimitResetTime, RATE_LIMIT_KEYS } from '@/utils/rateLimit';
import { getSafeRedirectPath } from '@/utils/safeRedirect';
import { saveTopUpPendingInfo } from '@/utils/topUpStorage';
import { BalanceWidget } from '../components/BalanceWidget';
import {
  resolveInitialAmountRubles,
  resolveQuickAmountsLayout,
  resolveQuickAmountsRubles,
  resolveSubscriptionAmounts,
} from './topUpState';

/**
 * Сумма пополнения в простом режиме (задача #53).
 *
 * ⚠️ Это НЕ новый интерфейс, а копия апстримного `src/pages/TopUpAmount.tsx` с
 * тремя изменениями по спеке владельца. Оригинал остаётся экспертному режиму
 * нетронутым.
 *
 * Что изменено:
 *
 *   1. сверху виджет баланса (`BalanceWidget`) — человек видит, сколько денег уже
 *      на счету. На апстримном экране его нет вообще;
 *   2. кнопки быстрых сумм — цены периодов подписки первого доступного тарифа в
 *      порядке витрины покупки, со скидкой промо, округлённые вверх до целого рубля
 *      и отфильтрованные диапазоном метода. Кнопок столько, сколько уцелевших
 *      периодов (спека #56), подписи — только суммы, без сроков;
 *   3. поле суммы предзаполнено ценой за один месяц из того же источника;
 *   4. сетка кнопок подстраивается под их число — раскладку считает
 *      `resolveQuickAmountsLayout`, разметка её только читает (спека #56).
 *
 * Всё остальное перенесено как есть, включая механики, которые легко потерять:
 * канонический рубль (`quickRub`), порядок валидации с rate limit, ветку Telegram
 * Stars, `open_url_direct` с определением Telegram-deep-link, панель готового
 * платежа, `saveTopUpPendingInfo` для экрана результата, возврат по `returnTo` и
 * автофокус поля только вне Telegram.
 *
 * ⚠️ Фолбэки обязательны: экран пополнения работает, даже если запрос цен не
 * ответил или все цены отфильтровались диапазоном метода. Тогда кнопки —
 * апстримные быстрые суммы, а поле — константа `DEFAULT_TOP_UP_RUBLES`. Правила
 * целиком живут в `./topUpState`, здесь только вызовы.
 *
 * ⚠️ Хром — глобальные классы (`bento-card` внутри `BentoCard`) и классы напрямую.
 * `staggerContainer`/`staggerItem` из `@/components/motion/transitions`, которыми
 * апстримный экран анимирует блоки, за границей режимов — вместо `motion.div` с
 * вариантами здесь обычные `div` с теми же классами (тот же приём, что в
 * `src/simple/pages/Balance.tsx`).
 */

const getMethodIcon = (methodId: string) => {
  const id = methodId.toLowerCase();
  if (id.includes('stars')) return <StarIcon />;
  if (id.includes('crypto') || id.includes('ton') || id.includes('usdt')) return <CryptoIcon />;
  return <CardIcon />;
};

const getPreferredOptionId = (options?: PaymentMethod['options']) => {
  if (!options || options.length === 0) return null;

  const sbpOption = options.find((option) => {
    const normalizedId = option.id.toLowerCase();
    const normalizedName = option.name.toLowerCase();
    return (
      normalizedId.includes('sbp') ||
      normalizedName.includes('сбп') ||
      normalizedName.includes('sbp')
    );
  });

  return sbpOption?.id ?? options[0].id;
};

const sortOptionsWithSbpFirst = (options?: PaymentMethod['options']) => {
  if (!options || options.length <= 1) return options ?? [];

  const isPreferredOption = (option: PaymentMethodOption) => {
    const normalizedId = option.id.toLowerCase();
    const normalizedName = option.name.toLowerCase();
    return (
      normalizedId.includes('sbp') ||
      normalizedName.includes('сбп') ||
      normalizedName.includes('sbp')
    );
  };

  return [...options].sort((left, right) => {
    const leftIsPreferred = isPreferredOption(left);
    const rightIsPreferred = isPreferredOption(right);

    if (leftIsPreferred === rightIsPreferred) return 0;
    return leftIsPreferred ? -1 : 1;
  });
};

export function SimpleTopUpAmount() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { methodId } = useParams<{ methodId: string }>();
  const [searchParams] = useSearchParams();
  const { formatAmount, currencySymbol, convertAmount, convertToRub, targetCurrency } =
    useCurrency();
  const { openInvoice, openTelegramLink, openLink, platform } = usePlatform();
  const haptic = useHaptic();
  const inputRef = useRef<HTMLInputElement>(null);

  const returnTo = searchParams.get('returnTo');
  const initialAmountRubles = searchParams.get('amount')
    ? parseFloat(searchParams.get('amount')!)
    : undefined;

  // Fetch payment methods with a real query (dedupes with the method-selection page and
  // Balance via the shared ['payment-methods'] key). A non-reactive getQueryData read used
  // to dead-end on an infinite spinner whenever the cache was cold — reload, browser-back
  // from the provider page, or a deep link straight to this route.
  const { data: methods, isLoading: isMethodsLoading } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: balanceApi.getPaymentMethods,
  });
  const method = methods?.find((m) => m.id === methodId);

  // Цены подписки — источник кнопок быстрых сумм и предзаполнения (спека #53).
  //
  // ⚠️ Форма ключа апстримная — `['purchase-options', subscriptionId]`, как в
  // `src/pages/SubscriptionPurchase.tsx`. Так мы попадаем и в тот же кэш, и в
  // инвалидацию `['purchase-options']`, которую дёргают активация промокода и
  // вебсокет-уведомления. Подписку не передаём: вызов без неё легален и отдаёт
  // витрину тарифов, а второй аргумент ключа при этом равен `undefined` — ровно
  // как у апстримной страницы покупки, открытой без `?subscriptionId`.
  const { data: purchaseOptions, isLoading: isPricesLoading } = useQuery({
    queryKey: ['purchase-options', undefined],
    queryFn: () => subscriptionApi.getPurchaseOptions(),
  });

  // Скидка промо — тем же хуком, что витрина тарифов и форма покупки. Без него
  // кнопка показала бы сумму больше той, которую человек реально заплатит за
  // подписку, и пополнение «ровно на месяц» оказалось бы с лишком.
  const { applyPromoDiscount } = usePromoDiscount();
  const applyDiscount = useCallback(
    (priceKopeks: number) => applyPromoDiscount(priceKopeks).price,
    [applyPromoDiscount],
  );

  // Мемоизация обязательна: массив периодов уходит в зависимости эффекта
  // предзаполнения, и новая ссылка на каждый рендер гоняла бы эффект впустую.
  const { periods: subscriptionPeriods } = useMemo(
    () => resolveSubscriptionAmounts(purchaseOptions),
    [purchaseOptions],
  );

  const handleNavigateBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const handleSuccess = useCallback(() => {
    // returnTo arrives via query string — validate as an in-app path before
    // navigate(), otherwise an absolute or encoded URL produces ugly
    // path artefacts in the URL bar. The validator returns '/' for invalid
    // input; treat that case as "no returnTo" and use the /balance default.
    const safe = getSafeRedirectPath(returnTo);
    navigate(returnTo && safe !== '/' ? safe : '/balance', { replace: true });
  }, [navigate, returnTo]);

  // Keyboard: Escape to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleNavigateBack();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNavigateBack]);

  // Auto-redirect when success notification appears (e.g., balance topped up via WebSocket)
  useCloseOnSuccessNotification(handleSuccess);

  const getInitialAmount = (): string => {
    if (!initialAmountRubles || initialAmountRubles <= 0) return '';
    const converted = convertAmount(initialAmountRubles);
    return targetCurrency === 'IRR' || targetCurrency === 'RUB'
      ? Math.ceil(converted).toString()
      : converted.toFixed(2);
  };

  const initialDisplayAmount = getInitialAmount();
  const [amount, setAmount] = useState(initialDisplayAmount);
  const [error, setError] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(
    getPreferredOptionId(method?.options),
  );
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  // Canonical RUB amount when the user picked a quick-amount chip. The input shows a
  // rounded display-currency value; validating/charging the canonical RUB avoids the FX
  // round-trip that could push a min-amount chip just below the allowed minimum. Cleared
  // as soon as the user edits the field by hand.
  const [quickRub, setQuickRub] = useState<number | null>(null);
  // ⚠️ Выбранная кнопка быстрой суммы — ПОЗИЦИЯ в списке, а не сумма. Сверка одного
  // значения поля с подписью кнопки (`amount === val`) зажигала две кнопки сразу:
  // суммы, совпавшие после округления вверх (25 415 и 25 490 копеек — обе дают
  // 255 ₽), штатны, периоды при этом разные. Выбор — это то, на что нажали,
  // поэтому хранится индекс (задача #56). Сбрасывается в `null` и ручным вводом,
  // и предзаполнением: в обоих случаях в поле лежит уже не сумма кнопки.
  //
  // ⚠️ Одной позиции при этом мало: `quickAmounts` пересчитывается на каждый
  // рендер и МЕНЯЕТ СОСТАВ по ходу жизни экрана, а индекс это переживает. Условие
  // подсветки поэтому сверяет ещё и значение — разбор в `isSelected` ниже.
  const [selectedQuickIndex, setSelectedQuickIndex] = useState<number | null>(null);
  // ⚠️ Выключатель предзаполнения. Цены подписки приходят асинхронно, а человек
  // может начать вводить сумму до ответа — и пришедший ответ стёр бы набранное.
  // Ref, а не состояние: перерисовка от него не нужна, а эффекту ниже нужно
  // видеть значение сразу, в том же кадре, в котором пользователь тронул поле.
  const amountTouchedRef = useRef(false);

  // Once methods have loaded, redirect to method selection if this method id is unknown.
  useEffect(() => {
    if (methods && !method) {
      const params = new URLSearchParams();
      const amount = searchParams.get('amount');
      const rt = searchParams.get('returnTo');
      if (amount) params.set('amount', amount);
      if (rt) params.set('returnTo', rt);
      const qs = params.toString();
      navigate(`/balance/top-up${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [methods, method, navigate, searchParams]);

  useEffect(() => {
    if (!method?.options || method.options.length === 0) {
      if (selectedOption !== null) {
        setSelectedOption(null);
      }
      return;
    }

    const optionExists = method.options.some((option) => option.id === selectedOption);
    if (!optionExists) {
      setSelectedOption(getPreferredOptionId(method.options));
    }
  }, [method?.id, method?.options, selectedOption]);

  // Знаков после запятой столько же, сколько у апстрима: рубль и туман целыми,
  // остальные валюты с копейками.
  const currencyDecimals = targetCurrency === 'IRR' || targetCurrency === 'RUB' ? 0 : 2;
  // Значение для поля из точной рублёвой суммы. Поднято выше раннего возврата,
  // потому что им же пользуется эффект предзаполнения: формула на кнопки и на
  // предзаполнение обязана быть одна.
  //
  // Мотив — совпадение того, что человек читает, с тем, что спишется: рядом с
  // этой строкой всегда ставится канонический рубль (`quickRub`/`setQuickRub`),
  // и разойдись формулы, экран показывал бы 254, а списывал 254,15.
  const getQuickValue = useCallback(
    (rub: number) =>
      targetCurrency === 'IRR'
        ? Math.round(convertAmount(rub)).toString()
        : convertAmount(rub).toFixed(currencyDecimals),
    [convertAmount, currencyDecimals, targetCurrency],
  );

  // Предзаполнение поля суммы (спека #53, пункт 4).
  //
  // ⚠️ Три условия, каждое из которых обязательно:
  //
  //   - `amountTouchedRef` — человек уже вводил сумму или нажал кнопку быстрой
  //     суммы: предзаполнение выключено навсегда. Это ровно тот случай, где
  //     пришедший с опозданием ответ стирает набранное вручную;
  //   - `isPricesLoading` — пока цены не пришли, поле не трогаем вообще. Иначе
  //     оно дёргалось бы: сначала константа, через мгновение реальная цена;
  //   - `method` — без диапазона метода нечем зажимать значение, а незажатое
  //     открывало бы экран с суммой, которую метод не примет.
  //
  // Пока условия не сошлись, в поле лежит то, что положил апстримный
  // `getInitialAmount()`: сумма из `?amount=` или пусто.
  useEffect(() => {
    if (amountTouchedRef.current || isPricesLoading || !method) return;

    const rubles = resolveInitialAmountRubles({
      urlAmount: initialAmountRubles,
      periods: subscriptionPeriods,
      applyDiscount,
      minRubles: method.min_amount_kopeks / 100,
      maxRubles: method.max_amount_kopeks / 100,
    });

    setAmount(getQuickValue(rubles));
    // Канонический рубль — как апстрим делает для `usingPrefill`: в поле лежит
    // округлённое значение отображаемой валюты, а списывать надо точное, иначе
    // FX-округление отбивает сумму на границе минимума.
    setQuickRub(rubles);
    // ⚠️ Выбранной кнопки при предзаполнении нет: в поле лежит цена месяца, а не
    // нажатие человека. Совпадение цены месяца с какой-то из кнопок — случайность,
    // и подсвечивать её значило бы показать выбор, которого не было.
    setSelectedQuickIndex(null);
  }, [
    isPricesLoading,
    method,
    initialAmountRubles,
    subscriptionPeriods,
    applyDiscount,
    getQuickValue,
  ]);

  const starsPaymentMutation = useMutation({
    mutationFn: (amountKopeks: number) => balanceApi.createStarsInvoice(amountKopeks),
    onSuccess: async (data) => {
      if (!data.invoice_url) {
        setError(t('balance.errors.noPaymentLink'));
        return;
      }
      try {
        const status = await openInvoice(data.invoice_url);
        if (status === 'paid') {
          haptic.notification('success');
          setError(null);
          handleSuccess();
        } else if (status === 'failed') {
          haptic.notification('error');
          setError(t('wheel.starsPaymentFailed'));
        }
      } catch (e) {
        setError(t('balance.errors.generic', { details: String(e) }));
      }
    },
    onError: (err: unknown) => {
      haptic.notification('error');
      const axiosError = err as { response?: { data?: { detail?: string }; status?: number } };
      setError(axiosError?.response?.data?.detail || t('balance.errors.invoiceFailed'));
    },
  });

  const topUpMutation = useMutation<
    {
      payment_id: string;
      payment_url?: string;
      invoice_url?: string;
      amount_kopeks: number;
      amount_rubles: number;
      status: string;
      expires_at: string | null;
    },
    unknown,
    number
  >({
    mutationFn: (amountKopeks: number) => {
      if (!method) throw new Error('Method not loaded');
      return balanceApi.createTopUp(amountKopeks, method.id, selectedOption || undefined);
    },
    onSuccess: (data) => {
      const redirectUrl = data.payment_url || data.invoice_url;
      if (redirectUrl) {
        // Save payment info for the result page (do BEFORE possible redirect,
        // иначе после window.location.href этот код не выполнится).
        if (method && data.payment_id) {
          const methodKey = method.id.toLowerCase().replace(/-/g, '_');
          const displayName =
            t(`balance.paymentMethods.${methodKey}.name`, { defaultValue: '' }) || method.name;
          saveTopUpPendingInfo({
            amount_kopeks: data.amount_kopeks,
            method_id: method.id,
            method_name: displayName,
            payment_id: data.payment_id,
            created_at: Date.now(),
          });
        }

        // open_url_direct: seamless флоу как при покупке подарка.
        // window.location.href внутри Telegram MiniApp WebView навигирует
        // в том же контейнере без открытия внешнего браузера. После
        // оплаты return_url возвращает на /balance/top-up/result.
        //
        // t.me/ URL (Telegram Stars, CryptoBot) — всегда через нативный
        // handler (openInvoice / openTelegramLink в setPaymentUrl-ветке).
        // Stars уже отбит раньше через starsPaymentMutation, здесь — защита
        // на случай CryptoBot и других Telegram-deep-link провайдеров.
        // toLowerCase для устойчивости к редким провайдерам, которые могут вернуть
        // URL в нестандартном регистре. Также покрываем tg:// scheme на всякий случай.
        const lowerUrl = redirectUrl.toLowerCase();
        const isTelegramDeepLink =
          lowerUrl.startsWith('https://t.me/') ||
          lowerUrl.startsWith('http://t.me/') ||
          lowerUrl.startsWith('tg://');
        if (method?.open_url_direct && !isTelegramDeepLink) {
          // In the Telegram WebView, same-container navigation to the provider page breaks
          // when it hands off to a bank app via a custom scheme (SBP) — Android shows
          // ERR_UNKNOWN_URL_SCHEME, iOS opens nothing (bug #654272). Open externally there;
          // on web keep same-tab navigation.
          openPaymentUrl(redirectUrl, platform, openLink);
          return;
        }

        setPaymentUrl(redirectUrl);
      }
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '';
      setError(
        detail.includes('not yet implemented') ? t('balance.useBot') : detail || t('common.error'),
      );
    },
  });

  // Auto-focus input (only on desktop — mobile keyboard hides bottom nav)
  useEffect(() => {
    if (platform === 'telegram') return;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [platform]);

  // Spinner only while methods are actually loading. Once the query has resolved without
  // this method, the redirect effect above navigates away (so we render nothing here rather
  // than spinning forever on a cold cache).
  if (!method) {
    if (!isMethodsLoading) {
      return null;
    }
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      </div>
    );
  }

  const hasOptions = method.options && method.options.length > 0;
  const orderedOptions = sortOptionsWithSbpFirst(method.options);
  const minRubles = method.min_amount_kopeks / 100;
  const maxRubles = method.max_amount_kopeks / 100;
  const methodKey = method.id.toLowerCase().replace(/-/g, '_');
  const isStarsMethod = methodKey.includes('stars');
  const methodName =
    t(`balance.paymentMethods.${methodKey}.name`, { defaultValue: '' }) || method.name;

  const handleSubmit = () => {
    setError(null);
    setPaymentUrl(null);
    inputRef.current?.blur();

    if (!checkRateLimit(RATE_LIMIT_KEYS.PAYMENT, 3, 30000)) {
      setError(
        t('balance.errors.rateLimit', { seconds: getRateLimitResetTime(RATE_LIMIT_KEYS.PAYMENT) }),
      );
      return;
    }
    if (hasOptions && !selectedOption) {
      setError(t('balance.errors.selectMethod'));
      return;
    }
    const amountCurrency = parseFloat(amount);
    if (isNaN(amountCurrency) || amountCurrency <= 0) {
      setError(t('balance.errors.enterAmount'));
      return;
    }
    const amountRubles = convertToRub(amountCurrency);

    // Resolve the canonical RUB amount. Prefer an exact source — an unedited prefill or a
    // quick-amount chip — over the display value, whose FX round-trip rounding (e.g. 150₽ at
    // rate 90.66 → "1.65" USD → back to 149.59₽) could push a min selection just below the
    // allowed minimum and block the top-up. quickRub is cleared on any manual edit, so a
    // non-null value means the field still holds that chip's exact amount.
    const userEditedAmount = amount.trim() !== initialDisplayAmount.trim();
    const usingPrefill = !userEditedAmount && !!initialAmountRubles && initialAmountRubles > 0;
    const usingQuick = quickRub !== null;

    let canonicalRubles = amountRubles;
    if (usingPrefill) {
      canonicalRubles = initialAmountRubles as number;
    } else if (usingQuick && quickRub !== null) {
      canonicalRubles = quickRub;
    } else if (targetCurrency !== 'RUB') {
      // Hand-typed non-RUB amount: snap up to the minimum when it lands within one
      // display-currency rounding step below it, so typing the advertised (rounded)
      // minimum isn't rejected by FX rounding.
      const decimals = targetCurrency === 'IRR' ? 0 : 2;
      const roundingStep = convertToRub(10 ** -decimals);
      if (canonicalRubles < minRubles && canonicalRubles >= minRubles - roundingStep) {
        canonicalRubles = minRubles;
      }
    }

    if (canonicalRubles < minRubles || canonicalRubles > maxRubles) {
      setError(t('balance.errors.amountRange', { min: minRubles, max: maxRubles }));
      return;
    }

    // Round for exact sources; ceil a hand-typed amount so float noise never lands sub-kopeck
    // under the chosen value.
    const amountKopeks =
      targetCurrency === 'RUB' || usingPrefill || usingQuick
        ? Math.round(canonicalRubles * 100)
        : Math.ceil(canonicalRubles * 100);
    if (isStarsMethod) {
      starsPaymentMutation.mutate(amountKopeks);
    } else {
      topUpMutation.mutate(amountKopeks);
    }
  };

  // Кнопки быстрых сумм — цены периодов подписки, а при их отсутствии апстримные
  // суммы метода (спека #53, пункт 3). Всё правило целиком в чистой функции.
  const quickAmounts = resolveQuickAmountsRubles({
    periods: subscriptionPeriods,
    method,
    applyDiscount,
  });
  // Раскладка сетки под фактическое число кнопок (спека #56). Разметка её только
  // читает: считать классы в JSX нельзя — Tailwind собирает утилиты, сканируя
  // исходник текстом, и класс из шаблонной строки в CSS не попал бы вообще.
  const quickAmountsLayout = resolveQuickAmountsLayout(quickAmounts.length);
  const isPending = topUpMutation.isPending || starsPaymentMutation.isPending;

  const handleOpenPayment = () => {
    if (!paymentUrl) return;
    if (paymentUrl.includes('t.me/')) {
      openTelegramLink(paymentUrl);
    } else {
      openLink(paymentUrl);
    }
  };

  const handleCopyUrl = async () => {
    if (!paymentUrl) return;
    try {
      await copyToClipboard(paymentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed silently
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {/* Баланс — общий виджет со страницы /balance. Стоит первым блоком в той же
          колонке, что остальные элементы экрана, и своей ширины не задаёт. */}
      <BalanceWidget />

      {/* Header icon and method */}
      <div className="flex items-center gap-4 pb-1">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
            isStarsMethod
              ? 'bg-gradient-to-br from-yellow-500/20 to-orange-500/20 text-yellow-400'
              : 'bg-gradient-to-br from-accent-500/20 to-accent-600/20 text-accent-400'
          }`}
        >
          <div className="flex h-7 w-7 items-center justify-center">{getMethodIcon(method.id)}</div>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-dark-100">{methodName}</h3>
          <p className="text-sm text-dark-400">
            {formatAmount(minRubles, 0)} – {formatAmount(maxRubles, 0)} {currencySymbol}
          </p>
        </div>
      </div>

      {/* Payment options (if any) */}
      {hasOptions && orderedOptions.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-dark-400">{t('balance.paymentMethod')}</label>
          <div className="grid grid-cols-2 gap-2">
            {orderedOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedOption(opt.id)}
                className={`relative rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                  selectedOption === opt.id
                    ? 'bg-accent-500/15 text-accent-400 ring-2 ring-accent-500/40'
                    : 'border border-dark-700/50 bg-dark-800/70 text-dark-300 hover:bg-dark-700/70'
                }`}
              >
                {opt.name}
                {selectedOption === opt.id && (
                  <span className="absolute right-1.5 top-1.5">
                    <span className="block h-2 w-2 rounded-full bg-accent-500" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Amount input + Submit button - inline */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-dark-400">{t('balance.enterAmount')}</label>
        <div className="flex gap-2">
          <div
            className={`relative flex-1 rounded-2xl transition-all duration-200 ${
              isInputFocused
                ? 'bg-dark-800 ring-2 ring-accent-500/50'
                : 'border border-dark-700/50 bg-dark-800/70'
            }`}
          >
            <input
              ref={inputRef}
              type="number"
              inputMode="decimal"
              enterKeyHint="done"
              value={amount}
              onChange={(e) => {
                // ⚠️ Ручной ввод выключает предзаполнение навсегда: иначе ответ
                // запроса цен, пришедший с опозданием, стёр бы набранное.
                amountTouchedRef.current = true;
                setAmount(e.target.value);
                setQuickRub(null);
                setSelectedQuickIndex(null);
              }}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="0"
              className="h-14 w-full bg-transparent px-4 pr-12 text-xl font-bold text-dark-100 placeholder:text-dark-600 focus:outline-none"
              autoComplete="off"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-base font-semibold text-dark-500">
              {currencySymbol}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !amount || parseFloat(amount) <= 0}
            className={`flex h-14 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-2xl px-6 text-base font-bold transition-colors duration-200 ${
              isPending || !amount || parseFloat(amount) <= 0
                ? 'cursor-not-allowed bg-dark-700 text-dark-500'
                : isStarsMethod
                  ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white shadow-lg shadow-yellow-500/25 hover:from-yellow-400 hover:to-orange-400 active:from-yellow-600 active:to-orange-600'
                  : 'bg-accent-500 text-on-accent shadow-lg shadow-accent-500/25 transition-colors hover:bg-accent-400 active:bg-accent-600'
            }`}
          >
            {isPending ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <>
                <SparklesIcon className="h-4 w-4" />
                <span>{t('balance.topUp')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Quick amount buttons — по одной на период тарифа (спека #56) */}
      {quickAmounts.length > 0 && (
        <div className={quickAmountsLayout.gridClassName}>
          {quickAmounts.map((a, index) => {
            const val = getQuickValue(a);
            // ⚠️ Позиция И значение — оба слагаемых обязательны (задача #56).
            //
            // Позиция — дискриминатор: две кнопки с одинаковой после округления
            // вверх суммой штатны (периоды разные, цена совпала), и сверка одного
            // значения зажигала обе.
            //
            // Значение — страховка от протухшего индекса: `quickAmounts`
            // пересчитывается на каждый рендер и МЕНЯЕТ СОСТАВ по ходу жизни
            // экрана. Кнопки рисуются сразу, ещё на апстримном фолбэке, пока
            // запрос цен летит; инвалидация после промокода меняет суммы вообще
            // без смены длины списка. Индекс это переживает — сбрасывают его
            // только ручной ввод и предзаполнение, а предзаполнение после
            // нажатия выключено навсегда (`amountTouchedRef`). Без сверки
            // значения экран врал бы: в поле 500, горит кнопка 799.
            //
            // Выбран этот вариант, а не сброс индекса эффектом по слепку списка:
            // тот же результат ценой ещё одного эффекта и ещё одного состояния,
            // а деградирует он одинаково — подсветка гаснет, а не переезжает на
            // чужую кнопку.
            const isSelected = selectedQuickIndex === index && amount === val;
            // Последняя кнопка добирает остаток неполной строки — иначе в хвосте
            // сетки зияет дыра. Класс считает чистая функция раскладки.
            const isLastAmount = index === quickAmounts.length - 1;
            return (
              <BentoCard
                // ⚠️ Ключ по ИНДЕКСУ, а не по сумме: две цены после скидки могут
                // совпасть, и одинаковый ключ зажигал бы подсветку сразу на обеих
                // кнопках (задача #56).
                key={index}
                as="button"
                type="button"
                onClick={() => {
                  // ⚠️ Как и ручной ввод, выбор кнопки выключает предзаполнение:
                  // иначе пришедший ответ вернул бы цену месяца поверх выбора.
                  amountTouchedRef.current = true;
                  setAmount(val);
                  setQuickRub(a);
                  setSelectedQuickIndex(index);
                  inputRef.current?.blur();
                }}
                hover
                glow={isSelected}
                className={`flex flex-col items-center justify-center px-2 py-3 ${
                  isSelected ? 'border-accent-500/50 bg-accent-500/10' : ''
                } ${isLastAmount ? quickAmountsLayout.lastItemClassName : ''}`}
              >
                <span
                  className={`text-base font-bold ${isSelected ? 'text-accent-400' : 'text-dark-200'}`}
                >
                  {formatAmount(a, 0)}
                </span>
                <span
                  className={`mt-0.5 text-xs ${isSelected ? 'text-accent-400/70' : 'text-dark-500'}`}
                >
                  {currencySymbol}
                </span>
              </BentoCard>
            );
          })}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 p-3">
          <ExclamationIcon className="h-5 w-5 shrink-0 text-error-400" />
          <span className="text-sm text-error-400">{error}</span>
        </div>
      )}

      {/* Payment link display - shown when URL is received */}
      {paymentUrl && (
        <div className="space-y-3 rounded-2xl border border-success-500/20 bg-success-500/10 p-4">
          <div className="flex items-center gap-2 text-success-400">
            <CheckIcon className="h-5 w-5" />
            <span className="font-semibold">{t('balance.paymentReady')}</span>
          </div>

          <p className="text-sm text-dark-400">{t('balance.clickToOpenPayment')}</p>

          <button
            type="button"
            onClick={handleOpenPayment}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-success-500 font-bold text-white transition-colors hover:bg-success-400 active:bg-success-600"
          >
            <ExternalLinkIcon />
            <span>{t('balance.openPaymentPage')}</span>
          </button>

          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 rounded-lg border border-dark-700/50 bg-dark-800/70 px-3 py-2">
              <p className="truncate text-xs text-dark-500">{paymentUrl}</p>
            </div>
            <button
              type="button"
              onClick={handleCopyUrl}
              className={`shrink-0 rounded-lg p-2.5 transition-colors ${
                copied
                  ? 'bg-success-500/20 text-success-400'
                  : 'bg-dark-800/70 text-dark-400 hover:bg-dark-700 hover:text-dark-200'
              }`}
              title={t('common.copy')}
            >
              {copied ? <CheckIcon className="h-5 w-5" /> : <CopyIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
