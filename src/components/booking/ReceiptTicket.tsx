'use client';

/**
 * ReceiptTicket — the booking INVOICE, shared by the booking success step,
 * the card-deposit return page, and the marketing showcase.
 *
 * The downloadable PDF is a high-resolution snapshot of this exact element
 * (see BookingReceipt), so what clients see is what they download. Plain
 * markup + theme tokens only — no extra libraries, so it costs nothing to load
 * and recolours with every theme. Responsive from 320px.
 */
import Image from 'next/image';
import { PawPrint } from 'lucide-react';
import type { ReceiptData } from './ReceiptPDF';
import { safeHttpsImageSrc } from '@/lib/images';

export interface ReceiptTicketProps {
  data: ReceiptData;
  /** Article id. Defaults to `pp-receipt` (print isolation); the showcase passes its own. */
  id?: string;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtDate(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString(undefined, opts) : '';
}

function fmtTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

type Status = { label: string; tone: 'success' | 'warning' | 'info' };

/** Shortened payment reference, e.g. "pi_3Q…8fK2". */
function shortRef(id: string): string {
  return id.length > 14 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-base-content/50">
      {children}
    </div>
  );
}

export function ReceiptTicket({ data, id = 'pp-receipt' }: ReceiptTicketProps) {
  const currency = data.currency || 'usd';
  const deposit = Math.max(0, data.depositAmount || 0);
  const depositDue = typeof data.depositDue === 'number' && data.depositDue > 0 ? data.depositDue : 0;
  const hasPrice = typeof data.servicePrice === 'number' && Number.isFinite(data.servicePrice) && data.servicePrice > 0;
  const total = hasPrice ? (data.servicePrice as number) : Math.max(deposit, depositDue);
  const paidNow = deposit;
  const balance = Math.max(0, total - paidNow - depositDue);

  const status: Status =
    depositDue > 0
      ? { label: 'Deposit due', tone: 'warning' }
      : paidNow > 0 && balance > 0
        ? { label: 'Deposit paid', tone: 'success' }
        : paidNow > 0
          ? { label: 'Paid', tone: 'success' }
          : { label: 'Confirmed', tone: 'info' };
  const toneClass =
    status.tone === 'success'
      ? 'bg-success/15 text-success'
      : status.tone === 'warning'
        ? 'bg-warning/20 text-warning-content'
        : 'bg-info/15 text-info';

  const issued = fmtDate(data.bookedOn ?? new Date(), { year: 'numeric', month: 'short', day: 'numeric' });
  const apptDate = fmtDate(data.scheduledDate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const apptTime = fmtTime(data.scheduledDate);
  const groomerLogo = safeHttpsImageSrc(data.logoUrl);
  const business = data.businessName || 'Pet Grooming';
  const paymentMethod = paidNow > 0 ? 'Card' : depositDue > 0 ? 'Payment link' : 'Pay on the day';

  return (
    <article
      id={id}
      className="overflow-hidden rounded-box border border-base-content/10 bg-base-100 text-base-content shadow-card"
    >
      <div aria-hidden="true" className="h-1.5 bg-gradient-to-r from-primary via-primary to-accent" />

      {/* Header: business identity + document title */}
      <header className="flex items-start justify-between gap-4 px-6 pb-5 pt-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
            {groomerLogo ? (
              <Image src={groomerLogo} alt={`${business} logo`} fill className="object-cover" sizes="44px" />
            ) : (
              <PawPrint className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold leading-tight">{business}</h3>
            <p className="text-xs text-base-content/50">Mobile pet grooming</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-extrabold tracking-[0.12em] text-base-content">INVOICE</div>
          <div className="mt-0.5 font-mono text-xs text-base-content/60">{data.bookingRef || '—'}</div>
        </div>
      </header>

      {/* Meta strip */}
      <div className="mx-6 grid grid-cols-3 gap-3 rounded-box bg-base-200/70 px-4 py-3">
        <div className="min-w-0">
          <Label>Issued</Label>
          <div className="mt-1 truncate text-xs font-semibold">{issued}</div>
        </div>
        <div className="min-w-0">
          <Label>Payment</Label>
          <div className="mt-1 truncate text-xs font-semibold">{paymentMethod}</div>
        </div>
        <div className="min-w-0 text-right">
          <Label>Status</Label>
          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${toneClass}`}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Parties */}
      <div className="grid grid-cols-2 gap-4 px-6 pt-5">
        <div className="min-w-0">
          <Label>Billed to</Label>
          <div className="mt-1 truncate text-sm font-semibold">{data.clientName || '—'}</div>
          {data.serviceAddress && (
            <div className="mt-0.5 text-xs leading-snug text-base-content/60">{data.serviceAddress}</div>
          )}
        </div>
        <div className="min-w-0 text-right">
          <Label>Appointment</Label>
          <div className="mt-1 text-sm font-semibold">{apptDate || 'To be confirmed'}</div>
          {apptTime && <div className="mt-0.5 text-xs text-base-content/60">{apptTime}</div>}
        </div>
      </div>

      {/* Line items */}
      <div className="px-6 pt-5">
        <div className="flex items-center justify-between border-b border-base-content/15 pb-2">
          <Label>Description</Label>
          <Label>Amount</Label>
        </div>
        <div className="flex items-start justify-between gap-3 border-b border-base-content/10 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{data.serviceName || 'Grooming service'}</div>
            <div className="mt-0.5 text-xs text-base-content/60">
              {data.petName ? `For ${data.petName}` : 'Grooming appointment'}
            </div>
          </div>
          <div className="shrink-0 font-mono text-sm font-semibold tabular-nums">{money(total, currency)}</div>
        </div>
      </div>

      {/* Totals */}
      <div className="space-y-1.5 px-6 pt-3 text-sm">
        <Row label="Subtotal" value={money(total, currency)} />
        {paidNow > 0 && <Row label="Deposit paid" value={`\u2212 ${money(paidNow, currency)}`} />}
        {depositDue > 0 && <Row label="Deposit due now (payment link)" value={money(depositDue, currency)} />}
        <div className="mt-2 flex items-center justify-between rounded-box bg-primary/10 px-4 py-3">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
            {balance > 0 ? 'Balance due on the day' : depositDue > 0 ? 'Then due on the day' : 'Amount due'}
          </span>
          <span className="font-mono text-lg font-extrabold tabular-nums text-base-content">
            {money(balance, currency)}
          </span>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-5 border-t border-base-content/10 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[0.7rem] text-base-content/55">
          <span>Show reference <span className="font-mono font-semibold text-base-content/80">{data.bookingRef || '—'}</span> on arrival.</span>
          {data.paymentIntentId && <span className="font-mono">Payment {shortRef(data.paymentIntentId)}</span>}
        </div>
        <div className="mt-3 flex items-center justify-between text-[0.7rem] text-base-content/45">
          <span>Thank you for your booking.</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="relative h-3.5 w-3.5">
              <Image src="/pawxisLogo.png" alt="" fill className="object-contain" sizes="14px" />
            </span>
            Powered by Pawxis
          </span>
        </div>
      </footer>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-base-content/60">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

export default ReceiptTicket;
