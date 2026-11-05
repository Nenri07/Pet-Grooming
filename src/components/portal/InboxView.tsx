'use client';

/**
 * InboxView — two-way SMS inbox (Master Spec §12, §8).
 *
 * Client component rendered by the Inbox page with the groomer's threads
 * server-loaded. Layout: a thread list (with unread badges) on the left and a
 * conversation pane on the right with a reply box and "Send a template" quick
 * actions.
 *
 * When Twilio is unconfigured (`smsConfigured=false`) automatic texting is
 * off, but the groomer can still message: quick actions fill the box, and the
 * message goes out through WhatsApp or their phone's texting app (opened on
 * their device) or by email. Every message is logged in the thread.
 *
 * _Master Spec: §12_
 */
import * as React from 'react';
import { Mail, MessageCircle, MessageSquare, Send, Smartphone } from 'lucide-react';
import type { InboxThread, ThreadMessage } from '@/actions/sms';
import type { SmsKind } from '@/lib/sms/provider';
import {
  composeClientMessage,
  loadThreadMessages,
  sendManualMessage,
  sendReply,
  sendTemplateMessage,
} from '@/actions/sms';

/** wa.me link with a prefilled message (digits only, country code kept). */
function whatsappUrl(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

/** Opens the phone's own texting app with the message filled in. */
function smsAppUrl(phone: string, text: string): string {
  return `sms:${phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(text)}`;
}

/** Quick-action templates surfaced in the thread pane. */
const QUICK_ACTIONS: { kind: SmsKind; label: string }[] = [
  { kind: 'on_my_way', label: 'On my way' },
  { kind: 'running_late', label: 'Running late' },
  { kind: 'rebook_nudge', label: 'Rebook nudge' },
  { kind: 'review_request', label: 'Review request' },
];

interface InboxViewProps {
  threads: InboxThread[];
  smsConfigured: boolean;
}

export function InboxView({ threads, smsConfigured }: InboxViewProps) {
  const [activeClientId, setActiveClientId] = React.useState<string | null>(
    threads.find((t) => t.clientId)?.clientId ?? null
  );
  const [messages, setMessages] = React.useState<ThreadMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [reply, setReply] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [contact, setContact] = React.useState<{ phone: string | null; email: string | null }>({
    phone: null,
    email: null,
  });

  const activeThread = threads.find((t) => t.clientId === activeClientId) ?? null;

  const openThread = React.useCallback(async (clientId: string) => {
    setActiveClientId(clientId);
    setMessages([]);
    setNotice(null);
    setLoading(true);
    const [res, info] = await Promise.all([
      loadThreadMessages({ clientId }),
      composeClientMessage({ clientId }),
    ]);
    setLoading(false);
    if (res.ok) setMessages(res.messages);
    else setNotice(res.error);
    if (info.ok) setContact({ phone: info.phone, email: info.email });
  }, []);

  // Load the initially-selected thread once on mount.
  React.useEffect(() => {
    if (activeClientId) void openThread(activeClientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSend() {
    if (!activeClientId || !reply.trim()) return;
    setSending(true);
    setNotice(null);
    const res = await sendReply({ clientId: activeClientId, body: reply.trim() });
    setSending(false);
    if (res.ok) {
      setReply('');
      await openThread(activeClientId);
    } else {
      setNotice(res.error);
    }
  }

  async function handleTemplate(kind: SmsKind) {
    if (!activeClientId) return;
    // Without Twilio, quick actions fill the message box so the groomer can
    // send it through WhatsApp, their phone, or email.
    if (!smsConfigured) {
      setNotice(null);
      const res = await composeClientMessage({ clientId: activeClientId, kind });
      if (res.ok) setReply(res.text);
      else setNotice(res.error);
      return;
    }
    setSending(true);
    setNotice(null);
    const res = await sendTemplateMessage({ clientId: activeClientId, kind });
    setSending(false);
    if (res.ok) await openThread(activeClientId);
    else setNotice(res.error);
  }

  /** WhatsApp / phone app: open on this device, then log it in the thread. */
  async function sendVia(channel: 'whatsapp' | 'sms_app' | 'email') {
    if (!activeClientId || !reply.trim()) return;
    const text = reply.trim();
    if (channel !== 'email') {
      const phone = contact.phone ?? activeThread?.phone ?? '';
      const url = channel === 'whatsapp' ? whatsappUrl(phone, text) : smsAppUrl(phone, text);
      if (!phone || !url) {
        setNotice('This client has no phone number on file.');
        return;
      }
      window.open(url, channel === 'whatsapp' ? '_blank' : '_self', 'noopener');
    }
    setSending(true);
    setNotice(null);
    const res = await sendManualMessage({ clientId: activeClientId, body: text, channel });
    setSending(false);
    if (res.ok) {
      setReply('');
      await openThread(activeClientId);
    } else {
      setNotice(res.error);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
      {/* Thread list */}
      <aside className="rounded-2xl bg-base-100 shadow-card">
        <div className="border-b border-base-content/10 px-4 py-3">
          <h2 className="font-display text-lg font-semibold text-base-content">Threads</h2>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto">
          {threads.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-base-content/60">
              No conversations yet.
            </li>
          )}
          {threads.map((t) => {
            const key = t.clientId ?? `phone:${t.phone}`;
            const isActive = t.clientId === activeClientId;
            const selectable = Boolean(t.clientId);
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={!selectable}
                  onClick={() => t.clientId && openThread(t.clientId)}
                  className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors ${
                    isActive ? 'bg-base-200' : 'hover:bg-base-200/60'
                  } ${selectable ? '' : 'cursor-default opacity-70'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-base-content">{t.name}</span>
                    <span className="block truncate text-sm text-base-content/60">
                      {t.lastDirection === 'out' ? 'You: ' : ''}
                      {t.lastMessage}
                    </span>
                  </span>
                  {t.unread > 0 && (
                    <span className="badge badge-primary badge-sm shrink-0">{t.unread}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Conversation pane */}
      <section className="flex min-h-[60vh] flex-col rounded-2xl bg-base-100 shadow-card">
        {activeThread ? (
          <>
            <header className="border-b border-base-content/10 px-4 py-3">
              <h3 className="font-medium text-base-content">{activeThread.name}</h3>
              {activeThread.phone && (
                <p className="text-sm text-base-content/60">{activeThread.phone}</p>
              )}
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {loading && (
                <p className="text-center text-sm text-base-content/50">Loading…</p>
              )}
              {!loading && messages.length === 0 && (
                <p className="text-center text-sm text-base-content/50">No messages yet.</p>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      m.direction === 'out'
                        ? 'bg-primary text-primary-content'
                        : 'bg-base-200 text-base-content'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p
                      className={`mt-1 text-[11px] ${
                        m.direction === 'out' ? 'text-primary-content/70' : 'text-base-content/50'
                      }`}
                    >
                      {new Date(m.createdAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {m.direction === 'out' && m.status
                        ? ` · ${m.status === 'skipped' ? 'not texted (Twilio off)' : m.status}`
                        : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {notice && (
              <div className="mx-4 mb-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-content">
                {notice}
              </div>
            )}

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 border-t border-base-content/10 px-4 py-2">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.kind}
                  type="button"
                  disabled={sending}
                  onClick={() => handleTemplate(a.kind)}
                  className="btn btn-ghost btn-xs min-h-[32px]"
                >
                  {a.label}
                </button>
              ))}
            </div>

            {/* Reply box */}
            <div className="flex items-end gap-2 border-t border-base-content/10 p-3">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                disabled={sending}
                rows={2}
                placeholder={smsConfigured ? 'Type a reply…' : 'Type a message, then pick how to send it…'}
                className="textarea textarea-bordered flex-1 resize-none"
              />
              {smsConfigured && (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !reply.trim()}
                  className="btn btn-primary min-h-[44px]"
                  aria-label="Send text message"
                >
                  {sending ? (
                    <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 px-3 pb-3">
              <button
                type="button"
                onClick={() => sendVia('whatsapp')}
                disabled={sending || !reply.trim()}
                className="btn btn-success btn-sm min-h-[40px]"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                WhatsApp
              </button>
              <button
                type="button"
                onClick={() => sendVia('sms_app')}
                disabled={sending || !reply.trim()}
                className="btn btn-outline btn-sm min-h-[40px]"
              >
                <Smartphone className="h-4 w-4" aria-hidden="true" />
                Text from my phone
              </button>
              <button
                type="button"
                onClick={() => sendVia('email')}
                disabled={sending || !reply.trim() || !contact.email}
                className="btn btn-outline btn-sm min-h-[40px]"
                title={contact.email ? undefined : 'No email on file'}
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Email
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-base-content/60">
            <MessageSquare className="h-10 w-10" aria-hidden="true" />
            <p>Select a conversation to view messages.</p>
          </div>
        )}
      </section>
    </div>
  );
}

export default InboxView;
