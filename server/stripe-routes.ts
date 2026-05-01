import type { Express, RequestHandler } from "express";
import Stripe from "stripe";
import { opsStorage } from "./ops-storage";
import { bookkeepingStorage } from "./bookkeeping-storage";
import { recordRevenue, getAccountIdByCode } from "./accounting-v2";
import { getResendClient } from "./email";

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

async function sendThankYouEmail(clientName: string, clientEmail: string, description: string | null) {
  const resend = getResendClient();
  if (!resend || !clientEmail) return;

  const firstName = clientName?.split(" ")[0] || clientName || "there";
  const projectRef = description || "your project";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
      <p>Hey ${firstName},</p>
      <p>Just wanted to say thank you for the payment on ${projectRef} — I really appreciate you and your business.</p>
      <p>If anything comes up down the road — updates, additions, a completely new project — we're right here. That's what we do, and we'd love to keep building with you.</p>
      <p>One more thing — if you know anyone who could use a better website or platform, I'd love an intro. Referrals mean the world to a small team like ours, and we'll take great care of anyone you send our way.</p>
      <p>Thanks again, ${firstName}. It's been great working with you.</p>
      <p style="margin-top: 24px;">— Chris<br/>
      <span style="color: #888; font-size: 14px;">BlackRidge Platforms</span><br/>
      <span style="color: #888; font-size: 13px;">chris@blackridgeplatforms.com</span></p>
    </div>
  `;

  try {
    await resend.client.emails.send({
      from: `Chris from BlackRidge <${resend.fromEmail}>`,
      to: clientEmail,
      subject: `Thank you from BlackRidge — ${firstName}`,
      html,
    });
    console.log(`Thank-you email sent to ${clientEmail}`);
  } catch (e) {
    console.error("Failed to send thank-you email:", e);
  }
}

export function registerStripeRoutes(app: Express, isAuthenticated: RequestHandler) {

  app.post("/api/ops/clients/:clientId/subscriptions/setup-intent", isAuthenticated, async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) return res.status(500).json({ message: "Stripe is not configured. Add STRIPE_SECRET_KEY." });

      const clientId = String(req.params.clientId);
      const client = await opsStorage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      let stripeCustomerId = client.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          name: client.name,
          email: client.email || undefined,
          phone: client.phone || undefined,
          metadata: { blackridge_client_id: client.id },
        });
        stripeCustomerId = customer.id;
        await opsStorage.updateClient(clientId, { stripeCustomerId });
      }

      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        metadata: { blackridge_client_id: clientId },
      });

      res.json({ clientSecret: setupIntent.client_secret, customerId: stripeCustomerId });
    } catch (error: any) {
      console.error("Setup intent error:", error);
      res.status(500).json({ message: error.message || "Failed to create setup intent" });
    }
  });

  app.post("/api/ops/clients/:clientId/subscriptions/create", isAuthenticated, async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) return res.status(500).json({ message: "Stripe is not configured." });

      const clientId = String(req.params.clientId);
      const body = req.body as { name: string; amount: string; interval: string; paymentMethodId: string; notes?: string; startDate?: string };
      const { name: subName, amount: subAmount, interval: subInterval, paymentMethodId, notes: subNotes, startDate: subStartDate } = body;

      if (!subName || !subAmount || !subInterval || !paymentMethodId) {
        return res.status(400).json({ message: "name, amount, interval, and paymentMethodId are required" });
      }

      const client = await opsStorage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      const stripeCustomerId = client.stripeCustomerId;
      if (!stripeCustomerId) return res.status(400).json({ message: "Client has no Stripe customer. Create a setup intent first." });

      const idempotencyBase = `${clientId}-${subName}-${subAmount}-${subInterval}-${paymentMethodId}`;

      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      let stripeInterval: "month" | "year" = "month";
      let intervalCount = 1;
      if (subInterval === "annual" || subInterval === "year") {
        stripeInterval = "year";
        intervalCount = 1;
      } else if (subInterval === "quarterly") {
        stripeInterval = "month";
        intervalCount = 3;
      }
      const unitAmount = Math.round(parseFloat(subAmount) * 100);

      const product = await stripe.products.create({
        name: subName,
        metadata: { blackridge_client_id: clientId },
      }, { idempotencyKey: `prod-${idempotencyBase}` });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: unitAmount,
        currency: "usd",
        recurring: { interval: stripeInterval, interval_count: intervalCount },
        metadata: { blackridge_client_id: clientId },
      }, { idempotencyKey: `price-${idempotencyBase}` });

      const subCreateParams: any = {
        customer: stripeCustomerId,
        items: [{ price: price.id }],
        default_payment_method: paymentMethodId,
        expand: ["latest_invoice.payment_intent"],
        metadata: {
          blackridge_client_id: clientId,
          subscription_name: subName,
          product_id: product.id,
          price_id: price.id,
        },
      };

      if (subStartDate) {
        const parsed = new Date(subStartDate + "T00:00:00");
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ message: "Invalid start date format" });
        }
        const anchorTs = Math.floor(parsed.getTime() / 1000);
        const nowTs = Math.floor(Date.now() / 1000);
        if (anchorTs > nowTs) {
          subCreateParams.billing_cycle_anchor = anchorTs;
          subCreateParams.proration_behavior = "none";
        } else if (anchorTs < nowTs) {
          subCreateParams.backdate_start_date = anchorTs;
          subCreateParams.proration_behavior = "none";
        }
      }

      const subscription = await stripe.subscriptions.create(subCreateParams, { idempotencyKey: `sub-${idempotencyBase}` });

      const subData = subscription as any;
      const latestInvoice = subData.latest_invoice;
      const paymentIntent = latestInvoice?.payment_intent;

      const amountCents = subData.items?.data?.[0]?.price?.unit_amount || unitAmount;
      const amount = (amountCents / 100).toFixed(2);
      const dbInterval = subInterval === "annual" ? "annual" : subInterval === "quarterly" ? "quarterly" : "monthly";

      const statusMap: Record<string, string> = {
        active: "active", past_due: "past_due", canceled: "canceled",
        trialing: "trialing", paused: "paused", incomplete: "active",
        incomplete_expired: "canceled", unpaid: "past_due",
      };
      const subStatus = (statusMap[subscription.status] || "active") as "active" | "past_due" | "canceled" | "trialing" | "paused";

      const localSub = await opsStorage.createSubscription({
        clientId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: price.id,
        stripeProductId: product.id,
        name: subName,
        amount,
        interval: dbInterval,
        status: subStatus,
        notes: subNotes || undefined,
        currentPeriodStart: new Date((subData.current_period_start || 0) * 1000),
        currentPeriodEnd: new Date((subData.current_period_end || 0) * 1000),
      });

      await opsStorage.recalculateClientMrr(clientId);

      await opsStorage.createActivityLog({
        entityType: "subscription",
        entityId: localSub.id,
        action: "created_inline",
        details: { clientId, amount, interval: dbInterval, stripeSubscriptionId: subscription.id },
        createdBy: "admin",
      });

      const requiresAction = paymentIntent?.status === "requires_action" || paymentIntent?.status === "requires_payment_method";

      res.status(201).json({
        subscription: localSub,
        requiresAction,
        paymentIntentClientSecret: requiresAction ? paymentIntent?.client_secret : null,
      });
    } catch (error: any) {
      console.error("Create subscription error:", error);
      res.status(500).json({ message: error.message || "Failed to create subscription" });
    }
  });

  app.post("/api/ops/clients/:clientId/payments/create-intent", isAuthenticated, async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) return res.status(500).json({ message: "Stripe is not configured. Add STRIPE_SECRET_KEY." });

      const clientId = String(req.params.clientId);
      const body = req.body as { amount: string; description?: string };
      const payAmount = parseFloat(body.amount || "0");
      const description = body.description || "One-time payment";

      if (!payAmount || payAmount <= 0) {
        return res.status(400).json({ message: "A valid amount is required" });
      }

      const client = await opsStorage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      let stripeCustomerId = client.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          name: client.name,
          email: client.email || undefined,
          phone: client.phone || undefined,
          metadata: { blackridge_client_id: client.id },
        });
        stripeCustomerId = customer.id;
        await opsStorage.updateClient(clientId, { stripeCustomerId });
      }

      const unitAmount = Math.round(payAmount * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: unitAmount,
        currency: "usd",
        customer: stripeCustomerId,
        description,
        metadata: {
          blackridge_client_id: clientId,
          payment_description: description,
        },
      });

      res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
    } catch (error: any) {
      console.error("Payment intent error:", error);
      res.status(500).json({ message: error.message || "Failed to create payment intent" });
    }
  });

  app.post("/api/ops/clients/:clientId/payments/confirm", isAuthenticated, async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) return res.status(500).json({ message: "Stripe is not configured." });

      const clientId = String(req.params.clientId);
      const body = req.body as { paymentIntentId: string; description?: string };
      const { paymentIntentId, description } = body;

      if (!paymentIntentId) return res.status(400).json({ message: "paymentIntentId is required" });

      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (pi.status !== "succeeded") {
        return res.status(400).json({ message: `Payment not completed. Status: ${pi.status}` });
      }

      const amount = (pi.amount / 100).toFixed(2);

      const payment = await opsStorage.createStripePayment({
        clientId,
        stripePaymentIntentId: pi.id,
        amount,
        currency: pi.currency || "usd",
        status: "succeeded",
        paymentType: "one_time",
        paymentMethod: "stripe",
        description: description || pi.description || "One-time payment",
        paidAt: new Date(),
      });

      await opsStorage.createActivityLog({
        entityType: "payment",
        entityId: payment.id,
        action: "one_time_payment",
        details: { clientId, amount, stripePaymentIntentId: pi.id },
        createdBy: "admin",
      });

      try {
        await bookkeepingStorage.postPaymentToLedger(
          amount,
          `Stripe payment: ${description || "One-time payment"}`,
          "stripe_payment",
          payment.id,
          true
        );
      } catch (e) {
        console.error("Auto-post Stripe payment to ledger failed:", e);
      }

      try {
        const revenueAcctId = await getAccountIdByCode("4000");
        await recordRevenue({
          amount: Number(amount),
          revenueAccountId: revenueAcctId,
          paymentMethod: "stripe",
          occurredAt: new Date(),
          memo: `Stripe payment: ${description || "One-time payment"} ($${amount})`,
          referenceType: "stripe_payment",
          referenceId: `stripe_payment_${payment.id}`,
        });
      } catch (e) {
        console.error("Auto-post Stripe payment to v2 ledger failed:", e);
      }

      res.status(201).json({ payment });
    } catch (error: any) {
      console.error("Payment confirm error:", error);
      res.status(500).json({ message: error.message || "Failed to record payment" });
    }
  });

  app.post("/api/ops/clients/:clientId/payment-links", isAuthenticated, async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) return res.status(500).json({ message: "Stripe is not configured." });

      const clientId = String(req.params.clientId);
      const client = await opsStorage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      const { amount, description, projectId } = req.body;
      if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ message: "Invalid amount" });

      const crypto = await import("crypto");
      const token = crypto.randomBytes(32).toString("hex");

      const link = await opsStorage.createPaymentLink({
        token,
        clientId,
        amount: String(amount),
        description: description || `Payment for ${client.name}`,
        clientName: client.name,
        clientEmail: client.email,
        status: "pending",
        projectId: projectId || null,
      });

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      res.status(201).json({ link, url: `${baseUrl}/pay/${token}` });
    } catch (error: any) {
      console.error("Create payment link error:", error);
      res.status(500).json({ message: error.message || "Failed to create payment link" });
    }
  });

  app.get("/api/ops/clients/:clientId/payment-links", isAuthenticated, async (req, res) => {
    try {
      const links = await opsStorage.getClientPaymentLinks(String(req.params.clientId));
      res.json(links);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/pay/:token", async (req, res) => {
    try {
      const link = await opsStorage.getPaymentLinkByToken(String(req.params.token));
      if (!link) return res.status(404).json({ message: "Payment link not found" });
      if (link.status === "paid") return res.json({ ...link, alreadyPaid: true });
      if (link.expiresAt && new Date(link.expiresAt) < new Date()) return res.status(410).json({ message: "Payment link has expired" });
      res.json(link);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/pay/:token/intent", async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) return res.status(500).json({ message: "Payment processing unavailable" });

      const link = await opsStorage.getPaymentLinkByToken(String(req.params.token));
      if (!link) return res.status(404).json({ message: "Payment link not found" });
      if (link.status === "paid") return res.status(400).json({ message: "Already paid" });
      if (link.expiresAt && new Date(link.expiresAt) < new Date()) return res.status(410).json({ message: "Payment link has expired" });

      if (link.stripePaymentIntentId) {
        const existing = await stripe.paymentIntents.retrieve(link.stripePaymentIntentId);
        if (existing.status !== "succeeded" && existing.status !== "canceled") {
          return res.json({ clientSecret: existing.client_secret });
        }
      }

      const amountCents = Math.round(parseFloat(link.amount) * 100);
      const pi = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: link.currency || "usd",
        description: link.description || undefined,
        metadata: {
          paymentLinkId: link.id,
          clientId: link.clientId,
          projectId: link.projectId || "",
        },
      });

      await opsStorage.updatePaymentLink(link.id, { stripePaymentIntentId: pi.id });

      res.json({ clientSecret: pi.client_secret });
    } catch (error: any) {
      console.error("Payment intent creation error:", error);
      res.status(500).json({ message: error.message || "Failed to create payment" });
    }
  });

  app.post("/api/pay/:token/confirm", async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) return res.status(500).json({ message: "Payment processing unavailable" });

      const link = await opsStorage.getPaymentLinkByToken(String(req.params.token));
      if (!link) return res.status(404).json({ message: "Payment link not found" });
      if (link.status === "paid") return res.json({ success: true, message: "Already paid" });

      if (!link.stripePaymentIntentId) return res.status(400).json({ message: "No payment intent found" });

      const pi = await stripe.paymentIntents.retrieve(link.stripePaymentIntentId);
      if (pi.status !== "succeeded") return res.status(400).json({ message: "Payment not yet confirmed" });

      const payment = await opsStorage.createStripePayment({
        clientId: link.clientId,
        amount: link.amount,
        currency: link.currency || "usd",
        status: "succeeded",
        paymentType: "one_time",
        description: link.description || "Payment via link - Paid via payment link",
        stripePaymentIntentId: pi.id,
      });

      const claimed = await opsStorage.claimPaymentLink(link.id, payment.id);
      if (!claimed) {
        return res.json({ success: true, message: "Already paid" });
      }

      await opsStorage.createActivityLog({
        entityType: "payment",
        entityId: payment.id,
        action: "payment_link_paid",
        details: { clientId: link.clientId, amount: link.amount, token: link.token },
        createdBy: "client",
      });

      if (link.projectId) {
        try {
          const projPayments = await opsStorage.getProjectPayments(link.projectId);
          const linkAmt = Number(link.amount);
          let remaining = linkAmt;
          for (const pp of projPayments) {
            if (pp.status === "pending" && remaining > 0 && pp.amount <= remaining) {
              await opsStorage.updateProjectPayment(pp.id, {
                status: "received",
                receivedDate: new Date(),
                paymentMethod: "stripe",
              });
              remaining -= pp.amount;
              await opsStorage.createActivityLog({
                entityType: "payment",
                entityId: pp.id,
                projectId: link.projectId,
                action: "payment_received",
                details: { label: pp.label, amount: pp.amount, paymentMethod: "stripe", via: "payment_link" },
                createdBy: "system",
              });
            }
          }
        } catch (e) {
          console.error("Auto-mark project payments as received failed:", e);
        }
      }

      try {
        await bookkeepingStorage.postPaymentToLedger(
          String(link.amount),
          `Payment link: ${link.description || "Client payment"}`,
          "stripe_payment",
          payment.id,
          true
        );
      } catch (e) {
        console.error("Auto-post payment link to ledger failed:", e);
      }

      try {
        const revenueAcctId = await getAccountIdByCode("4000");
        await recordRevenue({
          amount: Number(link.amount),
          revenueAccountId: revenueAcctId,
          paymentMethod: "stripe",
          occurredAt: new Date(),
          memo: `Stripe payment: ${link.description || "Payment via link"}`,
          referenceType: "stripe_payment",
          referenceId: `stripe_payment_${payment.id}`,
        });
      } catch (e) {
        console.error("Auto-post payment link to v2 ledger failed:", e);
      }

      if (link.clientEmail) {
        sendThankYouEmail(
          link.clientName || "Friend",
          link.clientEmail,
          link.description
        ).catch(e => console.error("Thank-you email error:", e));

        opsStorage.createActivityLog({
          entityType: "payment",
          entityId: payment.id,
          action: "thank_you_email_sent",
          details: { clientEmail: link.clientEmail, clientName: link.clientName },
          createdBy: "system",
        }).catch(e => console.error("Activity log for thank-you email failed:", e));
      }

      res.json({ success: true, payment });
    } catch (error: any) {
      console.error("Payment confirmation error:", error);
      res.status(500).json({ message: error.message || "Failed to confirm payment" });
    }
  });

  // Refresh a subscription's period dates and payment history from Stripe.
  // Useful when webhooks were missed or period dates got stored as epoch zero.
  app.post("/api/ops/subscriptions/:id/refresh-from-stripe", isAuthenticated, async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) return res.status(500).json({ message: "Stripe not configured" });

      const subId = (req.params as any).id;
      const sub = await opsStorage.getSubscription(subId);
      if (!sub) return res.status(404).json({ message: "Subscription not found" });
      if (!sub.stripeSubscriptionId) {
        return res.status(400).json({ message: "Subscription is not linked to Stripe" });
      }

      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      const subData = stripeSub as any;

      // Newer Stripe API returns current_period_* on items, not the subscription
      const item0 = subData.items?.data?.[0] as any;
      const periodStartSec = item0?.current_period_start || subData.current_period_start || 0;
      const periodEndSec = item0?.current_period_end || subData.current_period_end || 0;
      const periodStart = periodStartSec > 0 ? new Date(periodStartSec * 1000) : null;
      const periodEnd = periodEndSec > 0 ? new Date(periodEndSec * 1000) : null;
      const canceledAt = subData.canceled_at ? new Date(subData.canceled_at * 1000) : null;

      const statusMap: Record<string, string> = {
        active: "active",
        past_due: "past_due",
        canceled: "canceled",
        trialing: "trialing",
        paused: "paused",
        incomplete: "past_due",
        incomplete_expired: "canceled",
        unpaid: "past_due",
      };
      const newStatus = (statusMap[subData.status] || sub.status) as any;
      const amountCents = item0?.price?.unit_amount || 0;
      const amount = amountCents > 0 ? (amountCents / 100).toFixed(2) : sub.amount;
      const stripeInterval = item0?.price?.recurring?.interval;
      const dbInterval = stripeInterval === "year" ? "annual" : stripeInterval === "month" ? "monthly" : sub.interval;

      await opsStorage.updateSubscription(sub.id, {
        status: newStatus,
        amount,
        interval: dbInterval as any,
        ...(periodStart ? { currentPeriodStart: periodStart } : {}),
        ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
        ...(canceledAt ? { canceledAt } : {}),
        stripePriceId: item0?.price?.id || sub.stripePriceId,
        stripeProductId: (typeof item0?.price?.product === "string" ? item0.price.product : undefined) || sub.stripeProductId,
      });

      // Pull invoices for this subscription and upsert as stripe_payments
      const invoices: Stripe.Invoice[] = [];
      let starting_after: string | undefined;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await stripe.invoices.list({
          subscription: sub.stripeSubscriptionId,
          limit: 100,
          ...(starting_after ? { starting_after } : {}),
        });
        invoices.push(...page.data);
        if (!page.has_more || page.data.length === 0) break;
        starting_after = page.data[page.data.length - 1].id;
      }

      const existing = await opsStorage.getStripePayments(sub.clientId);
      const byInvoiceId = new Map(existing.filter(p => p.stripeInvoiceId).map(p => [p.stripeInvoiceId!, p]));

      let inserted = 0;
      let updated = 0;
      for (const inv of invoices) {
        const invAny = inv as any;
        const amountPaid = ((invAny.amount_paid || 0) / 100).toFixed(2);
        const status = inv.status === "paid" ? "succeeded"
          : inv.status === "open" ? "pending"
          : inv.status === "void" ? "failed"
          : inv.status === "uncollectible" ? "failed"
          : "pending";
        const paidAt = invAny.status_transitions?.paid_at
          ? new Date(invAny.status_transitions.paid_at * 1000)
          : null;
        const description = `Invoice ${inv.number || inv.id}`;
        const piId = typeof invAny.payment_intent === "string"
          ? invAny.payment_intent
          : invAny.payment_intent?.id || null;

        const existingPayment = byInvoiceId.get(inv.id!);
        if (existingPayment) {
          await opsStorage.updateStripePayment(existingPayment.id, {
            subscriptionId: sub.id,
            amount: amountPaid,
            status,
            paidAt,
            description,
            stripePaymentIntentId: piId,
            paymentType: "recurring",
          } as any);
          updated++;
        } else {
          await opsStorage.createStripePayment({
            clientId: sub.clientId,
            subscriptionId: sub.id,
            stripePaymentIntentId: piId,
            stripeInvoiceId: inv.id,
            amount: amountPaid,
            currency: inv.currency || "usd",
            status,
            paymentType: "recurring",
            paymentMethod: "stripe",
            description,
            paidAt,
          } as any);
          inserted++;
        }
      }

      const refreshed = await opsStorage.getSubscription(sub.id);
      res.json({
        subscription: refreshed,
        invoicesProcessed: invoices.length,
        paymentsInserted: inserted,
        paymentsUpdated: updated,
      });
    } catch (error: any) {
      console.error("Refresh subscription from Stripe error:", error);
      res.status(500).json({
        message: "Failed to refresh from Stripe",
        error: error?.message || String(error),
      });
    }
  });

  // Pause / resume / cancel a subscription. For Stripe-linked subscriptions
  // this propagates the change to Stripe; for manual subscriptions it just
  // updates the local status.
  // body: { action: "pause" | "resume" | "cancel" | "cancel_at_period_end" }
  app.post("/api/ops/subscriptions/:id/billing-action", isAuthenticated, async (req, res) => {
    try {
      const subId = (req.params as any).id;
      const action = (req.body?.action || "") as string;
      if (!["pause", "resume", "cancel", "cancel_at_period_end"].includes(action)) {
        return res.status(400).json({ message: "Invalid action" });
      }

      const sub = await opsStorage.getSubscription(subId);
      if (!sub) return res.status(404).json({ message: "Subscription not found" });

      const stripe = getStripe();

      // If linked to Stripe, propagate to Stripe first
      if (sub.stripeSubscriptionId && stripe) {
        try {
          if (action === "pause") {
            await stripe.subscriptions.update(sub.stripeSubscriptionId, {
              pause_collection: { behavior: "void" },
            } as any);
          } else if (action === "resume") {
            await stripe.subscriptions.update(sub.stripeSubscriptionId, {
              pause_collection: "" as any, // null clears it
            } as any);
          } else if (action === "cancel") {
            await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
          } else if (action === "cancel_at_period_end") {
            await stripe.subscriptions.update(sub.stripeSubscriptionId, {
              cancel_at_period_end: true,
            });
          }
        } catch (err: any) {
          console.error("Stripe billing-action error:", err);
          return res.status(502).json({ message: "Stripe call failed", error: err?.message || String(err) });
        }
      }

      const newStatus =
        action === "pause" ? "paused" :
        action === "resume" ? "active" :
        action === "cancel" ? "canceled" :
        sub.status; // cancel_at_period_end keeps current status until period ends

      const updates: any = { status: newStatus };
      if (action === "cancel") {
        updates.canceledAt = new Date();
      }

      const updated = await opsStorage.updateSubscription(sub.id, updates);
      await opsStorage.recalculateClientMrr(sub.clientId);

      await opsStorage.createActivityLog({
        entityType: "subscription",
        entityId: sub.id,
        action: `billing_${action}`,
        details: { stripeSubscriptionId: sub.stripeSubscriptionId, clientId: sub.clientId },
        createdBy: "admin",
      });

      res.json({ subscription: updated });
    } catch (error: any) {
      console.error("Billing action error:", error);
      res.status(500).json({ message: "Failed to update billing", error: error?.message || String(error) });
    }
  });

  // Reschedule the next billing date. Uses Stripe's trial_end to advance or
  // delay the upcoming charge without prorating.
  // body: { nextBillingDate: "YYYY-MM-DD" }
  app.post("/api/ops/subscriptions/:id/reschedule", isAuthenticated, async (req, res) => {
    try {
      const subId = (req.params as any).id;
      const dateStr = (req.body?.nextBillingDate || "") as string;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ message: "nextBillingDate must be YYYY-MM-DD" });
      }
      const date = new Date(`${dateStr}T00:00:00Z`);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ message: "Invalid date" });
      }
      // Stripe requires trial_end to be in the future
      if (date.getTime() <= Date.now() + 60 * 1000) {
        return res.status(400).json({ message: "Next billing date must be in the future" });
      }

      const sub = await opsStorage.getSubscription(subId);
      if (!sub) return res.status(404).json({ message: "Subscription not found" });

      const stripe = getStripe();

      if (sub.stripeSubscriptionId && stripe) {
        try {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, {
            trial_end: Math.floor(date.getTime() / 1000),
            proration_behavior: "none",
          } as any);
        } catch (err: any) {
          console.error("Stripe reschedule error:", err);
          return res.status(502).json({ message: "Stripe call failed", error: err?.message || String(err) });
        }
      }

      const updated = await opsStorage.updateSubscription(sub.id, {
        currentPeriodEnd: date,
      });

      await opsStorage.createActivityLog({
        entityType: "subscription",
        entityId: sub.id,
        action: "rescheduled",
        details: { nextBillingDate: dateStr, stripeSubscriptionId: sub.stripeSubscriptionId },
        createdBy: "admin",
      });

      res.json({ subscription: updated });
    } catch (error: any) {
      console.error("Reschedule error:", error);
      res.status(500).json({ message: "Failed to reschedule", error: error?.message || String(error) });
    }
  });

  app.post("/api/stripe/webhook", async (req, res) => {
    const stripe = getStripe();
    if (!stripe) return res.status(500).json({ message: "Stripe not configured" });

    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      console.error("Missing stripe-signature header or STRIPE_WEBHOOK_SECRET");
      return res.status(400).json({ message: "Missing signature or webhook secret" });
    }

    let event: Stripe.Event;
    try {
      const rawBody = (req as any).rawBody;
      if (!rawBody) {
        return res.status(400).json({ message: "Raw body not available" });
      }
      event = stripe.webhooks.constructEvent(rawBody, sig as string, webhookSecret);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }

    const existing = await opsStorage.findStripeEvent(event.id);
    if (existing) {
      return res.json({ received: true, duplicate: true });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(stripe, event.data.object as any);
          break;
        case "invoice.paid":
          await handleInvoicePaid(stripe, event.data.object as any);
          break;
        case "invoice.payment_failed":
          await handleInvoicePaymentFailed(event.data.object as any);
          break;
        case "customer.subscription.updated":
          await handleSubscriptionUpdated(event.data.object as any);
          break;
        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(event.data.object as any);
          break;
      }

      await opsStorage.createStripeEvent({
        stripeEventId: event.id,
        eventType: event.type,
        data: event.data.object as any,
      });

      res.json({ received: true });
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(500).json({ message: "Webhook processing failed" });
    }
  });
}

async function handleCheckoutCompleted(stripe: Stripe, session: any) {
  if (session.mode !== "subscription" || !session.subscription) return;

  const clientId = session.metadata?.blackridge_client_id;
  if (!clientId) {
    console.error("checkout.session.completed: missing blackridge_client_id in metadata");
    return;
  }

  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const stripeSub = await stripe.subscriptions.retrieve(subId);
  const subData = stripeSub as any;

  const priceId = session.metadata?.price_id || subData.items?.data?.[0]?.price?.id;
  const productId = session.metadata?.product_id || (typeof subData.items?.data?.[0]?.price?.product === "string" ? subData.items.data[0].price.product : undefined);
  const subscriptionName = session.metadata?.subscription_name || "Subscription";

  const amountCents = subData.items?.data?.[0]?.price?.unit_amount || 0;
  const amount = (amountCents / 100).toFixed(2);
  const stripeInterval = subData.items?.data?.[0]?.price?.recurring?.interval;
  const dbInterval = stripeInterval === "year" ? "annual" : "monthly";

  const existingSub = await opsStorage.findSubscriptionByStripeId(subId);
  if (existingSub) {
    await opsStorage.updateSubscription(existingSub.id, {
      status: "active",
      stripePriceId: priceId,
      stripeProductId: productId,
      amount,
      interval: dbInterval,
      currentPeriodStart: new Date((subData.current_period_start || 0) * 1000),
      currentPeriodEnd: new Date((subData.current_period_end || 0) * 1000),
    });
  } else {
    await opsStorage.createSubscription({
      clientId,
      stripeSubscriptionId: subId,
      stripePriceId: priceId,
      stripeProductId: productId,
      name: subscriptionName,
      amount,
      interval: dbInterval,
      status: "active",
      currentPeriodStart: new Date((subData.current_period_start || 0) * 1000),
      currentPeriodEnd: new Date((subData.current_period_end || 0) * 1000),
    });
  }

  await opsStorage.recalculateClientMrr(clientId);

  await opsStorage.createActivityLog({
    entityType: "subscription",
    entityId: subId,
    action: "stripe_checkout_completed",
    details: { clientId, amount, interval: dbInterval, stripeSubscriptionId: subId },
    createdBy: "stripe",
  });
}

async function handleInvoicePaid(stripe: Stripe, invoice: any) {
  const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subId) return;

  const sub = await opsStorage.findSubscriptionByStripeId(subId);
  if (!sub) {
    console.error("invoice.paid: no local subscription for", subId);
    return;
  }

  const amountPaid = ((invoice.amount_paid || 0) / 100).toFixed(2);

  const payment = await opsStorage.createStripePayment({
    clientId: sub.clientId,
    subscriptionId: sub.id,
    stripePaymentIntentId: typeof invoice.payment_intent === "string" ? invoice.payment_intent : invoice.payment_intent?.id || null,
    stripeInvoiceId: invoice.id,
    amount: amountPaid,
    currency: invoice.currency || "usd",
    status: "succeeded",
    paymentType: "recurring",
    paymentMethod: "stripe",
    description: `Invoice ${invoice.number || invoice.id}`,
    paidAt: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date(),
  });

  try {
    await bookkeepingStorage.postPaymentToLedger(
      amountPaid,
      `Subscription payment: ${sub.name || "Recurring"} — Invoice ${invoice.number || invoice.id}`,
      "stripe_payment",
      `stripe_payment_${payment.id}`,
      false
    );
  } catch (e) {
    console.error("Auto-post subscription payment to ledger failed:", e);
  }

  try {
    const subRevenueAcctId = await getAccountIdByCode("4010");
    await recordRevenue({
      amount: Number(amountPaid),
      revenueAccountId: subRevenueAcctId,
      paymentMethod: "stripe",
      occurredAt: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date(),
      memo: `Subscription payment: ${sub.name || "Recurring"} — Invoice ${invoice.number || invoice.id}`,
      referenceType: "stripe_payment",
      referenceId: `stripe_payment_${payment.id}`,
    });
  } catch (e) {
    console.error("Auto-post subscription payment to v2 ledger failed:", e);
  }

  await opsStorage.createActivityLog({
    entityType: "subscription",
    entityId: sub.id,
    action: "payment_received",
    details: { amount: amountPaid, invoiceNumber: invoice.number || invoice.id, clientId: sub.clientId },
    createdBy: "stripe",
  });

  const stripeSub = await stripe.subscriptions.retrieve(subId);
  const subData = stripeSub as any;
  await opsStorage.updateSubscription(sub.id, {
    status: "active",
    currentPeriodStart: new Date((subData.current_period_start || 0) * 1000),
    currentPeriodEnd: new Date((subData.current_period_end || 0) * 1000),
  });

  await opsStorage.recalculateClientMrr(sub.clientId);
}

async function handleInvoicePaymentFailed(invoice: any) {
  const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subId) return;

  const sub = await opsStorage.findSubscriptionByStripeId(subId);
  if (!sub) return;

  await opsStorage.updateSubscription(sub.id, { status: "past_due" });
  await opsStorage.recalculateClientMrr(sub.clientId);

  await opsStorage.createActivityLog({
    entityType: "subscription",
    entityId: sub.id,
    action: "payment_failed",
    details: { invoiceId: invoice.id, clientId: sub.clientId },
    createdBy: "stripe",
  });
}

async function handleSubscriptionUpdated(stripeSub: any) {
  const sub = await opsStorage.findSubscriptionByStripeId(stripeSub.id);
  if (!sub) return;

  const statusMap: Record<string, string> = {
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    trialing: "trialing",
    paused: "paused",
    incomplete: "past_due",
    incomplete_expired: "canceled",
    unpaid: "past_due",
  };

  const newStatus = (statusMap[stripeSub.status] || "active") as any;
  const amountCents = stripeSub.items?.data?.[0]?.price?.unit_amount || 0;
  const amount = (amountCents / 100).toFixed(2);
  const stripeInterval = stripeSub.items?.data?.[0]?.price?.recurring?.interval;
  const dbInterval = stripeInterval === "year" ? "annual" : "monthly";

  await opsStorage.updateSubscription(sub.id, {
    status: newStatus,
    amount,
    interval: dbInterval,
    currentPeriodStart: new Date((stripeSub.current_period_start || 0) * 1000),
    currentPeriodEnd: new Date((stripeSub.current_period_end || 0) * 1000),
    canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : undefined,
  });

  await opsStorage.recalculateClientMrr(sub.clientId);
}

async function handleSubscriptionDeleted(stripeSub: any) {
  const sub = await opsStorage.findSubscriptionByStripeId(stripeSub.id);
  if (!sub) return;

  await opsStorage.updateSubscription(sub.id, {
    status: "canceled",
    canceledAt: new Date(),
  });

  await opsStorage.recalculateClientMrr(sub.clientId);

  await opsStorage.createActivityLog({
    entityType: "subscription",
    entityId: sub.id,
    action: "canceled",
    details: { stripeSubscriptionId: stripeSub.id, clientId: sub.clientId },
    createdBy: "stripe",
  });
}
