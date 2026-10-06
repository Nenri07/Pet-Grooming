/**
 * ReceiptPDF — a narrow receipt-slip booking receipt / INVOICE document.
 *
 * Rendered client-side by @react-pdf/renderer when the visitor taps
 * "Download receipt (PDF)" on the booking success step. It is laid out like a
 * proper invoice: a coloured header band (logo + business name + "BOOKING
 * RECEIPT / INVOICE"), an invoice meta row (invoice no. = booking reference,
 * issue date), a "Billed to" client block, an itemized table (Service /
 * Date & time / Amount) including the deposit line, a totals block (deposit
 * paid + a "balance due on the day" note when the service costs more than the
 * deposit), and a thank-you footer.
 *
 * Like PetCardPDF this module is intentionally free of DaisyUI / Tailwind —
 * @react-pdf uses its own StyleSheet and cannot read CSS variables, so the
 * literal colors below approximate the theme's primary/accent/ink. It is
 * lazy-loaded by BookingReceipt so the PDF engine never ships in the initial
 * bundle.
 */
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from '@react-pdf/renderer';

// Ivory + soft-blue palette matched to the Pawxis theme; literal hex because @react-pdf can't read CSS vars
const COLORS = {
  primary: '#5B9BD5',
  primaryDeep: '#3E6E9E',
  accent: '#8CC7C2',
  ink: '#2B2B28',
  text: '#44433E',
  muted: '#8A887F',
  faint: '#B4B1A6',
  hairline: '#ECE7DC',
  rowAlt: '#FBF9F3',
  band: '#FBF9F3',
  bandText: '#44433E',
  cardBg: '#FFFDF8',
  badgeBg: '#EAF3F2',
  badgeText: '#3E6E9E',
  white: '#FFFFFF',
};

const styles = StyleSheet.create({
  page: {
    padding: 0,
    fontSize: 9,
    color: COLORS.text,
    fontFamily: 'Helvetica',
    lineHeight: 1.45,
    backgroundColor: COLORS.cardBg,
    /* Narrow receipt slip: 80mm wide ≈ 226pt; height grows with content. */
  },

  /* Header band across the top. */
  band: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 8,
    marginRight: 8,
    objectFit: 'cover',
  },
  businessName: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.white,
  },
  bandTag: {
    fontSize: 8,
    letterSpacing: 2,
    color: COLORS.white,
    opacity: 0.85,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  poweredBy: {
    fontSize: 7,
    color: COLORS.white,
    opacity: 0.7,
    marginTop: 2,
  },
  docTitle: {
    fontSize: 8,
    letterSpacing: 1,
    color: COLORS.white,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    textTransform: 'uppercase',
  },
  /* Thin hairline rule directly under the band. */
  accentRule: {
    height: 1,
    backgroundColor: COLORS.hairline,
  },

  body: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    flexGrow: 1,
  },

  /* Invoice meta row: reference (invoice no.) + issue date. */
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  metaBlock: {
    flexDirection: 'column',
  },
  metaBlockRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  metaLabel: {
    fontSize: 7.5,
    letterSpacing: 1.2,
    color: COLORS.faint,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  metaValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.primaryDeep,
    letterSpacing: 0.5,
  },
  metaValueSm: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
  },

  /* Billed-to client block. */
  billedTo: {
    marginBottom: 18,
  },
  billedName: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
    marginBottom: 2,
  },
  billedLine: {
    fontSize: 9.5,
    color: COLORS.muted,
  },

  /* Itemized table — flat on the ivory surface, hairline top & bottom. */
  table: {
    marginBottom: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.hairline,
  },
  thead: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  th: {
    fontSize: 7.5,
    letterSpacing: 1,
    color: COLORS.bandText,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
  },
  trow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  colService: { width: '46%' },
  colWhen: { width: '32%' },
  colAmount: { width: '22%', textAlign: 'right' },
  cellStrong: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
  },
  cellText: {
    fontSize: 9.5,
    color: COLORS.text,
  },
  cellMuted: {
    fontSize: 8.5,
    color: COLORS.muted,
    marginTop: 1,
  },

  /* Totals block. */
  totals: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 20,
  },
  totalsInner: {
    width: '100%',
  },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalLabel: {
    fontSize: 9.5,
    color: COLORS.muted,
  },
  totalValue: {
    fontSize: 9.5,
    color: COLORS.text,
    fontFamily: 'Helvetica-Bold',
  },
  grandLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  grandLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
  },
  grandValue: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.primaryDeep,
  },
  statusPill: {
    alignSelf: 'flex-end',
    marginTop: 8,
    backgroundColor: COLORS.badgeBg,
    color: COLORS.badgeText,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    letterSpacing: 0.5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  balanceNote: {
    fontSize: 8.5,
    color: COLORS.muted,
    textAlign: 'right',
    marginTop: 4,
  },

  txn: {
    fontSize: 7.5,
    color: COLORS.faint,
    marginBottom: 6,
  },

  /* Footer. */
  footer: {
    marginTop: 'auto',
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
    paddingTop: 12,
  },
  footerNote: {
    fontSize: 9.5,
    color: COLORS.text,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 3,
  },
  footerThanks: {
    fontSize: 9,
    color: COLORS.muted,
    marginBottom: 2,
  },
  footerMuted: {
    fontSize: 7.5,
    color: COLORS.faint,
  },
});

/** The data the receipt renders. All dates are ISO strings or Date. */
export interface ReceiptData {
  businessName: string;
  logoUrl?: string;
  bookingRef: string;
  petName: string;
  serviceName: string;
  serviceAddress: string;
  clientName: string;
  /** Appointment start (ISO string or Date). */
  scheduledDate?: string | Date | null;
  depositAmount: number;
  currency: string;
  paymentIntentId?: string;
  /** When the booking was made (defaults to now at render time). */
  bookedOn?: string | Date;
  /**
   * Optional full service price. When provided and greater than the deposit,
   * the invoice shows a "balance due on the day" line. Additive only — callers
   * that omit it keep the deposit-only behaviour.
   */
  servicePrice?: number | null;
}

/** Parse a possibly-serialized date, returning null when invalid/missing. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Human-readable date, e.g. "Monday, June 3, 2025". */
function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Compact date, e.g. "Jun 3, 2025". */
function formatDateShort(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Human-readable time, e.g. "10:00 AM". */
function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format a monetary amount, e.g. "$50.00". */
function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export interface ReceiptPDFProps {
  data: ReceiptData;
}

/** The narrow receipt-slip premium booking receipt / invoice. */
export function ReceiptPDF({ data }: ReceiptPDFProps) {
  const business = data.businessName || 'Pet Grooming';
  const dateStr = formatDate(data.scheduledDate);
  const timeStr = formatTime(data.scheduledDate);
  const whenShort = formatDateShort(data.scheduledDate);
  const issued = formatDateShort(data.bookedOn ?? new Date());
  const currency = (data.currency || 'usd').toUpperCase();

  const deposit = Number.isFinite(data.depositAmount) ? data.depositAmount : 0;
  const price =
    typeof data.servicePrice === 'number' && Number.isFinite(data.servicePrice)
      ? data.servicePrice
      : null;
  const balance = price !== null && price > deposit ? price - deposit : 0;

  const serviceLabel = data.serviceName || 'Grooming service';
  const petSuffix = data.petName ? ` — ${data.petName}` : '';

  return (
    <Document
      title={`Invoice ${data.bookingRef}`}
      author={business}
      subject="Booking Receipt / Invoice"
    >
      <Page size={[226.77, 600]} style={styles.page}>
        {/* Header band + branding + document title */}
        <View style={styles.band}>
          <View style={styles.brand}>
            {data.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.logoUrl} style={styles.logo} />
            ) : null}
            <View>
              <Text style={styles.businessName}>{business}</Text>
              <Text style={styles.bandTag}>Pet Grooming</Text>
              <Text style={styles.poweredBy}>Powered by Pawxis</Text>
            </View>
          </View>
          <Text style={styles.docTitle}>Booking Receipt{'\n'}/ Invoice</Text>
        </View>
        <View style={styles.accentRule} />

        <View style={styles.body}>
          {/* Invoice meta: reference (invoice no.) + issue date */}
          <View style={styles.metaRow}>
            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Invoice No.</Text>
              <Text style={styles.metaValue}>{data.bookingRef || '—'}</Text>
            </View>
            <View style={styles.metaBlockRight}>
              <Text style={styles.metaLabel}>Issue Date</Text>
              <Text style={styles.metaValueSm}>{issued || '—'}</Text>
            </View>
          </View>

          {/* Billed to */}
          <View style={styles.billedTo}>
            <Text style={styles.metaLabel}>Billed To</Text>
            <Text style={styles.billedName}>{data.clientName || '—'}</Text>
            {data.serviceAddress ? (
              <Text style={styles.billedLine}>{data.serviceAddress}</Text>
            ) : null}
          </View>

          {/* Itemized table */}
          <View style={styles.table}>
            <View style={styles.thead}>
              <Text style={[styles.th, styles.colService]}>Service</Text>
              <Text style={[styles.th, styles.colWhen]}>Date &amp; Time</Text>
              <Text style={[styles.th, styles.colAmount]}>Amount</Text>
            </View>

            <View style={styles.trow}>
              <View style={styles.colService}>
                <Text style={styles.cellStrong}>
                  {serviceLabel}
                  {petSuffix}
                </Text>
                <Text style={styles.cellMuted}>Deposit to secure booking</Text>
              </View>
              <View style={styles.colWhen}>
                <Text style={styles.cellText}>{whenShort || 'See email'}</Text>
                {timeStr ? (
                  <Text style={styles.cellMuted}>{timeStr}</Text>
                ) : null}
              </View>
              <View style={styles.colAmount}>
                <Text style={styles.cellStrong}>
                  {formatCurrency(deposit, currency)}
                </Text>
              </View>
            </View>
          </View>

          {/* Totals */}
          <View style={styles.totals}>
            <View style={styles.totalsInner}>
              {price !== null ? (
                <View style={styles.totalLine}>
                  <Text style={styles.totalLabel}>Service total</Text>
                  <Text style={styles.totalValue}>
                    {formatCurrency(price, currency)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Deposit paid</Text>
                <Text style={styles.totalValue}>
                  {formatCurrency(deposit, currency)}
                </Text>
              </View>
              <View style={styles.grandLine}>
                <Text style={styles.grandLabel}>Paid today</Text>
                <Text style={styles.grandValue}>
                  {formatCurrency(deposit, currency)}
                </Text>
              </View>
              <Text style={styles.statusPill}>DEPOSIT RECEIVED</Text>
              {balance > 0 ? (
                <Text style={styles.balanceNote}>
                  Balance due on the day: {formatCurrency(balance, currency)}
                </Text>
              ) : null}
            </View>
          </View>

          {data.paymentIntentId ? (
            <Text style={styles.txn}>Payment ID: {data.paymentIntentId}</Text>
          ) : null}

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerNote}>
              Present this reference when your groomer arrives.
            </Text>
            <Text style={styles.footerThanks}>
              Thank you for booking with {business}.
            </Text>
            {dateStr ? (
              <Text style={styles.footerMuted}>Appointment: {dateStr}</Text>
            ) : null}
          </View>
        </View>
      </Page>
    </Document>
  );
}

export default ReceiptPDF;
