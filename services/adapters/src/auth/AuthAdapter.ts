/**
 * AuthAdapter — phone OTP + anonymous sessions.
 * API HOLD MODE: no paid SMS. Use LocalMockAuthProvider in unit tests / storybook,
 * and FirebasePhoneAuthProvider against the Auth emulator or Firebase test phone
 * numbers (+91 9999999999 → 123456).
 */

export interface OtpChallenge {
  verificationId: string;
  phone: string;
  expiresAt: number; // epoch ms
  resendAfter: number; // epoch ms
  channel: 'mock' | 'firebase';
}

export interface AuthSession {
  uid: string;
  phone: string | null;
  isAnonymous: boolean;
  isNewUser: boolean;
}

export interface AuthAdapter {
  readonly provider: string;
  sendOtp(phoneE164: string): Promise<OtpChallenge>;
  verifyOtp(verificationId: string, code: string): Promise<AuthSession>;
  signInAnonymously(): Promise<AuthSession>;
  /** Walk-in upgrade path: attach a verified phone to the current anonymous user. */
  linkPhone(verificationId: string, code: string): Promise<AuthSession>;
  currentSession(): AuthSession | null;
  signOut(): Promise<void>;
}

export class AuthError extends Error {
  constructor(readonly code: 'INVALID_PHONE' | 'INVALID_CODE' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'RESEND_TOO_SOON' | 'NO_CHALLENGE' | 'NOT_ANONYMOUS' | 'PHONE_IN_USE', message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Firebase-style test numbers. Configure the same pairs in the Firebase console / emulator. */
export const DEFAULT_TEST_NUMBERS: Readonly<Record<string, string>> = {
  '+919999999999': '123456',
  '+919999999998': '123456',
};
