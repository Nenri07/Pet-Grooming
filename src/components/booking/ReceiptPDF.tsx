/**
 * ReceiptPDF — the A5 booking confirmation / receipt slip.
 *
 * Rendered client-side by @react-pdf/renderer when the visitor taps
 * "Download receipt (PDF)" on the booking success step. It mirrors the
 * on-screen confirmation ticket: groomer branding, a prominently-boxed booking
 * REFERENCE number, the appointment date + time, pet + service, service
 * address, client name, the deposit paid (with a "Deposit received" status),
 * the payment/transaction id, and a footer note.
 *
 * Like PetCardPDF this module is intentionally free of DaisyUI / Tailwind —
 * @react-pdf uses its own StyleSheet and cannot read CSS variables, so the
 * literal colors below approximate the theme's primary/accent. It is
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

/** Soft palette approximating the DaisyUI pawport theme (primary/accent). */
const COLORS = {
  primary: '#5B9BD5',
  primaryDark: '#3E7CB1',
  accent: '#7EC8C8',
  text: '#1F2937',
  muted: '#6B7280',
  border: '#E5E7EB',
  surface: '#F9FAFB',
  band: '#EAF3FB',
  success: '#15803D',
  successBg: '#DCFCE7',
  white: '#FFFFFF',
};

const styles = StyleSheet.create({
  page: {
    padding: 0,
    fontSize: 11,
    color: COLORS.text,
    fontFamily: 'Helvetica',
    lineHeight: 1.5,
  },
  // Accent band across the top.
  band: {
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 8,
    marginRight: 10,
    objectFit: 'cover',
  },
  businessName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.white,
  },
  bandSubtitle: {
    fontSize: 10,
    color: COLORS.white,
    opacity: 0.9,
    marginTop: 1,
  },
  body: {
    padding: 28,
  },
  // Prominent reference box.
  refBox: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 12,
    backgroundColor: COLORS.band,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 18,
    alignItems: 'center',
  },
  refLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
    color: COLORS.primaryDark,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  refValue: {
    fontSize: 30,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.primaryDark,
    letterSpacing: 2,
  },
  detailGrid: {
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    padding: 14,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 7,
  },
  rowLast: {
    flexDirection: 'row',
  },
  label: {
    width: 110,
    color: COLORS.muted,
    fontSize: 10,
  },
  value: {
    flex: 1,
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  depositRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14,
  },
  depositAmount: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.text,
  },
  depositLabel: {
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 1,
  },
  statusPill: {
    backgroundColor: COLORS.successBg,
    color: COLORS.success,
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  txn: {
    fontSize: 8,
    color: COLORS.muted,
    marginBottom: 16,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  footerNote: {
    fontSize: 10,
    color: COLORS.text,
    marginBottom: 3,
  },
  footerMuted: {
    fontSize: 8,
    color: COLORS.muted,
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

/** The A5 booking confirmation / receipt slip. */
export function ReceiptPDF({ data }: ReceiptPDFProps) {
  const business = data.businessName || 'Pet Grooming';
  const dateStr = formatDate(data.scheduledDate);
  const timeStr = formatTime(data.scheduledDate);
  const bookedOn = formatDate(data.bookedOn ?? new Date());

  return (
    <Document
      title={`Booking ${data.bookingRef}`}
      author={business}
      subject="Booking Confirmation"
    >
      <Page size="A5" style={styles.page}>
        {/* Accent band + branding */}
        <View style={styles.band}>
          {data.logoUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={data.logoUrl} style={styles.logo} />
          ) : null}
          <View>
            <Text style={styles.businessName}>{business}</Text>
            <Text style={styles.bandSubtitle}>Booking Confirmation</Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* Prominent, boxed reference number */}
          <View style={styles.refBox}>
            <Text style={styles.refLabel}>Booking Reference</Text>
            <Text style={styles.refValue}>{data.bookingRef || '—'}</Text>
          </View>

          {/* Appointment + booking details */}
          <View style={styles.detailGrid}>
            {dateStr ? (
              <View style={styles.row}>
                <Text style={styles.label}>Date</Text>
                <Text style={styles.value}>{dateStr}</Text>
              </View>
            ) : null}
            {timeStr ? (
              <View style={styles.row}>
                <Text style={styles.label}>Time</Text>
                <Text style={styles.value}>{timeStr}</Text>
              </View>
            ) : null}
            <View style={styles.row}>
              <Text style={styles.label}>Pet</Text>
              <Text style={styles.value}>{data.petName || '—'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Service</Text>
              <Text style={styles.value}>{data.serviceName || '—'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Client</Text>
              <Text style={styles.value}>{data.clientName || '—'}</Text>
            </View>
            <View style={styles.rowLast}>
              <Text style={styles.label}>Address</Text>
              <Text style={styles.value}>{data.serviceAddress || '—'}</Text>
            </View>
          </View>

          {/* Deposit paid + status */}
          <View style={styles.depositRow}>
            <View>
              <Text style={styles.depositAmount}>
                {formatCurrency(data.depositAmount, data.currency)}
              </Text>
              <Text style={styles.depositLabel}>
                Deposit paid ({data.currency.toUpperCase()})
              </Text>
            </View>
            <Text style={styles.statusPill}>DEPOSIT RECEIVED</Text>
          </View>

          {data.paymentIntentId ? (
            <Text style={styles.txn}>Payment ID: {data.paymentIntentId}</Text>
          ) : null}

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerNote}>
              Present this reference when your groomer arrives.
            </Text>
            {bookedOn ? (
              <Text style={styles.footerMuted}>Booked on {bookedOn}</Text>
            ) : null}
          </View>
        </View>
      </Page>
    </Document>
  );
}

export default ReceiptPDF;
