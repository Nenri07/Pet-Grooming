'use server';

/**
 * ICS feed-token server action (Master Spec §9.6).
 *
 * Generates (once) and persists a long, unguessable `icsFeedToken` on the
 * authenticated groomer's profile, then returns the full subscribe URL for the
 * read-only calendar feed served at `GET /api/ics/{feedToken}.ics`.
 *
 * The token is the ONLY credential protecting the feed, so it must be long and
 * random. It is generated with `nanoid(32)` (≈191 bits of entropy) and reused
 * on subsequent calls — the feed URL is stable unless the token is explicitly
 * regenerated (a regenerate action can be added later to revoke an old feed).
 *
 * NOTE (UI): surfacing this URL in the portal (a "Subscribe in your calendar"
 * card in settings/availability) is intentionally left for a later pass. This
 * action is the backing primitive that UI will call.
 *
 * Runs only on the server ('use server'); authenticates via NextAuth and scopes
 * strictly to `userId: session.user.id`.
 *
 * _Master Spec: §9.6, §16_
 */
import { getServerSession } from 'next-auth';
import { nanoid } from 'nanoid';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';

/** Result envelope: the stable feed URL, or a user-facing error. */
export type IcsFeedTokenResult =
  | { ok: true; token: string; feedUrl: string }
  | { ok: false; error: string };

/** Length of the generated feed token (nanoid alphabet, ≈191 bits at 32). */
const TOKEN_LENGTH = 32;

/**
 * Build the absolute feed URL from the configured public app URL. Falls back to
 * a relative path when NEXT_PUBLIC_APP_URL is not set (still valid to hand to a
 * calendar client running against the same origin).
 */
function buildFeedUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  const path = `/api/ics/${token}.ics`;
  return base ? `${base}${path}` : path;
}

/**
 * Return the authenticated groomer's ICS feed URL, generating and persisting a
 * token on first use. Idempotent: an existing token is reused so the feed URL
 * stays stable across calls.
 */
export async function getOrCreateIcsFeedToken(): Promise<IcsFeedTokenResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to get your calendar feed.' };
  }

  try {
    await connectDB();

    const profile = await GroomerProfile.findOne({ userId: session.user.id })
      .select('icsFeedToken')
      .lean();

    if (!profile) {
      return { ok: false, error: "We couldn't find your business profile." };
    }

    // Reuse an existing token so the subscribe URL stays stable.
    if (typeof profile.icsFeedToken === 'string' && profile.icsFeedToken.length > 0) {
      return {
        ok: true,
        token: profile.icsFeedToken,
        feedUrl: buildFeedUrl(profile.icsFeedToken),
      };
    }

    // Generate + persist a new long random token.
    const token = nanoid(TOKEN_LENGTH);
    await GroomerProfile.updateOne(
      { userId: session.user.id },
      { $set: { icsFeedToken: token } }
    );

    return { ok: true, token, feedUrl: buildFeedUrl(token) };
  } catch (error) {
    console.error('getOrCreateIcsFeedToken failed:', error);
    return { ok: false, error: "We couldn't set up your calendar feed right now. Please try again." };
  }
}
