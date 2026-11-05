/**
 * Revenue = money the groomer actually earned in a period:
 *   - every COMPLETED appointment counts its total charged (deposit included;
 *     falls back to the service price for jobs completed before this field),
 *     dated by the appointment;
 *   - deposits kept on appointments that were NOT completed (cancelled or
 *     no-show) count on their own: card deposits by payment date, pay-by-link
 *     deposits marked received by appointment date.
 * A completed job's deposit is never counted twice.
 *
 * Returns items shaped for the pure metrics module (`DatedTransaction`).
 * Server-only.
 */
import type { Types } from 'mongoose';
import { Appointment } from '@/lib/db/models/appointment';
import { Transaction } from '@/lib/db/models/transaction';
import type { DatedTransaction } from '@/lib/analytics/metrics';

export async function loadRevenueItems(
  groomerId: string | Types.ObjectId,
  start: Date,
  end: Date
): Promise<DatedTransaction[]> {
  const [completed, txns, linkDeposits] = await Promise.all([
    Appointment.find({ groomerId, status: 'completed', scheduledDate: { $gte: start, $lte: end } })
      .select('scheduledDate amountCharged serviceId')
      .populate('serviceId', 'basePrice')
      .lean<Array<{ scheduledDate: Date; amountCharged?: number; serviceId?: { basePrice?: number } | null }>>(),
    Transaction.find({ groomerId, status: 'succeeded', createdAt: { $gte: start, $lte: end } })
      .select('amount createdAt appointmentId')
      .lean<Array<{ amount: number; createdAt: Date; appointmentId?: unknown }>>(),
    Appointment.find({
      groomerId,
      status: { $ne: 'completed' },
      depositStatus: 'received',
      scheduledDate: { $gte: start, $lte: end },
    })
      .select('scheduledDate depositDue')
      .lean<Array<{ scheduledDate: Date; depositDue?: number }>>(),
  ]);

  // Deposits whose appointment was completed are already inside amountCharged.
  const txnApptIds = txns.map((t) => t.appointmentId).filter(Boolean);
  const completedIds = new Set(
    txnApptIds.length
      ? (
          await Appointment.find({ _id: { $in: txnApptIds }, status: 'completed' })
            .select('_id')
            .lean<Array<{ _id: unknown }>>()
        ).map((a) => String(a._id))
      : []
  );

  const items: DatedTransaction[] = [];
  for (const a of completed) {
    const amount =
      typeof a.amountCharged === 'number'
        ? a.amountCharged
        : typeof a.serviceId?.basePrice === 'number'
          ? a.serviceId.basePrice
          : 0;
    if (amount > 0) items.push({ amount, status: 'succeeded', createdAt: new Date(a.scheduledDate) });
  }
  for (const t of txns) {
    if (t.appointmentId && completedIds.has(String(t.appointmentId))) continue;
    items.push({ amount: t.amount, status: 'succeeded', createdAt: new Date(t.createdAt) });
  }
  for (const d of linkDeposits) {
    if (typeof d.depositDue === 'number' && d.depositDue > 0) {
      items.push({ amount: d.depositDue, status: 'succeeded', createdAt: new Date(d.scheduledDate) });
    }
  }
  return items;
}
