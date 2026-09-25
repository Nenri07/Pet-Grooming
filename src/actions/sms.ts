'use server';

/**
 * SMS Inbox server actions (Master Spec §12, §8 Inbox).
 *
 * - {@link loadInboxThreads} groups a groomer's {@link SmsMessage} rows by
 *   client into threads for the Inbox, newest activity first, with unread
 *   counts.
 * - {@link loadThreadMessages} returns the full conversation for one thread.
 * - {@link sendReply} sends a freeform groomer reply to a client via
 *   {@link sendSms} (kind `reply`, transactional so it is never quota-blocked
 *   short of exhaustion), marking inbound messages read.
 * - {@link sendTemplateMessage} sends a quick-action templated message.
 *
 * Every query is scoped to `groomerId: session.user.id`. Actions return typed
 * envelopes and never throw.
 *
 * _Master Spec: §12_
 */
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { SMS_KINDS, type SmsKind } from '@/lib/sms/provider';

/** One inbox thread: a client (or unknown lead) with its latest message. */
export interface InboxThread {
  /** Client id, or null for an unknown-number lead. */
  clientId: string | null;
  /** Display name (client name or the raw phone for a lead). */
  name: string;
  phone: string;
  lastMessage: string;
  lastAt: string;
  lastDirection: 'in' | 'out';
  unread: number;
}

/** One message row in a thread. */
export interface ThreadMessage {
  id: string;
  direction: 'in' | 'out';
  kind: SmsKind;
  body: string;
  status: string;
  createdAt: string;
}

export type LoadInboxResult =
  | { ok: true; threads: InboxThread[] }
  | { ok: false; error: string };

export type LoadThreadResult =
  | { ok: true; messages: ThreadMessage[] }
  | { ok: false; error: string };

export type SendReplyResult = { ok: true } | { ok: false; error: string };

/**
 * Load the authed groomer's SMS threads grouped by client, newest activity
 * first, each with an unread inbound count. Unknown-number leads (no clientId)
 * are grouped by phone.
 */
export async function loadInboxThreads(): Promise<LoadInboxResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to view the inbox.' };
  }

  try {
    await connectDB();
    const { SmsMessage } = await import('@/lib/db/models/sms-message');
    const { Client } = await import('@/lib/db/models/client');

    const groomerId = session.user.id;
    const docs = await SmsMessage.find({ groomerId })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    // Group by clientId (or phone for leads).
    const threadMap = new Map<string, InboxThread>();
    const clientIds = new Set<string>();

    for (const d of docs as unknown as Array<{
      clientId?: unknown;
      phone?: string;
      body: string;
      direction: 'in' | 'out';
      read?: boolean;
      createdAt: Date;
    }>) {
      const cid = d.clientId ? String(d.clientId) : null;
      const key = cid ?? `phone:${d.phone ?? 'unknown'}`;
      if (cid) clientIds.add(cid);

      let thread = threadMap.get(key);
      if (!thread) {
        thread = {
          clientId: cid,
          name: d.phone ?? 'Unknown',
          phone: d.phone ?? '',
          lastMessage: d.body,
          lastAt: new Date(d.createdAt).toISOString(),
          lastDirection: d.direction,
          unread: 0,
        };
        threadMap.set(key, thread);
      }
      // Count unread inbound.
      if (d.direction === 'in' && !d.read) thread.unread += 1;
    }

    // Resolve client display names.
    if (clientIds.size) {
      const clients = await Client.find({ _id: { $in: Array.from(clientIds) }, groomerId })
        .select('name phone')
        .lean();
      const byId = new Map(
        (clients as unknown as Array<{ _id: unknown; name: string; phone: string }>).map((c) => [
          String(c._id),
          c,
        ])
      );
      for (const thread of threadMap.values()) {
        if (thread.clientId) {
          const c = byId.get(thread.clientId);
          if (c) {
            thread.name = c.name;
            if (!thread.phone) thread.phone = c.phone;
          }
        }
      }
    }

    const threads = Array.from(threadMap.values()).sort(
      (a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)
    );

    return { ok: true, threads };
  } catch (error) {
    console.error('loadInboxThreads failed:', error);
    return { ok: false, error: "We couldn't load your inbox right now." };
  }
}

const threadSchema = z.object({ clientId: z.string().min(1) });

/**
 * Load the full conversation for one client thread (oldest first), and mark its
 * inbound messages as read.
 */
export async function loadThreadMessages(input: { clientId: string }): Promise<LoadThreadResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to view messages.' };
  }
  const parsed = threadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid thread.' };

  try {
    await connectDB();
    const { SmsMessage } = await import('@/lib/db/models/sms-message');
    const groomerId = session.user.id;

    const docs = await SmsMessage.find({ groomerId, clientId: parsed.data.clientId })
      .sort({ createdAt: 1 })
      .lean();

    // Mark inbound as read (best-effort).
    await SmsMessage.updateMany(
      { groomerId, clientId: parsed.data.clientId, direction: 'in', read: { $ne: true } },
      { $set: { read: true } }
    ).catch(() => {});

    const messages: ThreadMessage[] = (
      docs as unknown as Array<{
        _id: unknown;
        direction: 'in' | 'out';
        kind: SmsKind;
        body: string;
        status: string;
        createdAt: Date;
      }>
    ).map((m) => ({
      id: String(m._id),
      direction: m.direction,
      kind: m.kind,
      body: m.body,
      status: m.status,
      createdAt: new Date(m.createdAt).toISOString(),
    }));

    return { ok: true, messages };
  } catch (error) {
    console.error('loadThreadMessages failed:', error);
    return { ok: false, error: "We couldn't load this conversation right now." };
  }
}

const replySchema = z.object({
  clientId: z.string().min(1),
  body: z.string().trim().min(1).max(1000),
});

/**
 * Send a freeform reply to a client (kind `reply`, transactional). Resolves the
 * client's phone, sends via {@link sendSms}, and reports the outcome. Never
 * throws.
 */
export async function sendReply(input: { clientId: string; body: string }): Promise<SendReplyResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to reply.' };
  }
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter a message to send.' };

  try {
    await connectDB();
    const { Client } = await import('@/lib/db/models/client');
    const groomerId = session.user.id;

    const client = await Client.findOne({ _id: parsed.data.clientId, groomerId })
      .select('phone')
      .lean();
    const phone = (client as { phone?: string } | null)?.phone;
    if (!phone) return { ok: false, error: 'This client has no phone number on file.' };

    const { sendSms } = await import('@/lib/sms/send-sms');
    const result = await sendSms({
      groomerId,
      clientId: parsed.data.clientId,
      to: phone,
      kind: 'reply',
      bodyOverride: parsed.data.body,
    });

    if (result.ok) return { ok: true };

    // Map a blocked/failed outcome to a friendly message.
    const reason =
      result.outcome === 'blocked_consent'
        ? 'This client has opted out of texts.'
        : result.outcome === 'skipped_no_provider'
          ? 'SMS is not configured, so the message was logged but not sent.'
          : "We couldn't send that message right now.";
    // skipped_no_provider still logs the message, treat as soft-success so the
    // UI shows it in the thread.
    if (result.outcome === 'skipped_no_provider') return { ok: true };
    return { ok: false, error: reason };
  } catch (error) {
    console.error('sendReply failed:', error);
    return { ok: false, error: "We couldn't send that message right now." };
  }
}

const templateSchema = z.object({
  clientId: z.string().min(1),
  kind: z.enum(SMS_KINDS as unknown as [SmsKind, ...SmsKind[]]),
});

/**
 * Send a quick-action templated message to a client (e.g. on_my_way,
 * rebook_nudge). Resolves the client's phone + a recent pet name for the
 * template vars, then dispatches via {@link sendSms}. Never throws.
 */
export async function sendTemplateMessage(input: {
  clientId: string;
  kind: SmsKind;
}): Promise<SendReplyResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to send a message.' };
  }
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid template.' };

  try {
    await connectDB();
    const { Client } = await import('@/lib/db/models/client');
    const { Pet } = await import('@/lib/db/models/pet');
    const groomerId = session.user.id;

    const client = await Client.findOne({ _id: parsed.data.clientId, groomerId })
      .select('phone')
      .lean();
    const phone = (client as { phone?: string } | null)?.phone;
    if (!phone) return { ok: false, error: 'This client has no phone number on file.' };

    const pet = await Pet.findOne({ groomerId, clientId: parsed.data.clientId })
      .select('name')
      .lean();
    const petName = (pet as { name?: string } | null)?.name ?? 'your pet';

    const { sendSms } = await import('@/lib/sms/send-sms');
    const result = await sendSms({
      groomerId,
      clientId: parsed.data.clientId,
      to: phone,
      kind: parsed.data.kind,
      vars: { pet: petName },
    });

    if (result.ok) return { ok: true };
    return { ok: false, error: "We couldn't send that message right now." };
  } catch (error) {
    console.error('sendTemplateMessage failed:', error);
    return { ok: false, error: "We couldn't send that message right now." };
  }
}
