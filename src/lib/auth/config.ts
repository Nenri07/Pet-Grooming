/**
 * NextAuth.js configuration for PawPort.
 *
 * Provides two sign-in strategies:
 *  - Credentials: email + bcrypt-hashed password, with an account-lockout
 *    policy (5 failed attempts -> locked for 30 minutes).
 *  - Google OAuth: registered ONLY when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *    are configured with real (non-placeholder) values, so the app still boots
 *    when Google is not set up (Requirement 1.3 — present the option WHERE
 *    Google is configured).
 *
 * Sessions use the stateless JWT strategy with a 7-day lifetime, backed by
 * NextAuth's secure HTTP-only session cookie. The jwt/session callbacks project
 * the user id, onboarding status, and public booking slug onto the session so
 * the UI and middleware can read them without an extra query per render.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_
 */
import type { NextAuthOptions } from 'next-auth';
import type { Provider } from 'next-auth/providers/index';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';

/** Number of consecutive failed logins that trips the account lock. */
const MAX_FAILED_ATTEMPTS = 5;
/** How long an account stays locked once tripped (30 minutes, in ms). */
const LOCK_DURATION_MS = 30 * 60 * 1000;
/** Session lifetime: 7 days, expressed in seconds. */
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * True when a Google OAuth credential looks real (present and not one of the
 * placeholder values shipped in `.env` / `.env.example`). Guards provider
 * registration so a missing/placeholder credential never crashes boot.
 */
function isConfigured(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Treat the shipped placeholders as "not configured".
  if (trimmed.startsWith('your-google-oauth')) return false;
  return true;
}

const googleConfigured =
  isConfigured(process.env.GOOGLE_CLIENT_ID) &&
  isConfigured(process.env.GOOGLE_CLIENT_SECRET);

const providers: Provider[] = [
  CredentialsProvider({
    name: 'credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      const email = credentials?.email?.trim().toLowerCase();
      const password = credentials?.password;
      if (!email || !password) return null;

      await connectDB();
      const user = await User.findOne({ email });

      // Do not distinguish "no such user" from "wrong password".
      if (!user || !user.passwordHash) return null;

      // Reject while the account is locked.
      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        return null;
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);

      if (!isValid) {
        user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
        if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
        }
        await user.save();
        return null;
      }

      // Successful login: clear the failure counters.
      if (user.failedLoginAttempts !== 0 || user.lockedUntil) {
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        await user.save();
      }

      return {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
      };
    },
  }),
];

// Register Google only where real credentials are present (Requirement 1.3).
if (googleConfigured) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    })
  );
}

/**
 * Provision (or link) the Mongo `User` for a Google sign-in and return its
 * `_id` as a string.
 *
 * NextAuth with the JWT strategy has NO database adapter, so a Google sign-in
 * does not create a Mongo `User`/`GroomerProfile` on its own the way
 * `registerGroomer` does for credentials. Without this, `token.userId` would be
 * the raw Google account id, every profile-scoped query would miss, and the
 * groomer would be trapped bouncing to /onboarding. This mirrors what
 * `registerGroomer` does for credentials users:
 *
 *  1. Find an existing `User` by `googleId`, else by `email` (lowercased).
 *     - If found by email (e.g. a credentials account with the same address),
 *       link `googleId` onto it rather than creating a duplicate — `email` is
 *       unique.
 *     - If none exists, create an OAuth `User` (passwordHash: null).
 *  2. Ensure a paired `GroomerProfile` exists (idempotent upsert).
 *
 * Best-effort: any DB error is logged and surfaced as `null` so callers can
 * decide how to degrade without the auth callback throwing.
 */
async function provisionGoogleUser(params: {
  googleId?: string | null;
  email?: string | null;
  name?: string | null;
}): Promise<string | null> {
  const email = params.email?.trim().toLowerCase();
  const googleId = params.googleId?.trim() || undefined;

  // Without an email we cannot satisfy the unique/required User fields.
  if (!email) return null;

  await connectDB();

  // 1. Locate an existing user by googleId first, then by email.
  let user =
    (googleId ? await User.findOne({ googleId }) : null) ??
    (await User.findOne({ email }));

  if (user) {
    // Link the Google identity onto an existing (possibly credentials) account.
    if (googleId && user.googleId !== googleId) {
      user.googleId = googleId;
      await user.save();
    }
  } else {
    // 2. No account yet — create an OAuth user (no password).
    user = await User.create({
      name: params.name?.trim() || email,
      email,
      googleId,
      passwordHash: null,
      isActive: false,
      role: 'groomer',
    });
  }

  // 3. Ensure the paired GroomerProfile exists (idempotent).
  await GroomerProfile.findOneAndUpdate(
    { userId: user._id },
    {
      $setOnInsert: {
        userId: user._id,
        onboardingStep: 0,
        onboardingComplete: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return user._id.toString();
}

export const authOptions: NextAuthOptions = {
  providers,
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE, // 7 days
  },
  callbacks: {
    /**
     * Provision the Mongo `User` + `GroomerProfile` for a Google sign-in before
     * the session is issued. Credentials sign-ins already have both (created by
     * `registerGroomer`), so they pass straight through.
     *
     * Best-effort: a transient DB error must NOT throw out of the callback (that
     * would break sign-in). We log and allow the sign-in; the jwt callback and
     * the onboarding page both defend against a still-missing profile.
     */
    async signIn({ account, profile, user }) {
      if (account?.provider === 'google') {
        try {
          await provisionGoogleUser({
            googleId: account.providerAccountId ?? (profile as { sub?: string } | undefined)?.sub,
            email: profile?.email ?? user?.email,
            name: profile?.name ?? user?.name,
          });
        } catch (error) {
          console.error('Google sign-in provisioning failed:', error);
        }
      }
      return true;
    },
    async jwt({ token, user, account, profile, trigger }) {
      // At sign-in, put the Mongo User `_id` onto the token for BOTH providers.
      // For credentials, `user.id` is already the Mongo `_id`. For Google,
      // `user.id` is the Google account id, so resolve the Mongo user instead.
      if (user) {
        if (account?.provider === 'google') {
          try {
            const mongoId = await provisionGoogleUser({
              googleId:
                account.providerAccountId ??
                (profile as { sub?: string } | undefined)?.sub,
              email: profile?.email ?? user.email,
              name: profile?.name ?? user.name,
            });
            // Fall back to the raw id only if resolution failed; the onboarding
            // guard still recovers, and we never crash the callback.
            token.userId = mongoId ?? user.id;
          } catch (error) {
            console.error('Resolving Mongo id for Google sign-in failed:', error);
            token.userId = user.id;
          }
        } else {
          token.userId = user.id;
        }
      }

      // Stamp the onboarding status and public slug onto the token so
      // middleware can gate portal routes without a DB call. Refresh it at
      // sign-in, whenever the session is explicitly updated, and while
      // onboarding is still incomplete (so the flag flips to true once the
      // groomer finishes the wizard). Once complete, we stop re-querying.
      const needsProfileRefresh =
        !!user ||
        trigger === 'update' ||
        token.onboardingComplete !== true;

      if (token.userId && needsProfileRefresh) {
        try {
          await connectDB();
          const profile = await GroomerProfile.findOne({ userId: token.userId })
            .select('onboardingComplete groomerSlug')
            .lean();
          token.onboardingComplete = profile?.onboardingComplete ?? false;
          token.groomerSlug = profile?.groomerSlug ?? null;
        } catch (error) {
          // Never throw out of the jwt callback (it would break auth). Leave the
          // existing flags untouched and default anything missing safely.
          console.error('Onboarding-status refresh failed:', error);
          token.onboardingComplete = token.onboardingComplete ?? false;
          token.groomerSlug = token.groomerSlug ?? null;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
        session.user.onboardingComplete = token.onboardingComplete ?? false;
        session.user.groomerSlug = token.groomerSlug ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
};

/**
 * Whether the Google OAuth sign-in option should be presented in the UI.
 * The login/registration pages read this to conditionally render the button
 * (Requirement 1.3).
 */
export const isGoogleAuthEnabled = googleConfigured;
