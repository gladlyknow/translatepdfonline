import { getTranslations } from 'next-intl/server';

import {
  PaymentInterval,
  PaymentOrder,
  PaymentPrice,
  PaymentType,
} from '@/extensions/payment/types';
import { getSnowId, getUuid } from '@/shared/lib/hash';
import { respData, respErr } from '@/shared/lib/resp';
import { getAllConfigs } from '@/shared/models/config';
import {
  createOrder,
  NewOrder,
  OrderStatus,
  updateOrderByOrderNo,
} from '@/shared/models/order';
import { getUserInfo } from '@/shared/models/user';
import { PaymentManager } from '@/extensions/payment';
import { getPaymentService } from '@/shared/services/payment';
import { PricingCurrency } from '@/shared/types/blocks/pricing';

/**
 * 解析实际可用的支付渠道：优先请求体 → 后台默认；若默认未启用（如仍为 stripe 但未开），回退到已注册的第一个渠道。
 */
function resolveCheckoutPaymentProviderName(
  paymentService: PaymentManager,
  explicitFromClient: string | undefined,
  configDefault: string | undefined
): string | null {
  const registered = paymentService.getProviderNames();
  if (registered.length === 0) return null;
  const reg = new Set(registered);
  const candidates = [
    typeof explicitFromClient === 'string' ? explicitFromClient.trim() : '',
    typeof configDefault === 'string' ? configDefault.trim() : '',
  ].filter(Boolean);
  for (const name of candidates) {
    if (reg.has(name)) return name;
  }
  const fallback = paymentService.getDefaultProvider();
  if (fallback?.name && reg.has(fallback.name)) return fallback.name;
  return registered[0] ?? null;
}

export async function POST(req: Request) {
  try {
    const { product_id, currency, locale, payment_provider, metadata } =
      await req.json();
    if (!product_id) {
      return respErr('product_id is required');
    }

    const t = await getTranslations({
      locale: locale || 'en',
      namespace: 'pages.pricing',
    });
    const pricing = t.raw('page.sections.pricing');

    const pricingItem = pricing.items.find(
      (item: any) => item.product_id === product_id
    );

    if (!pricingItem) {
      return respErr('pricing item not found');
    }

    if (!pricingItem.product_id && !pricingItem.amount) {
      return respErr('invalid pricing item');
    }

    // get sign user
    const user = await getUserInfo();
    if (!user || !user.email) {
      return respErr('no auth, please sign in');
    }

    // get configs
    const configs = await getAllConfigs();

    const paymentService = await getPaymentService();

    let paymentProviderName = resolveCheckoutPaymentProviderName(
      paymentService,
      payment_provider,
      configs.default_payment_provider
    );
    if (!paymentProviderName) {
      return respErr('no payment provider configured');
    }

    // Validate payment provider against allowed providers
    // First check currency-specific payment_providers if currency is provided
    let allowedProviders: string[] | undefined;

    if (
      currency &&
      currency.toLowerCase() !== (pricingItem.currency || 'usd').toLowerCase()
    ) {
      const selectedCurrencyData = pricingItem.currencies?.find(
        (c: PricingCurrency) =>
          c.currency.toLowerCase() === currency.toLowerCase()
      );
      allowedProviders = selectedCurrencyData?.payment_providers;
    }

    // Fallback to default payment_providers if not found in currency config
    if (!allowedProviders || allowedProviders.length === 0) {
      allowedProviders = pricingItem.payment_providers;
    }

    // If payment_providers is configured, validate the selected provider
    if (allowedProviders && allowedProviders.length > 0) {
      if (!allowedProviders.includes(paymentProviderName)) {
        return respErr(
          `payment provider ${paymentProviderName} is not supported for this currency`
        );
      }
    }

    const paymentProvider = paymentService.getProvider(paymentProviderName);
    if (!paymentProvider || !paymentProvider.name) {
      return respErr('no payment provider configured');
    }

    // checkout currency and amount - calculate from server-side data only (never trust client input)
    // Security: currency can be provided by frontend, but amount must be calculated server-side
    const defaultCurrency = (pricingItem.currency || 'usd').toLowerCase();
    let checkoutCurrency = defaultCurrency;
    let checkoutAmount = pricingItem.amount;

    // If currency is provided, validate it and find corresponding amount from server-side data
    if (currency) {
      const requestedCurrency = currency.toLowerCase();

      // Check if requested currency is the default currency
      if (requestedCurrency === defaultCurrency) {
        checkoutCurrency = defaultCurrency;
        checkoutAmount = pricingItem.amount;
      } else if (pricingItem.currencies && pricingItem.currencies.length > 0) {
        // Find amount for the requested currency in currencies list
        const selectedCurrencyData = pricingItem.currencies.find(
          (c: PricingCurrency) => c.currency.toLowerCase() === requestedCurrency
        );
        if (selectedCurrencyData) {
          // Valid currency found, use it
          checkoutCurrency = requestedCurrency;
          checkoutAmount = selectedCurrencyData.amount;
        }
        // If currency not found in list, fallback to default (already set above)
      }
      // If no currencies list exists, fallback to default (already set above)
    }

    // get payment interval
    const paymentInterval: PaymentInterval =
      pricingItem.interval || PaymentInterval.ONE_TIME;

    // get payment type
    const paymentType =
      paymentInterval === PaymentInterval.ONE_TIME
        ? PaymentType.ONE_TIME
        : PaymentType.SUBSCRIPTION;

    const orderNo = getSnowId();

    // get payment product id from pricing table in local file
    // First try to get currency-specific payment_product_id
    let paymentProductId = '';

    // If currency is provided and different from default, check currency-specific payment_product_id
    if (currency && currency.toLowerCase() !== defaultCurrency) {
      const selectedCurrencyData = pricingItem.currencies?.find(
        (c: PricingCurrency) =>
          c.currency.toLowerCase() === currency.toLowerCase()
      );
      if (selectedCurrencyData?.payment_product_id) {
        paymentProductId = selectedCurrencyData.payment_product_id;
      }
    }

    // Fallback to default payment_product_id if not found in currency config
    if (!paymentProductId) {
      paymentProductId = pricingItem.payment_product_id || '';
    }

    // If still not found, get from payment provider's config
    if (!paymentProductId) {
      paymentProductId = await getPaymentProductId(
        pricingItem.product_id,
        paymentProviderName,
        checkoutCurrency
      );
    }

    // get preset promotion code for product_id
    const promotionCode = await getPromotionCode(
      product_id,
      paymentProviderName,
      checkoutCurrency
    );

    // build checkout price with correct amount for selected currency
    const checkoutPrice: PaymentPrice = {
      amount: checkoutAmount,
      currency: checkoutCurrency,
    };

    if (!paymentProductId) {
      // checkout price validation
      if (!checkoutPrice.amount || !checkoutPrice.currency) {
        return respErr('invalid checkout price');
      }
    } else {
      paymentProductId = paymentProductId.trim();
    }

    if (
      paymentProvider.name === 'creem' &&
      !String(paymentProductId || '').trim()
    ) {
      return respErr(
        `Creem product ID missing for pricing product_id "${pricingItem.product_id}". Configure Admin → Payment → Creem Product IDs Mapping (creem_product_ids JSON), or add payment_product_id in en/zh pages/pricing.json. See frontend/docs/creem-checkout-setup.md.`
      );
    }

    let callbackBaseUrl = `${configs.app_url}`;
    if (locale && locale !== configs.default_locale) {
      callbackBaseUrl += `/${locale}`;
    }

    const callbackUrl =
      paymentType === PaymentType.SUBSCRIPTION
        ? `${callbackBaseUrl}/settings/billing`
        : `${callbackBaseUrl}/settings/payments`;

    const isTrialSubscription =
      paymentType === PaymentType.SUBSCRIPTION &&
      Boolean(pricingItem.trial_subscription);

    // build checkout order
    const checkoutOrder: PaymentOrder = {
      description: pricingItem.product_name,
      customer: {
        name: user.name,
        email: user.email,
      },
      type: paymentType,
      metadata: {
        app_name: configs.app_name,
        order_no: orderNo,
        user_id: user.id,
        ...(metadata || {}),
        ...(isTrialSubscription
          ? {
              trial_subscription: 'true',
              subscription_cycle_credits: String(pricingItem.credits ?? 0),
            }
          : {}),
      },
      successUrl: `${configs.app_url}/api/payment/callback?order_no=${orderNo}`,
      cancelUrl: `${callbackBaseUrl}/pricing`,
    };

    // checkout with predefined product
    if (paymentProductId) {
      checkoutOrder.productId = paymentProductId;
    }

    // checkout dynamically
    checkoutOrder.price = checkoutPrice;
    if (paymentType === PaymentType.SUBSCRIPTION) {
      // subscription mode
      checkoutOrder.plan = {
        interval: paymentInterval,
        name: pricingItem.product_name,
      };
    } else {
      // one-time mode
    }

    if (promotionCode) {
      checkoutOrder.discount = {
        code: promotionCode,
      };
    }

    const currentTime = new Date();

    // build order info
    const order: NewOrder = {
      id: getUuid(),
      orderNo: orderNo,
      userId: user.id,
      userEmail: user.email,
      status: OrderStatus.PENDING,
      amount: checkoutAmount, // use the amount for selected currency
      currency: checkoutCurrency,
      productId: pricingItem.product_id,
      paymentType: paymentType,
      paymentInterval: paymentInterval,
      paymentProvider: paymentProvider.name,
      checkoutInfo: JSON.stringify(checkoutOrder),
      createdAt: currentTime,
      productName: pricingItem.product_name,
      description: pricingItem.description,
      callbackUrl: callbackUrl,
      creditsAmount: pricingItem.credits,
      creditsValidDays: pricingItem.valid_days,
      planName: pricingItem.plan_name || '',
      paymentProductId: paymentProductId,
      discountCode: promotionCode,
    };

    // create order
    await createOrder(order);

    try {
      // create payment
      const result = await paymentProvider.createPayment({
        order: checkoutOrder,
      });

      const creemParams = result.checkoutParams || {};
      const mergedCheckoutInfo = {
        ...creemParams,
        metadata: {
          ...(typeof creemParams.metadata === 'object' &&
          creemParams.metadata !== null
            ? creemParams.metadata
            : {}),
          ...(checkoutOrder.metadata || {}),
        },
      };

      // update order status to created, waiting for payment
      await updateOrderByOrderNo(orderNo, {
        status: OrderStatus.CREATED, // means checkout created, waiting for payment
        checkoutInfo: JSON.stringify(mergedCheckoutInfo),
        checkoutResult: JSON.stringify(result.checkoutResult),
        checkoutUrl: result.checkoutInfo.checkoutUrl,
        paymentSessionId: result.checkoutInfo.sessionId,
        paymentProvider: result.provider,
      });

      return respData(result.checkoutInfo);
    } catch (e: any) {
      // update order status to completed, means checkout failed
      await updateOrderByOrderNo(orderNo, {
        status: OrderStatus.COMPLETED, // means checkout failed
        checkoutInfo: JSON.stringify(checkoutOrder),
      });

      return respErr('checkout failed: ' + e.message);
    }
  } catch (e: any) {
    console.log('checkout failed:', e);
    return respErr('checkout failed: ' + e.message);
  }
}

// get payemt product id from payment provider's config
async function getPaymentProductId(
  productId: string,
  provider: string,
  checkoutCurrency: string
) {
  if (provider !== 'creem') {
    // currently only creem supports payment product id mapping
    return;
  }

  try {
    const configs = await getAllConfigs();
    const creemProductIds = configs.creem_product_ids;
    if (creemProductIds) {
      const productIds = JSON.parse(creemProductIds);
      return (
        productIds[`${productId}_${checkoutCurrency}`] || productIds[productId]
      );
    }
  } catch (e: any) {
    console.log('get payment product id failed:', e);
    return;
  }
}

// get promotion code from payment provider's config
async function getPromotionCode(
  productId: string,
  provider: string,
  checkoutCurrency: string
) {
  if (provider !== 'stripe') {
    // currently only stripe supports promotion code mapping
    return;
  }

  try {
    const configs = await getAllConfigs();
    const stripePromotionCodes = configs.stripe_promotion_codes;
    if (stripePromotionCodes) {
      const promotionCodes = JSON.parse(stripePromotionCodes);
      return (
        promotionCodes[`${productId}_${checkoutCurrency}`] ||
        promotionCodes[productId]
      );
    }
  } catch (e: any) {
    console.log('get promotion code failed:', e);
    return;
  }
}
