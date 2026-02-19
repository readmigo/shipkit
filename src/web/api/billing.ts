/**
 * Billing API routes — Stripe integration.
 *
 * POST /api/billing/checkout    — Create a Checkout Session
 * POST /api/billing/webhook     — Handle Stripe webhook events
 * GET  /api/billing/portal      — Get Customer Portal URL
 * GET  /api/billing/status      — Get subscription status for an API key
 *
 * All routes return 501 when STRIPE_SECRET_KEY is not configured.
 */

import { Hono, type Context } from 'hono';
import { getStripeManager } from '../../billing/StripeManager.js';

export function createBillingRouter(): Hono {
  const app = new Hono();

  function notConfigured(c: Context) {
    return c.json({ error: 'Stripe billing is not configured on this server' }, 501);
  }

  // POST /api/billing/checkout
  app.post('/checkout', async (c) => {
    const manager = getStripeManager();
    if (!manager.isAvailable()) return notConfigured(c);

    let body: {
      plan?: string;
      apiKeyId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { plan, apiKeyId, successUrl, cancelUrl } = body;
    if (!plan || !apiKeyId || !successUrl || !cancelUrl) {
      return c.json({ error: 'Missing required fields: plan, apiKeyId, successUrl, cancelUrl' }, 400);
    }

    if (!['pro', 'team', 'enterprise'].includes(plan)) {
      return c.json({ error: `Invalid plan: ${plan}. Must be pro, team, or enterprise` }, 400);
    }

    try {
      const result = await manager.createCheckoutSession({
        plan: plan as 'pro' | 'team' | 'enterprise',
        apiKeyId,
        successUrl,
        cancelUrl,
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/billing/webhook
  app.post('/webhook', async (c) => {
    const manager = getStripeManager();
    if (!manager.isAvailable()) return notConfigured(c);

    const signature = c.req.header('stripe-signature');
    if (!signature) {
      return c.json({ error: 'Missing stripe-signature header' }, 400);
    }

    // Read raw body as text for signature verification
    const payload = await c.req.text();

    try {
      await manager.handleWebhook(payload, signature);
      return c.json({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  // GET /api/billing/portal?customerId=xxx
  app.get('/portal', async (c) => {
    const manager = getStripeManager();
    if (!manager.isAvailable()) return notConfigured(c);

    const customerId = c.req.query('customerId');
    if (!customerId) {
      return c.json({ error: 'Missing required query parameter: customerId' }, 400);
    }

    try {
      const result = await manager.createPortalSession(customerId);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/billing/status?apiKeyId=xxx
  app.get('/status', async (c) => {
    const manager = getStripeManager();

    const apiKeyId = c.req.query('apiKeyId');
    if (!apiKeyId) {
      return c.json({ error: 'Missing required query parameter: apiKeyId' }, 400);
    }

    try {
      const result = await manager.getSubscriptionStatus(apiKeyId);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
