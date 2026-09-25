/**
 * Twilio SMS provider (Master Spec §12.1).
 *
 * Uses a Messaging Service SID (TWILIO_MESSAGING_SERVICE_SID) so Twilio handles
 * sender-pool selection, and points delivery status callbacks at
 * `/api/twilio/status`.
 *
 * Import safety: the Twilio SDK client is created LAZILY on first `send`, and
 * only ever reached through {@link getSmsProvider} once {@link isSmsConfigured}
 * is true. Importing this module does not construct a client and never throws,
 * even without credentials — so the whole app builds without Twilio.
 *
 * _Master Spec: §4.5, §12.1_
 */
import type { SmsProvider, SmsSendParams, SmsSendResult } from './provider';

// `twilio` is a CommonJS default-export factory: `twilio(sid, token) -> Client`.
// We type the bits we use rather than pulling the SDK's full types into scope.
interface TwilioMessageCreateOpts {
  to: string;
  body: string;
  messagingServiceSid: string;
  statusCallback?: string;
}
interface TwilioMessageInstance {
  sid: string;
  status: string;
}
interface TwilioClient {
  messages: {
    create(opts: TwilioMessageCreateOpts): Promise<TwilioMessageInstance>;
  };
}

/**
 * Build the absolute status-callback URL. Twilio POSTs delivery updates here;
 * the route validates the signature and updates the matching `SmsMessage`. When
 * `NEXT_PUBLIC_APP_URL` is unset we return `undefined` so Twilio simply skips
 * the callback rather than erroring.
 */
function statusCallbackUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `${base}/api/twilio/status` : undefined;
}

export class TwilioProvider implements SmsProvider {
  private client: TwilioClient | null = null;
  private readonly messagingServiceSid: string;

  constructor() {
    // Read here (constructor runs only when configured, via getSmsProvider).
    this.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID ?? '';
  }

  /** Lazily construct the Twilio client on first use (async import). */
  private async getClient(): Promise<TwilioClient> {
    if (this.client) return this.client;

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token || !this.messagingServiceSid) {
      throw new Error(
        'Twilio not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID'
      );
    }

    // Dynamic import keeps the SDK out of the graph until a real send happens.
    const mod = (await import('twilio')) as unknown as {
      default: (accountSid: string, authToken: string) => TwilioClient;
    };
    this.client = mod.default(sid, token);
    return this.client;
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const client = await this.getClient();
    const opts: TwilioMessageCreateOpts = {
      to: params.to,
      body: params.body,
      messagingServiceSid: this.messagingServiceSid,
    };
    const callback = statusCallbackUrl();
    if (callback) opts.statusCallback = callback;

    const message = await client.messages.create(opts);
    return { id: message.sid, status: message.status };
  }
}
