/**
 * Appointment status state machine (PURE).
 *
 * This module is the single source of truth for which appointment status
 * transitions are legal. It contains NO I/O, NO database access, and NO
 * side effects — it is a pure function over the {@link AppointmentStatus}
 * union so it can be exhaustively exercised by the Property 5 test
 * (see task 10.2) without any mocks or environment setup.
 *
 * Valid transitions (design "Appointment Status Transitions"):
 *   upcoming    -> in-progress | cancelled
 *   in-progress -> completed   | cancelled
 *   completed   -> (terminal)
 *   cancelled   -> (terminal)
 *
 * _Requirements: 12.1_
 */
import type { AppointmentStatus } from '@/types';

/**
 * The complete transition table. Every {@link AppointmentStatus} has an entry
 * (terminal states map to an empty list) so lookups never fall through to
 * `undefined`. This is exported so tests can assert against it directly.
 */
export const VALID_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  upcoming: ['in-progress', 'cancelled'],
  'in-progress': ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/**
 * Whether an appointment may move from `from` to `to`.
 *
 * Pure and total: returns `true` only when `to` is listed among the allowed
 * next states for `from`. A no-op transition (`from === to`) is NOT considered
 * valid — it is not a listed transition — and every terminal state ('completed',
 * 'cancelled') returns `false` for any target.
 */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus
): boolean {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}
