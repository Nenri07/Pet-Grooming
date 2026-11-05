/**
 * Groomer deposit payment links — PURE.
 *
 * Until Pawxis can run Stripe Connect, a groomer can paste their own payment
 * link (PayPal.me, a Stripe Payment Link, Square, Cash App, Venmo). Clients pay
 * the deposit there after booking and the groomer marks it received.
 *
 * Only https links on known payment sites are accepted, so a booking page can
 * never send clients to an arbitrary (possibly phishing) site.
 */

/** Allowed hosts and the provider name shown to clients. */
const PROVIDERS: ReadonlyArray<{ hosts: readonly string[]; label: string }> = [
  { hosts: ['paypal.me', 'www.paypal.me', 'paypal.com', 'www.paypal.com'], label: 'PayPal' },
  { hosts: ['buy.stripe.com'], label: 'Stripe' },
  { hosts: ['square.link', 'checkout.square.site'], label: 'Square' },
  { hosts: ['cash.app'], label: 'Cash App' },
  { hosts: ['venmo.com', 'account.venmo.com'], label: 'Venmo' },
];

export const PAYMENT_LINK_MAX_LENGTH = 500;

/** Human-readable list of supported providers (for help text). */
export const PAYMENT_LINK_PROVIDERS = PROVIDERS.map((p) => p.label);

function providerFor(host: string): string | null {
  const h = host.toLowerCase();
  return PROVIDERS.find((p) => p.hosts.includes(h))?.label ?? null;
}

/**
 * Validate and normalise a pasted link. Accepts a missing scheme
 * ("paypal.me/name"). Returns null when it is not an https link on an allowed
 * payment site, carries credentials, or is too long.
 */
export function normalizePaymentLink(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value || value.length > PAYMENT_LINK_MAX_LENGTH) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;
  if (!providerFor(url.hostname)) return null;
  url.hash = '';
  return url.toString();
}

/** The provider name for a (normalised) link, e.g. "PayPal". */
export function paymentLinkLabel(link: string): string {
  try {
    return providerFor(new URL(link).hostname) ?? 'online';
  } catch {
    return 'online';
  }
}

/**
 * The link the client should open for a given deposit. PayPal.me links take
 * the amount in the path (paypal.me/name/25USD), so the client doesn't have to
 * type it; other providers are returned unchanged.
 */
export function paymentLinkForAmount(link: string, amount: number, currency = 'USD'): string {
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    if ((host === 'paypal.me' || host === 'www.paypal.me') && Number.isFinite(amount) && amount > 0) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 1) {
        const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
        url.pathname = `/${parts[0]}/${value}${currency.toUpperCase()}`;
        return url.toString();
      }
    }
    return url.toString();
  } catch {
    return link;
  }
}

/**
 * What the booking page should offer for the deposit step: the provider label
 * and amount when the groomer requires a deposit, card payments aren't
 * connected, and a valid payment link is set. Otherwise null.
 */
export function depositLinkOffer(input: {
  depositAmount?: number | null;
  paymentsReady: boolean;
  depositPaymentLink?: string | null;
}): { label: string; amount: number } | null {
  const amount = typeof input.depositAmount === 'number' ? input.depositAmount : 0;
  if (!(amount > 0) || input.paymentsReady) return null;
  const link = normalizePaymentLink(input.depositPaymentLink);
  return link ? { label: paymentLinkLabel(link), amount } : null;
}
