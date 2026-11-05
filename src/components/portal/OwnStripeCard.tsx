'use client';

/**
 * OwnStripeCard — connect the groomer's own Stripe account by pasting one key,
 * so client deposits are charged by card and confirmed automatically.
 * The key goes straight to the server; it is never shown again.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CreditCard, ExternalLink, ShieldCheck } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { connectOwnStripe, disconnectOwnStripe } from '@/actions/own-stripe';

export interface OwnStripeStatus {
  available: boolean;
  connected: boolean;
  accountName: string | null;
  keyHint: string | null;
  livemode: boolean | null;
  autoConfirm: boolean;
}

export function OwnStripeCard({ status }: { status: OwnStripeStatus }) {
  const router = useRouter();
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await connectOwnStripe(key);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setKey('');
    toast.success(`Connected: ${res.accountName}`);
    router.refresh();
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Stripe? Clients won\u2019t be able to pay deposits by card until you connect again.')) return;
    setBusy(true);
    await disconnectOwnStripe();
    setBusy(false);
    toast.success('Stripe disconnected.');
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Card deposits (Stripe)</CardTitle>
        </div>
        <CardDescription>
          Clients pay your deposit by card and the booking confirms itself. The money goes
          straight into your own Stripe account. Pawxis never holds it.
        </CardDescription>
      </CardHeader>

      {!status.available ? (
        <p className="text-sm text-base-content/70">Card deposits aren&apos;t available yet.</p>
      ) : status.connected ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-box bg-success/10 px-4 py-3 text-sm">
            <p className="font-semibold text-base-content">
              Connected: {status.accountName ?? 'your Stripe account'}
              {status.livemode === false && <span className="badge badge-warning ml-2">Test mode</span>}
            </p>
            <p className="text-base-content/70">Key {status.keyHint}</p>
            {!status.autoConfirm && (
              <p className="mt-1 text-warning-content">
                Backup confirmation is off. Give the key &ldquo;Webhook Endpoints: Write&rdquo; and
                reconnect, so bookings still confirm if a client closes the page after paying.
              </p>
            )}
          </div>
          <p className="text-xs text-base-content/60">
            Make sure a deposit amount is set above. To change keys, disconnect and connect again.
          </p>
          <button type="button" className="btn btn-outline btn-error min-h-[44px] self-start" onClick={disconnect} disabled={busy}>
            Disconnect Stripe
          </button>
        </div>
      ) : (
        <form onSubmit={connect} className="flex flex-col gap-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-base-content/80">
            <li>
              In Stripe, open{' '}
              <a
                href="https://dashboard.stripe.com/apikeys/create"
                target="_blank"
                rel="noopener noreferrer"
                className="link link-primary inline-flex items-center gap-1"
              >
                Create restricted key <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>{' '}
              and name it <strong>Pawxis</strong>.
            </li>
            <li>
              Set <strong>Checkout Sessions</strong> and <strong>Webhook Endpoints</strong> to{' '}
              <strong>Write</strong>, and <strong>PaymentIntents</strong> to <strong>Read</strong>.
              Leave everything else as None.
            </li>
            <li>Click Create key, copy it (it starts with rk_live_), and paste it here.</li>
          </ol>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="input input-bordered min-h-[44px] w-full font-mono"
            placeholder="rk_live_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="Stripe restricted key"
          />
          {error && (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          )}
          <p className="flex items-start gap-2 text-xs text-base-content/60">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Your key is encrypted and never shown again. A restricted key can take payments but
            can&apos;t move or withdraw your money. You can disconnect any time.
          </p>
          <button type="submit" className="btn btn-primary min-h-[44px] self-start" disabled={busy || key.trim().length < 20}>
            {busy ? 'Checking with Stripe…' : 'Connect Stripe'}
          </button>
        </form>
      )}
    </Card>
  );
}

export default OwnStripeCard;
