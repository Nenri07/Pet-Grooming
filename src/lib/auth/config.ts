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

export const authOptions: NextAuthOptions = {
  providers,
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE, // 7 days
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      // At sign-in, copy the User id onto the token.
      if (user) {
        token.userId = user.id;
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
        await connectDB();
        const profile = await GroomerProfile.findOne({ userId: token.userId })
          .select('onboardingComplete groomerSlug')
          .lean();
        token.onboardingComplete = profile?.onboardingComplete ?? false;
        token.groomerSlug = profile?.groomerSlug ?? null;
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
