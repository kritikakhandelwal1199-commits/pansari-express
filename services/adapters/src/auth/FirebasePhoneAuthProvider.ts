/**
 * Firebase Auth implementation of AuthAdapter (web / React Native Firebase JS SDK).
 * Import from "@pansari/adapters/firebase-auth" so the Firebase SDK stays optional.
 *
 * API HOLD MODE: point it at the Auth emulator (`emulatorUrl`) or use Firebase
 * console test numbers (+91 9999999999 → 123456). No real SMS is sent either way.
 */
import {
  connectAuthEmulator,
  getAdditionalUserInfo,
  linkWithPhoneNumber,
  signInAnonymously as fbSignInAnonymously,
  signInWithPhoneNumber,
  signOut as fbSignOut,
  type ApplicationVerifier,
  type Auth,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { isValidIndianMobile, randomId } from '@pansari/shared';
import { AuthError, type AuthAdapter, type AuthSession, type OtpChallenge } from './AuthAdapter.js';

export interface FirebasePhoneAuthConfig {
  auth: Auth;
  /** e.g. "http://127.0.0.1:9099" — connects the emulator once. */
  emulatorUrl?: string;
  /** Disable reCAPTCHA. Only honoured together with emulatorUrl or test numbers. */
  disableAppVerificationForTesting?: boolean;
  /** Factory for the reCAPTCHA / Play Integrity verifier on real devices. */
  verifierFactory: () => ApplicationVerifier;
  resendCooldownSeconds?: number;
}

const connected = new WeakSet<Auth>();

function toSession(user: User, isNewUser: boolean): AuthSession {
  return { uid: user.uid, phone: user.phoneNumber, isAnonymous: user.isAnonymous, isNewUser };
}

function mapError(e: unknown): never {
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'auth/invalid-verification-code') throw new AuthError('INVALID_CODE', 'Wrong OTP');
  if (code === 'auth/code-expired') throw new AuthError('EXPIRED', 'OTP expired, request a new one');
  if (code === 'auth/too-many-requests') throw new AuthError('TOO_MANY_ATTEMPTS', 'Too many attempts, try again later');
  if (code === 'auth/invalid-phone-number') throw new AuthError('INVALID_PHONE', 'Invalid phone number');
  if (code === 'auth/credential-already-in-use' || code === 'auth/provider-already-linked') throw new AuthError('PHONE_IN_USE', 'This number already has an account — sign in instead');
  throw e;
}

export class FirebasePhoneAuthProvider implements AuthAdapter {
  readonly provider = 'firebase';
  private pending = new Map<string, { result: ConfirmationResult; phone: string; purpose: 'signin' | 'link' }>();
  private lastSent = new Map<string, number>();

  constructor(private cfg: FirebasePhoneAuthConfig) {
    if (cfg.emulatorUrl && !connected.has(cfg.auth)) {
      connectAuthEmulator(cfg.auth, cfg.emulatorUrl, { disableWarnings: true });
      connected.add(cfg.auth);
    }
    if (cfg.disableAppVerificationForTesting) {
      cfg.auth.settings.appVerificationDisabledForTesting = true;
    }
  }

  private guard(phoneE164: string): string {
    const phone = phoneE164.replace(/\s+/g, '');
    if (!isValidIndianMobile(phone)) throw new AuthError('INVALID_PHONE', 'Enter a valid Indian mobile number as +91XXXXXXXXXX');
    const wait = (this.cfg.resendCooldownSeconds ?? 30) * 1000;
    if (Date.now() - (this.lastSent.get(phone) ?? 0) < wait) throw new AuthError('RESEND_TOO_SOON', 'Please wait before requesting another OTP');
    return phone;
  }

  private challenge(phone: string, result: ConfirmationResult, purpose: 'signin' | 'link'): OtpChallenge {
    const verificationId = `fb_${randomId(10)}`;
    const now = Date.now();
    this.pending.set(verificationId, { result, phone, purpose });
    this.lastSent.set(phone, now);
    const cooldown = (this.cfg.resendCooldownSeconds ?? 30) * 1000;
    return { verificationId, phone, expiresAt: now + 5 * 60 * 1000, resendAfter: now + cooldown, channel: 'firebase' };
  }

  async sendOtp(phoneE164: string): Promise<OtpChallenge> {
    const phone = this.guard(phoneE164);
    try {
      return this.challenge(phone, await signInWithPhoneNumber(this.cfg.auth, phone, this.cfg.verifierFactory()), 'signin');
    } catch (e) {
      mapError(e);
    }
  }

  async sendLinkOtp(phoneE164: string): Promise<OtpChallenge> {
    const user = this.cfg.auth.currentUser;
    if (!user?.isAnonymous) throw new AuthError('NOT_ANONYMOUS', 'Only an anonymous session can be upgraded');
    const phone = this.guard(phoneE164);
    try {
      return this.challenge(phone, await linkWithPhoneNumber(user, phone, this.cfg.verifierFactory()), 'link');
    } catch (e) {
      mapError(e);
    }
  }

  private async confirm(verificationId: string, code: string, purpose: 'signin' | 'link'): Promise<AuthSession> {
    const p = this.pending.get(verificationId);
    if (!p || p.purpose !== purpose) throw new AuthError('NO_CHALLENGE', 'Request a new OTP');
    if (!/^\d{6}$/.test(code)) throw new AuthError('INVALID_CODE', 'OTP is 6 digits');
    try {
      const cred = await p.result.confirm(code);
      this.pending.delete(verificationId);
      return toSession(cred.user, getAdditionalUserInfo(cred)?.isNewUser ?? false);
    } catch (e) {
      mapError(e);
    }
  }

  verifyOtp(verificationId: string, code: string) {
    return this.confirm(verificationId, code, 'signin');
  }

  linkPhone(verificationId: string, code: string) {
    return this.confirm(verificationId, code, 'link');
  }

  async signInAnonymously(): Promise<AuthSession> {
    const cred = await fbSignInAnonymously(this.cfg.auth);
    return toSession(cred.user, getAdditionalUserInfo(cred)?.isNewUser ?? true);
  }

  currentSession(): AuthSession | null {
    const u = this.cfg.auth.currentUser;
    return u ? toSession(u, false) : null;
  }

  async signOut() {
    await fbSignOut(this.cfg.auth);
  }
}
