import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Shield, Lock } from "lucide-react";

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

interface PaymentLinkData {
  id: string;
  token: string;
  amount: string;
  currency: string;
  description: string | null;
  clientName: string | null;
  clientEmail: string | null;
  status: string;
  alreadyPaid?: boolean;
  paidAt?: string | null;
}

function PaymentForm({ link, onSuccess }: { link: PaymentLinkData; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || "Please check your payment details.");
      setProcessing(false);
      return;
    }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message || "Payment failed. Please try again.");
      setProcessing(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      try {
        await fetch(`/api/pay/${link.token}/confirm`, { method: "POST" });
      } catch {}
      onSuccess();
    } else if (paymentIntent?.status === "requires_action") {
      setError("Additional authentication required. Please complete verification.");
    } else {
      setError("Payment was not completed. Please try again.");
    }
    setProcessing(false);
  };

  const amount = parseFloat(link.amount);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: link.currency || "usd",
  }).format(amount);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
        <div className="flex justify-between items-center mb-1">
          <span className="text-gray-400 text-sm">Amount Due</span>
          <span className="text-2xl font-bold text-white" data-testid="text-payment-amount">{formatted}</span>
        </div>
        {link.description && (
          <p className="text-gray-400 text-sm mt-2" data-testid="text-payment-description">{link.description}</p>
        )}
      </div>

      <div className="space-y-3">
        <PaymentElement
          options={{
            layout: "tabs",
          }}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3" data-testid="text-payment-error">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <Button
        type="submit"
        disabled={!stripe || processing}
        className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold py-3 text-lg"
        data-testid="button-pay-now"
      >
        {processing ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Processing...
          </>
        ) : (
          `Pay ${formatted}`
        )}
      </Button>

      <div className="flex items-center justify-center gap-2 text-gray-500 text-xs">
        <Lock className="h-3 w-3" />
        <span>Secured by Stripe</span>
        <span className="mx-1">•</span>
        <Shield className="h-3 w-3" />
        <span>256-bit encryption</span>
      </div>
    </form>
  );
}

function SuccessView({ link }: { link: PaymentLinkData }) {
  const amount = parseFloat(link.amount);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: link.currency || "usd",
  }).format(amount);

  return (
    <div className="text-center space-y-4 py-8">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-900/30 border border-green-700">
        <CheckCircle2 className="h-8 w-8 text-green-400" />
      </div>
      <h2 className="text-2xl font-bold text-white" data-testid="text-payment-success">Payment Successful</h2>
      <p className="text-gray-400">
        Your payment of <span className="text-white font-semibold">{formatted}</span> has been received.
      </p>
      {link.description && (
        <p className="text-gray-500 text-sm">{link.description}</p>
      )}
      <p className="text-gray-500 text-sm mt-6">
        A receipt has been sent to your email. You can close this page.
      </p>
    </div>
  );
}

export default function PayPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [link, setLink] = useState<PaymentLinkData | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!token) return;

    async function load() {
      try {
        const res = await fetch(`/api/pay/${token}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 404) setError("This payment link is not valid.");
          else if (res.status === 410) setError("This payment link has expired.");
          else setError(data.message || "Unable to load payment details.");
          setLoading(false);
          return;
        }

        const data = await res.json();
        setLink(data);

        if (data.alreadyPaid) {
          setPaid(true);
          setLoading(false);
          return;
        }

        const intentRes = await fetch(`/api/pay/${token}/intent`, { method: "POST" });
        if (!intentRes.ok) {
          const intentData = await intentRes.json().catch(() => ({}));
          setError(intentData.message || "Unable to initialize payment.");
          setLoading(false);
          return;
        }

        const { clientSecret: cs } = await intentRes.json();
        setClientSecret(cs);
      } catch {
        setError("Unable to load payment details. Please try again later.");
      }
      setLoading(false);
    }

    load();
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight" data-testid="text-brand-name">
            BLACK<span className="text-amber-500">RIDGE</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1">PLATFORMS</p>
        </div>

        <Card className="bg-gray-900 border-gray-800 shadow-2xl">
          <CardHeader className="text-center pb-4 border-b border-gray-800">
            <CardTitle className="text-white text-lg">
              {paid ? "Payment Complete" : link?.clientName ? `Invoice for ${link.clientName}` : "Payment"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
                <p className="text-gray-400 text-sm">Loading payment details...</p>
              </div>
            ) : error ? (
              <div className="text-center py-8 space-y-3">
                <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
                <p className="text-red-400" data-testid="text-payment-error-state">{error}</p>
              </div>
            ) : paid && link ? (
              <SuccessView link={link} />
            ) : link && clientSecret && stripePromise ? (
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: {
                    theme: "night",
                    variables: {
                      colorPrimary: "#d97706",
                      colorBackground: "#111827",
                      colorText: "#f3f4f6",
                      colorDanger: "#ef4444",
                      borderRadius: "8px",
                    },
                  },
                }}
              >
                <PaymentForm link={link} onSuccess={() => setPaid(true)} />
              </Elements>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-400">Payment processing is currently unavailable.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-gray-600 text-xs mt-6">
          &copy; {new Date().getFullYear()} BlackRidge Platforms. All rights reserved.
        </p>
      </div>
    </div>
  );
}