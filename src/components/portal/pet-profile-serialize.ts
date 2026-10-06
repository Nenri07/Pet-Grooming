/**
 * Pet service-history serialization — server/client SHARED, framework-neutral.
 *
 * This lives OUTSIDE the `'use client'` PetProfile component on purpose. The
 * pet detail PAGE is a Server Component that calls `toSerializableHistory`
 * during server render. When this function lived in the `'use client'`
 * module, Next.js turned its export into a client-reference proxy on the
 * server, so calling it server-side threw `TypeError: <fn> is not a function`
 * (the masked production digest crash). Keeping it in a plain module lets BOTH
 * the server page and the client component import the real function.
 */
import type { PetServiceHistoryEntry } from '@/actions/pets';

/** JSON-safe service-history entry (date serialized to an ISO string). */
export interface SerializableServiceHistoryEntry {
  appointmentId: string;
  date: string;
  serviceName: string;
  notes?: string;
  status: string;
}

/**
 * Convert a server `PetServiceHistoryEntry` into the serializable shape.
 *
 * A missing or malformed `date` must NOT crash the render: `new Date(bad)`
 * is an Invalid Date and `.toISOString()` on it throws `RangeError: Invalid
 * time value`. We coerce defensively and emit an empty string for an invalid
 * date; the client's `formatDate` renders '' / 'Unknown date' for a
 * non-parseable value.
 */
export function toSerializableHistory(
  entries: PetServiceHistoryEntry[]
): SerializableServiceHistoryEntry[] {
  return entries.map((e) => {
    const d = e.date instanceof Date ? e.date : new Date(e.date as unknown as string);
    const date = Number.isNaN(d.getTime()) ? '' : d.toISOString();
    return {
      appointmentId: e.appointmentId,
      date,
      serviceName: e.serviceName,
      notes: e.notes,
      status: e.status,
    };
  });
}
