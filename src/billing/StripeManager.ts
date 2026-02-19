/**
 * StripeManager — Stripe billing integration for ShipKit.
 *
 * Handles checkout sessions, customer portal, webhooks, and subscription state.
 * Gracefully degrades when STRIPE_SECRET_KEY is not configured.
 */

import { getDb } from '../queue/db.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface CheckoutSessionParams {
  plan: 'pro' | 'team' | 'enterprise';
  apiKeyId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface SubscriptionStatus {
  plan: string;
  status: string;
  currentPeriodEnd?: string;
}

// Map plan names to Stripe price env vars
const PLAN_PRICE_ENV: Record<string, string> = {
  pro: 'STRIPE_PRICE_PRO',
  team: 'STRIPE_PRICE_TEAM',
  enterprise: 'STRIPE_PRICE_ENTERPRISE',
};

// ─── StripeManager ───────────────────────────────────────────────────

export class StripeManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stripe: any;
  private available: boolean;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      this.available = false;
      return;
    }

    try {
      // Dynamic import is not available in constructor sync context;
      // we load lazily. Mark as available and let getStripe() handle init.
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  private async getStripe() {
    if (!this.stripe) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error('STRIPE_SECRET_KEY not set');
      const { default: Stripe } = await import('stripe');
      this.stripe = new Stripe(key);
    }
    return this.stripe;
  }

  /**
   * Create a Stripe Checkout Session for plan upgrade.
   */
  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string }> {
    const stripe = await this.getStripe();

    const priceEnv = PLAN_PRICE_ENV[params.plan];
    if (!priceEnv) throw new Error(`Unknown plan: ${params.plan}`);

    const priceId = process.env[priceEnv];
    if (!priceId) throw new Error(`${priceEnv} environment variable not set`);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: {
        api_key_id: params.apiKeyId,
        plan: params.plan,
      },
    });

    if (!session.url) throw new Error('Stripe did not return a session URL');
    return { url: session.url };
  }

  /**
   * Create a Stripe Customer Portal session for subscription management.
   */
  async createPortalSession(customerId: string): Promise<{ url: string }> {
    const stripe = await this.getStripe();

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
    });

    return { url: session.url };
  }

  /**
   * Process a Stripe webhook event.
   * Validates signature and updates database state.
   */
  async handleWebhook(payload: string, signature: string): Promise<void> {
    const stripe = await this.getStripe();

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

    let event: import('stripe').Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Webhook signature verification failed: ${message}`);
    }

    const db = getDb();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as import('stripe').Stripe.Checkout.Session;
        const apiKeyId = session.metadata?.api_key_id;
        const plan = session.metadata?.plan;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

        if (apiKeyId && plan) {
          db.prepare(
            `UPDATE api_keys SET plan = ?, user_id = COALESCE(user_id, ?) WHERE id = ?`,
          ).run(plan, customerId ?? null, apiKeyId);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as import('stripe').Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const priceId = sub.items.data[0]?.price.id;
        const plan = this.planFromPriceId(priceId);

        if (plan) {
          db.prepare(`UPDATE api_keys SET plan = ? WHERE user_id = ?`).run(plan, customerId);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as import('stripe').Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        db.prepare(`UPDATE api_keys SET plan = 'free' WHERE user_id = ?`).run(customerId);
        break;
      }

      case 'invoice.payment_failed': {
        // Log payment failure — no plan downgrade, just warn
        const invoice = event.data.object as import('stripe').Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          // Persist alert in a way that getSubscriptionStatus can surface it
          db.prepare(`UPDATE api_keys SET plan = plan || ':payment_failed' WHERE user_id = ? AND plan NOT LIKE '%:payment_failed'`)
            .run(customerId);
        }
        break;
      }

      default:
        // Unknown event type — ignore silently
        break;
    }
  }

  /**
   * Retrieve current subscription status for an API key.
   */
  async getSubscriptionStatus(apiKeyId: string): Promise<SubscriptionStatus> {
    const db = getDb();
    const row = db
      .prepare(`SELECT plan, user_id FROM api_keys WHERE id = ?`)
      .get(apiKeyId) as { plan: string; user_id: string | null } | undefined;

    if (!row) return { plan: 'free', status: 'not_found' };

    const rawPlan = row.plan ?? 'free';
    const paymentFailed = rawPlan.includes(':payment_failed');
    const plan = rawPlan.replace(':payment_failed', '');

    if (!this.available || !row.user_id) {
      return {
        plan,
        status: paymentFailed ? 'payment_failed' : 'active',
      };
    }

    try {
      const stripe = await this.getStripe();
      const subscriptions = await stripe.subscriptions.list({
        customer: row.user_id,
        status: 'all',
        limit: 1,
      });

      const sub = subscriptions.data[0];
      if (!sub) return { plan, status: 'no_subscription' };

      return {
        plan,
        status: paymentFailed ? 'payment_failed' : sub.status,
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      };
    } catch {
      return { plan, status: paymentFailed ? 'payment_failed' : 'active' };
    }
  }

  // ─── Private helpers ────────────────────────────────────────────

  private planFromPriceId(priceId: string | undefined): string | null {
    if (!priceId) return null;
    for (const [plan, envKey] of Object.entries(PLAN_PRICE_ENV)) {
      if (process.env[envKey] === priceId) return plan;
    }
    return null;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let _manager: StripeManager | null = null;

export function getStripeManager(): StripeManager {
  if (!_manager) _manager = new StripeManager();
  return _manager;
}
