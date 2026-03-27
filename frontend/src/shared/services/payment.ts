import { eq } from 'drizzle-orm';

import { envConfigs } from '@/config';
import { credit } from '@/config/db/schema';
import { db } from '@/core/db';
import {
  CreemProvider,
  PaymentManager,
  PayPalProvider,
  StripeProvider,
} from '@/extensions/payment';
import {
  PaymentSession,
  PaymentStatus,
  PaymentType,
} from '@/extensions/payment/types';
import { getSnowId, getUuid } from '@/shared/lib/hash';
import { Configs, getAllConfigs } from '@/shared/models/config';

import {
  calculateCreditExpirationTime,
  createCredit,
  CreditStatus,
  CreditTransactionScene,
  CreditTransactionType,
  NewCredit,
} from '../models/credit';
import {
  findOrderByOrderNo,
  NewOrder,
  Order,
  OrderStatus,
  UpdateOrder,
  updateOrderByOrderNo,
  updateOrderInTransaction,
  updateSubscriptionInTransaction,
} from '../models/order';
import {
  createSubscription,
  findSubscriptionByProviderSubscriptionId,
  NewSubscription,
  Subscription,
  SubscriptionStatus,
  UpdateSubscription,
  updateSubscriptionBySubscriptionNo,
} from '../models/subscription';
import { findUserById } from '../models/user';

/** Cycle credits after trial: from checkout metadata or order.creditsAmount */
export function parseSubscriptionCycleCreditsFromOrder(order: Order): number {
  try {
    const payload = JSON.parse(order.checkoutInfo || '{}');
    const raw = payload.metadata?.subscription_cycle_credits;
    const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* ignore */
  }
  const a = order.creditsAmount;
  return typeof a === 'number' && a > 0 ? a : 0;
}

/**
 * Creem (and similar): grant trial credits once per provider subscription id; ensure DB subscription row exists.
 */
export async function handleCreemTrialFlow({
  session,
  paymentProvider,
}: {
  session: PaymentSession;
  paymentProvider: string;
}) {
  if (paymentProvider !== 'creem') return;
  if (!session.subscriptionId || !session.subscriptionInfo) return;
  if (session.subscriptionInfo.status !== SubscriptionStatus.TRIALING) return;

  const meta = {
    ...(session.metadata && typeof session.metadata === 'object'
      ? session.metadata
      : {}),
    ...(session.subscriptionInfo.metadata &&
    typeof session.subscriptionInfo.metadata === 'object'
      ? session.subscriptionInfo.metadata
      : {}),
  } as Record<string, string | undefined>;

  const userId = meta.user_id;
  if (!userId) {
    console.log(
      '[creem trial] skip: missing user_id in subscription/checkout metadata'
    );
    return;
  }

  const trialCredits = parseInt(envConfigs.trial_credits_amount || '50', 10);
  if (!Number.isFinite(trialCredits) || trialCredits < 1) return;

  const subId = session.subscriptionId;
  const txnNo = `creem-trial:${subId}`;

  const [existingGrant] = await db()
    .select({ id: credit.id })
    .from(credit)
    .where(eq(credit.transactionNo, txnNo))
    .limit(1);

  const userRow = await findUserById(userId);

  if (!existingGrant) {
    const expiresAt = session.subscriptionInfo.currentPeriodEnd;

    await createCredit({
      id: getUuid(),
      userId,
      userEmail: userRow?.email || '',
      orderNo: '',
      subscriptionNo: '',
      transactionNo: txnNo,
      transactionType: CreditTransactionType.GRANT,
      transactionScene: CreditTransactionScene.TRIAL,
      credits: trialCredits,
      remainingCredits: trialCredits,
      description: 'Creem subscription trial credits',
      expiresAt,
      status: CreditStatus.ACTIVE,
      metadata: JSON.stringify({ creem_subscription_id: subId }),
    });
  }

  const existingSub = await findSubscriptionByProviderSubscriptionId({
    provider: paymentProvider,
    subscriptionId: subId,
  });
  if (existingSub) return;

  const orderNo = meta.order_no;
  if (!orderNo) {
    console.log(
      '[creem trial] skip creating subscription row: no order_no in metadata'
    );
    return;
  }

  const orderRow = await findOrderByOrderNo(orderNo);
  if (!orderRow || orderRow.userId !== userId) return;

  const cycleCredits = parseSubscriptionCycleCreditsFromOrder(orderRow);
  const info = session.subscriptionInfo;

  await createSubscription({
    id: getUuid(),
    subscriptionNo: getSnowId(),
    userId: orderRow.userId,
    userEmail: orderRow.userEmail || userRow?.email || '',
    status: SubscriptionStatus.TRIALING,
    paymentProvider,
    subscriptionId: subId,
    subscriptionResult: JSON.stringify(session.subscriptionResult ?? {}),
    productId: orderRow.productId,
    description: info.description || 'Subscription trial',
    amount: info.amount ?? orderRow.amount,
    currency: info.currency || orderRow.currency,
    interval:
      (info.interval as string) ||
      orderRow.paymentInterval ||
      'month',
    intervalCount: info.intervalCount ?? 1,
    trialPeriodDays: parseInt(envConfigs.trial_credits_days || '3', 10),
    currentPeriodStart: info.currentPeriodStart,
    currentPeriodEnd: info.currentPeriodEnd,
    planName: orderRow.planName || '',
    billingUrl: info.billingUrl || '',
    productName: orderRow.productName || '',
    creditsAmount: cycleCredits,
    creditsValidDays: orderRow.creditsValidDays ?? 0,
    paymentProductId: orderRow.paymentProductId || '',
    paymentUserId: session.paymentInfo?.paymentUserId || '',
  });
}

/**
 * get payment service with configs
 */
export function getPaymentServiceWithConfigs(configs: Configs) {
  const paymentManager = new PaymentManager();

  const defaultProvider = configs.default_payment_provider;

  // add stripe provider
  if (configs.stripe_enabled === 'true') {
    let allowedPaymentMethods = configs.stripe_payment_methods || [];
    if (typeof allowedPaymentMethods === 'string') {
      try {
        allowedPaymentMethods = JSON.parse(allowedPaymentMethods);
      } catch (e) {
        console.error('parse stripe payment methods error', e);
        allowedPaymentMethods = [];
      }
    }
    paymentManager.addProvider(
      new StripeProvider({
        secretKey: configs.stripe_secret_key,
        publishableKey: configs.stripe_publishable_key,
        signingSecret: configs.stripe_signing_secret,
        allowedPaymentMethods: allowedPaymentMethods as string[],
        allowPromotionCodes: configs.stripe_allow_promotion_codes === 'true',
      }),
      defaultProvider === 'stripe'
    );
  }

  // add creem provider
  if (configs.creem_enabled === 'true') {
    paymentManager.addProvider(
      new CreemProvider({
        apiKey: configs.creem_api_key,
        environment:
          configs.creem_environment === 'production' ? 'production' : 'sandbox',
        signingSecret: configs.creem_signing_secret,
      }),
      defaultProvider === 'creem'
    );
  }

  // add paypal provider
  if (configs.paypal_enabled === 'true') {
    paymentManager.addProvider(
      new PayPalProvider({
        clientId: configs.paypal_client_id,
        clientSecret: configs.paypal_client_secret,
        webhookId: configs.paypal_webhook_id,
        environment:
          configs.paypal_environment === 'production'
            ? 'production'
            : 'sandbox',
      }),
      defaultProvider === 'paypal'
    );
  }

  return paymentManager;
}

/**
 * global payment service
 */
let paymentService: PaymentManager | null = null;

/**
 * get payment service instance
 */
export async function getPaymentService(
  configs?: Configs
): Promise<PaymentManager> {
  if (!configs) {
    configs = await getAllConfigs();
  }
  paymentService = getPaymentServiceWithConfigs(configs);

  return paymentService;
}

/**
 * handle checkout success
 */
export async function handleCheckoutSuccess({
  order,
  session,
}: {
  order: Order; // checkout order
  session: PaymentSession; // payment session
}) {
  const orderNo = order.orderNo;
  if (!orderNo) {
    throw new Error('invalid order');
  }

  // Idempotency check: if order is already paid, skip processing
  if (order.status === OrderStatus.PAID) {
    console.log(`Order ${orderNo} is already paid, skipping`);
    return;
  }

  // Only process orders in CREATED or PENDING status
  if (order.status !== OrderStatus.CREATED && order.status !== OrderStatus.PENDING) {
    console.log(`Order ${orderNo} status is ${order.status}, not processing`);
    return;
  }

  if (order.paymentType === PaymentType.SUBSCRIPTION) {
    if (!session.subscriptionId || !session.subscriptionInfo) {
      throw new Error('subscription id or subscription info not found');
    }
  }

  // payment success
  if (session.paymentStatus === PaymentStatus.SUCCESS) {
    // update order status to be paid
    const updateOrder: UpdateOrder = {
      status: OrderStatus.PAID,
      paymentResult: JSON.stringify(session.paymentResult),
      paymentAmount: session.paymentInfo?.paymentAmount,
      paymentCurrency: session.paymentInfo?.paymentCurrency,
      discountAmount: session.paymentInfo?.discountAmount,
      discountCurrency: session.paymentInfo?.discountCurrency,
      discountCode: session.paymentInfo?.discountCode,
      paymentEmail: session.paymentInfo?.paymentEmail,
      paidAt: session.paymentInfo?.paidAt,
      invoiceId: session.paymentInfo?.invoiceId,
      invoiceUrl: session.paymentInfo?.invoiceUrl,
      subscriptionNo: '',
      transactionId: session.paymentInfo?.transactionId,
      paymentUserName: session.paymentInfo?.paymentUserName,
      paymentUserId: session.paymentInfo?.paymentUserId,
    };

    // new subscription
    let newSubscription: NewSubscription | undefined = undefined;
    const subscriptionInfo = session.subscriptionInfo;

    // subscription first payment
    if (subscriptionInfo) {
      // new subscription
      newSubscription = {
        id: getUuid(),
        subscriptionNo: getSnowId(),
        userId: order.userId,
        userEmail: order.paymentEmail || order.userEmail,
        status: subscriptionInfo.status || SubscriptionStatus.ACTIVE,
        paymentProvider: order.paymentProvider,
        subscriptionId: subscriptionInfo.subscriptionId,
        subscriptionResult: JSON.stringify(session.subscriptionResult),
        productId: order.productId,
        description: subscriptionInfo.description || 'Subscription Created',
        amount: subscriptionInfo.amount,
        currency: subscriptionInfo.currency,
        interval: subscriptionInfo.interval,
        intervalCount: subscriptionInfo.intervalCount,
        trialPeriodDays: subscriptionInfo.trialPeriodDays,
        currentPeriodStart: subscriptionInfo.currentPeriodStart,
        currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
        billingUrl: subscriptionInfo.billingUrl,
        planName: order.planName || order.productName,
        productName: order.productName,
        creditsAmount: parseSubscriptionCycleCreditsFromOrder(order),
        creditsValidDays: order.creditsValidDays,
        paymentProductId: order.paymentProductId,
        paymentUserId: session.paymentInfo?.paymentUserId,
      };

      updateOrder.subscriptionNo = newSubscription.subscriptionNo;
      updateOrder.subscriptionId = session.subscriptionId;
      updateOrder.subscriptionResult = JSON.stringify(
        session.subscriptionResult
      );
    }

    // grant credit for order
    let newCredit: NewCredit | undefined = undefined;
    if (order.creditsAmount && order.creditsAmount > 0) {
      const credits = order.creditsAmount;
      const expiresAt =
        credits > 0
          ? calculateCreditExpirationTime({
              creditsValidDays: order.creditsValidDays || 0,
              currentPeriodEnd: subscriptionInfo?.currentPeriodEnd,
            })
          : null;

      newCredit = {
        id: getUuid(),
        userId: order.userId,
        userEmail: order.userEmail,
        orderNo: order.orderNo,
        subscriptionNo: newSubscription?.subscriptionNo,
        transactionNo: getSnowId(),
        transactionType: CreditTransactionType.GRANT,
        transactionScene:
          order.paymentType === PaymentType.SUBSCRIPTION
            ? CreditTransactionScene.SUBSCRIPTION
            : CreditTransactionScene.PAYMENT,
        credits: credits,
        remainingCredits: credits,
        description: `Grant credit`,
        expiresAt: expiresAt,
        status: CreditStatus.ACTIVE,
      };
    }

    await updateOrderInTransaction({
      orderNo,
      updateOrder,
      newSubscription,
      newCredit,
    });
  } else if (
    session.paymentStatus === PaymentStatus.FAILED ||
    session.paymentStatus === PaymentStatus.CANCELED
  ) {
    // update order status to be failed
    await updateOrderByOrderNo(orderNo, {
      status: OrderStatus.FAILED,
      paymentResult: JSON.stringify(session.paymentResult),
    });
  } else if (session.paymentStatus === PaymentStatus.PROCESSING) {
    // update order payment result
    await updateOrderByOrderNo(orderNo, {
      paymentResult: JSON.stringify(session.paymentResult),
    });
  } else {
    throw new Error('unknown payment status');
  }
}

/**
 * handle payment success
 */
export async function handlePaymentSuccess({
  order,
  session,
}: {
  order: Order; // checkout order
  session: PaymentSession; // payment session
}) {
  const orderNo = order.orderNo;
  if (!orderNo) {
    throw new Error('invalid order');
  }

  if (order.paymentType === PaymentType.SUBSCRIPTION) {
    if (!session.subscriptionId || !session.subscriptionInfo) {
      throw new Error('subscription id or subscription info not found');
    }
  }

  // payment success
  if (session.paymentStatus === PaymentStatus.SUCCESS) {
    // update order status to be paid
    const updateOrder: UpdateOrder = {
      status: OrderStatus.PAID,
      paymentResult: JSON.stringify(session.paymentResult),
      paymentAmount: session.paymentInfo?.paymentAmount,
      paymentCurrency: session.paymentInfo?.paymentCurrency,
      discountAmount: session.paymentInfo?.discountAmount,
      discountCurrency: session.paymentInfo?.discountCurrency,
      discountCode: session.paymentInfo?.discountCode,
      paymentEmail: session.paymentInfo?.paymentEmail,
      paymentUserName: session.paymentInfo?.paymentUserName,
      paymentUserId: session.paymentInfo?.paymentUserId,
      paidAt: session.paymentInfo?.paidAt,
      invoiceId: session.paymentInfo?.invoiceId,
      invoiceUrl: session.paymentInfo?.invoiceUrl,
    };

    // new subscription
    let newSubscription: NewSubscription | undefined = undefined;
    const subscriptionInfo = session.subscriptionInfo;

    // subscription first payment
    if (subscriptionInfo) {
      // new subscription
      newSubscription = {
        id: getUuid(),
        subscriptionNo: getSnowId(),
        userId: order.userId,
        userEmail: order.paymentEmail || order.userEmail,
        status: SubscriptionStatus.ACTIVE,
        paymentProvider: order.paymentProvider,
        subscriptionId: subscriptionInfo.subscriptionId,
        subscriptionResult: JSON.stringify(session.subscriptionResult),
        productId: order.productId,
        description: subscriptionInfo.description,
        amount: subscriptionInfo.amount,
        currency: subscriptionInfo.currency,
        interval: subscriptionInfo.interval,
        intervalCount: subscriptionInfo.intervalCount,
        trialPeriodDays: subscriptionInfo.trialPeriodDays,
        currentPeriodStart: subscriptionInfo.currentPeriodStart,
        currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
        planName: order.planName || order.productName,
        billingUrl: subscriptionInfo.billingUrl,
        productName: order.productName,
        creditsAmount: parseSubscriptionCycleCreditsFromOrder(order),
        creditsValidDays: order.creditsValidDays,
        paymentProductId: order.paymentProductId,
        paymentUserId: session.paymentInfo?.paymentUserId,
      };

      updateOrder.subscriptionId = session.subscriptionId;
      updateOrder.subscriptionResult = JSON.stringify(
        session.subscriptionResult
      );
    }

    // grant credit for order
    let newCredit: NewCredit | undefined = undefined;
    if (order.creditsAmount && order.creditsAmount > 0) {
      const credits = order.creditsAmount;
      const expiresAt =
        credits > 0
          ? calculateCreditExpirationTime({
              creditsValidDays: order.creditsValidDays || 0,
              currentPeriodEnd: subscriptionInfo?.currentPeriodEnd,
            })
          : null;

      newCredit = {
        id: getUuid(),
        userId: order.userId,
        userEmail: order.userEmail,
        orderNo: order.orderNo,
        subscriptionNo: newSubscription?.subscriptionNo,
        transactionNo: getSnowId(),
        transactionType: CreditTransactionType.GRANT,
        transactionScene:
          order.paymentType === PaymentType.SUBSCRIPTION
            ? CreditTransactionScene.SUBSCRIPTION
            : CreditTransactionScene.PAYMENT,
        credits: credits,
        remainingCredits: credits,
        description: `Grant credit`,
        expiresAt: expiresAt,
        status: CreditStatus.ACTIVE,
      };
    }

    await updateOrderInTransaction({
      orderNo,
      updateOrder,
      newSubscription,
      newCredit,
    });
  } else {
    throw new Error('unknown payment status');
  }
}

export async function handleSubscriptionRenewal({
  subscription,
  session,
}: {
  subscription: Subscription; // subscription
  session: PaymentSession; // payment session
}) {
  const subscriptionNo = subscription.subscriptionNo;
  if (!subscriptionNo || !subscription.amount || !subscription.currency) {
    throw new Error('invalid subscription');
  }

  if (!session.subscriptionId || !session.subscriptionInfo) {
    throw new Error('invalid payment session');
  }
  if (session.subscriptionId !== subscription.subscriptionId) {
    throw new Error('subscription id mismatch');
  }

  const subscriptionInfo = session.subscriptionInfo;
  if (
    !subscriptionInfo ||
    !subscriptionInfo.currentPeriodStart ||
    !subscriptionInfo.currentPeriodEnd
  ) {
    throw new Error('invalid subscription info');
  }

  // payment success
  if (session.paymentStatus === PaymentStatus.SUCCESS) {
    // update subscription period
    const updateSubscription: UpdateSubscription = {
      currentPeriodStart: subscriptionInfo.currentPeriodStart,
      currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
    };

    const orderNo = getSnowId();
    const currentTime = new Date();

    // renewal order
    const order: NewOrder = {
      id: getUuid(),
      orderNo: orderNo,
      userId: subscription.userId,
      userEmail: subscription.userEmail,
      status: OrderStatus.PAID,
      amount: subscription.amount,
      currency: subscription.currency,
      productId: subscription.productId,
      paymentType: PaymentType.RENEW,
      paymentInterval: subscription.interval,
      paymentProvider: session.provider || subscription.paymentProvider,
      checkoutInfo: '',
      createdAt: currentTime,
      productName: subscription.productName,
      description: 'Subscription Renewal',
      callbackUrl: '',
      creditsAmount: subscription.creditsAmount,
      creditsValidDays: subscription.creditsValidDays,
      planName: subscription.planName || '',
      paymentProductId: subscription.paymentProductId,
      paymentResult: JSON.stringify(session.paymentResult),
      paymentAmount: session.paymentInfo?.paymentAmount,
      paymentCurrency: session.paymentInfo?.paymentCurrency,
      discountAmount: session.paymentInfo?.discountAmount,
      discountCurrency: session.paymentInfo?.discountCurrency,
      discountCode: session.paymentInfo?.discountCode,
      paymentEmail: session.paymentInfo?.paymentEmail,
      paymentUserId: session.paymentInfo?.paymentUserId,
      paidAt: session.paymentInfo?.paidAt,
      invoiceId: session.paymentInfo?.invoiceId,
      invoiceUrl: session.paymentInfo?.invoiceUrl,
      subscriptionNo: subscription.subscriptionNo,
      transactionId: session.paymentInfo?.transactionId,
      paymentUserName: session.paymentInfo?.paymentUserName,
      subscriptionId: session.subscriptionId,
      subscriptionResult: JSON.stringify(session.subscriptionResult),
    };

    // grant credit for renewal order
    let newCredit: NewCredit | undefined = undefined;
    if (order.creditsAmount && order.creditsAmount > 0) {
      const credits = order.creditsAmount;
      const expiresAt =
        credits > 0
          ? calculateCreditExpirationTime({
              creditsValidDays: order.creditsValidDays || 0,
              currentPeriodEnd: subscriptionInfo?.currentPeriodEnd,
            })
          : null;

      newCredit = {
        id: getUuid(),
        userId: order.userId,
        userEmail: order.userEmail,
        orderNo: order.orderNo,
        subscriptionNo: subscription.subscriptionNo,
        transactionNo: getSnowId(),
        transactionType: CreditTransactionType.GRANT,
        transactionScene:
          order.paymentType === PaymentType.SUBSCRIPTION
            ? CreditTransactionScene.SUBSCRIPTION
            : CreditTransactionScene.PAYMENT,
        credits: credits,
        remainingCredits: credits,
        description: `Grant credit`,
        expiresAt: expiresAt,
        status: CreditStatus.ACTIVE,
      };
    }

    await updateSubscriptionInTransaction({
      subscriptionNo,
      updateSubscription,
      newOrder: order,
      newCredit,
    });
  } else {
    throw new Error('unknown payment status');
  }
}

export async function handleSubscriptionUpdated({
  subscription,
  session,
}: {
  subscription: Subscription; // subscription
  session: PaymentSession; // payment session
}) {
  const subscriptionNo = subscription.subscriptionNo;
  if (!subscriptionNo || !subscription.amount || !subscription.currency) {
    throw new Error('invalid subscription');
  }

  const subscriptionInfo = session.subscriptionInfo;
  if (!subscriptionInfo || !subscriptionInfo.status) {
    throw new Error('invalid subscription info');
  }

  let updateSubscriptionStatus: SubscriptionStatus = subscriptionInfo.status;

  await updateSubscriptionBySubscriptionNo(subscriptionNo, {
    status: updateSubscriptionStatus,
    currentPeriodStart: subscriptionInfo.currentPeriodStart,
    currentPeriodEnd: subscriptionInfo.currentPeriodEnd,
    canceledAt: subscriptionInfo.canceledAt || null,
    canceledEndAt: subscriptionInfo.canceledEndAt || null,
    canceledReason: subscriptionInfo.canceledReason || '',
    canceledReasonType: subscriptionInfo.canceledReasonType || '',
  });

  // console.log('handle subscription updated', subscriptionInfo);
}

export async function handleSubscriptionCanceled({
  subscription,
  session,
}: {
  subscription: Subscription; // subscription
  session: PaymentSession; // payment session
}) {
  const subscriptionNo = subscription.subscriptionNo;
  if (!subscriptionNo || !subscription.amount || !subscription.currency) {
    throw new Error('invalid subscription');
  }

  const subscriptionInfo = session.subscriptionInfo;
  if (
    !subscriptionInfo ||
    !subscriptionInfo.status ||
    !subscriptionInfo.canceledAt
  ) {
    throw new Error('invalid subscription info');
  }

  await updateSubscriptionBySubscriptionNo(subscriptionNo, {
    status: SubscriptionStatus.CANCELED,
    canceledAt: subscriptionInfo.canceledAt,
    canceledEndAt: subscriptionInfo.canceledEndAt,
    canceledReason: subscriptionInfo.canceledReason,
    canceledReasonType: subscriptionInfo.canceledReasonType,
  });

  // console.log('handle subscription canceled', subscriptionInfo);
}
