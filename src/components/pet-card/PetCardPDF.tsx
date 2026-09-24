/**
 * PetCardPDF — the A5 PDF document for a Digital Pet Card.
 *
 * Rendered client-side by @react-pdf/renderer when the visitor clicks
 * "Download as PDF" on the public pet-card page (Requirement 17.4). It mirrors
 * the on-screen card: groomer branding, the pet's core details, up to the 5
 * most recent completed services (or a "No services recorded yet" note when
 * empty — Requirement 17.6), and the next recommended grooming date.
 *
 * This module is intentionally free of DaisyUI / Tailwind: @react-pdf uses its
 * own StyleSheet. It is lazy-loaded by the renderer so the PDF engine never
 * ships in the initial/SSR bundle.
 *
 * _Requirements: 17.4, 17.6_
 */
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from '@react-pdf/renderer';
import type { PetCardData } from '@/types';

/** Soft-blue / warm-neutral palette approximating the DaisyUI pawport theme. */
const COLORS = {
  primary: '#5B9BD5',
  accent: '#7EC8C8',
  text: '#1F2937',
  muted: '#6B7280',
  border: '#E5E7EB',
  surface: '#F9FAFB',
};

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 11,
    color: COLORS.text,
    fontFamily: 'Helvetica',
    lineHeight: 1.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 10,
    objectFit: 'cover',
  },
  businessName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.primary,
  },
  contact: {
    fontSize: 9,
    color: COLORS.muted,
  },
  petSection: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  petPhoto: {
    width: 90,
    height: 90,
    borderRadius: 12,
    marginRight: 14,
    objectFit: 'cover',
  },
  petPhotoPlaceholder: {
    width: 90,
    height: 90,
    borderRadius: 12,
    marginRight: 14,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 28,
    color: COLORS.muted,
  },
  petName: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  petMeta: {
    fontSize: 11,
    color: COLORS.muted,
    marginBottom: 6,
  },
  detailRow: {
    marginBottom: 2,
  },
  label: {
    fontFamily: 'Helvetica-Bold',
  },
  flagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  flag: {
    fontSize: 9,
    backgroundColor: COLORS.surface,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginRight: 4,
    marginBottom: 4,
    color: COLORS.text,
  },
  section: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
    color: COLORS.primary,
  },
  historyEntry: {
    marginBottom: 6,
  },
  historyDate: {
    fontFamily: 'Helvetica-Bold',
  },
  historyNotes: {
    fontSize: 9,
    color: COLORS.muted,
  },
  emptyHistory: {
    fontSize: 10,
    color: COLORS.muted,
    fontStyle: 'italic',
  },
  nextDate: {
    marginTop: 12,
    padding: 8,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    fontSize: 11,
  },
});

/** Format a date as e.g. "Jan 5, 2025". Accepts Date or ISO string. */
function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Capitalize the first letter of an enum-like word for display. */
function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface PetCardPDFProps {
  data: PetCardData;
}

/** The A5 PDF document for a pet's Digital Pet Card. */
export function PetCardPDF({ data }: PetCardPDFProps) {
  const { branding } = data;
  const contactParts = [branding.phone, branding.businessEmail].filter(Boolean);

  return (
    <Document
      title={`${data.name}'s Pet Card`}
      author={branding.businessName || 'PawPort'}
    >
      <Page size="A5" style={styles.page}>
        {/* Groomer branding */}
        <View style={styles.header}>
          {branding.logoUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={branding.logoUrl} style={styles.logo} />
          ) : null}
          <View>
            <Text style={styles.businessName}>
              {branding.businessName || 'Pet Grooming'}
            </Text>
            {contactParts.length > 0 && (
              <Text style={styles.contact}>{contactParts.join('  •  ')}</Text>
            )}
          </View>
        </View>

        {/* Pet identity + core details */}
        <View style={styles.petSection}>
          {data.photoUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={data.photoUrl} style={styles.petPhoto} />
          ) : (
            <View style={styles.petPhotoPlaceholder}>
              <Text style={styles.placeholderText}>🐾</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.petName}>{data.name}</Text>
            <Text style={styles.petMeta}>
              {data.breed} • {data.weight} {data.weightUnit} • {data.age}{' '}
              {data.age === 1 ? 'year' : 'years'}
            </Text>
            <Text style={styles.detailRow}>
              <Text style={styles.label}>Temperament: </Text>
              {titleCase(data.temperament)}
            </Text>
            <Text style={styles.detailRow}>
              <Text style={styles.label}>Coat: </Text>
              {titleCase(data.coatCondition)}
            </Text>
            {data.notes ? (
              <Text style={styles.detailRow}>
                <Text style={styles.label}>Coat notes: </Text>
                {data.notes}
              </Text>
            ) : null}
            {data.specialFlags.length > 0 && (
              <View style={styles.flagRow}>
                {data.specialFlags.map((flag) => (
                  <Text key={flag} style={styles.flag}>
                    {flag}
                  </Text>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Service history (Requirement 17.6: omit + message when empty) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Service History</Text>
          {data.serviceHistory.length > 0 ? (
            data.serviceHistory.map((entry, i) => (
              <View key={i} style={styles.historyEntry}>
                <Text>
                  <Text style={styles.historyDate}>
                    {formatDate(entry.date)}
                  </Text>{' '}
                  — {entry.serviceName}
                </Text>
                {entry.notes ? (
                  <Text style={styles.historyNotes}>{entry.notes}</Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.emptyHistory}>No services recorded yet</Text>
          )}
        </View>

        {/* Next recommended grooming date */}
        {data.nextRecommendedDate ? (
          <Text style={styles.nextDate}>
            <Text style={styles.label}>Next recommended visit: </Text>
            {formatDate(data.nextRecommendedDate)}
          </Text>
        ) : null}
      </Page>
    </Document>
  );
}

export default PetCardPDF;
