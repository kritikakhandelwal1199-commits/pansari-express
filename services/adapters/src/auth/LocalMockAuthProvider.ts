import { isValidIndianMobile, randomId, sha256Hex } from '@pansari/shared';
import { AuthError, DEFAULT_TEST_NUMBERS, type AuthAdapter, type AuthSession, type OtpChallenge } from './AuthAdapter.js';

export interface LocalMockAuthConfig {
  testNumbers: Readonly<Record<string, string>>;
  otpTtlSeconds: number;
  resendCooldownSeconds: number;
  maxAttempts: number;
  /** Non-test numbers get a random code delivered here (dev console), never over SMS. */
  onDevOtp?: (phone: string, code: string) => void;
  now?: () => number;
}

interface Challenge {
  phone: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  purpose: 'signin' | 'link';
}

const DEFAULTS: LocalMockAuthConfig = {
  testNumbers: DEFAULT_TEST_NUMBERS,
  otpTtlSeconds: 300,
  resendCooldownSeconds: 30,
  maxAttempts: 5,
};

/** In-memory OTP auth for tests and offline demos. Same rules a real provider enforces. */
export class LocalMockAuthProvider implements AuthAdapter {
  readonly provider = 'local-mock';
  private cfg: LocalMockAuthConfig;
  private challenges = new Map<string, Challenge>();
  private lastSent = new Map<string, number>();
  private users = new Map<string, string>(); // phone → uid
  private session: AuthSession | null = null;

  constructor(cfg: Partial<LocalMockAuthConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  private now() {
    return (this.cfg.now ?? Date.now)();
  }

  private async issue(phoneE164: string, purpose: Challenge['purpose']): Promise<OtpChallenge> {
    const phone = phoneE164.replace(/\s+/g, '');
    if (!isValidIndianMobile(phone)) throw new AuthError('INVALID_PHONE', 'Enter a valid Indian mobile number as +91XXXXXXXXXX');
    const now = this.now();
    const last = this.lastSent.get(phone) ?? 0;
    const cooldown = this.cfg.resendCooldownSeconds * 1000;
    if (now - last < cooldown) throw new AuthError('RESEND_TOO_SOON', 'Please wait before requesting another OTP');
    const code = this.cfg.testNumbers[phone] ?? String(Math.floor(100000 + Math.random() * 900000));
    if (!this.cfg.testNumbers[phone]) this.cfg.onDevOtp?.(phone, code);
    const verificationId = `otp_${randomId(12)}`;
    const expiresAt = now + this.cfg.otpTtlSeconds * 1000;
    this.challenges.set(verificationId, { phone, codeHash: await sha256Hex(`${verificationId}:${code}`), expiresAt, attempts: 0, purpose });
    this.lastSent.set(phone, now);
    return { verificationId, phone, expiresAt, resendAfter: now + cooldown, channel: 'mock' };
  }

  sendOtp(phoneE164: string) {
    return this.issue(phoneE164, 'signin');
  }

  /** Starts a link challenge for the anonymous → phone upgrade path. */
  sendLinkOtp(phoneE164: string) {
    if (!this.session?.isAnonymous) throw new AuthError('NOT_ANONYMOUS', 'Only an anonymous session can be upgraded');
    return this.issue(phoneE164, 'link');
  }

  private async check(verificationId: string, code: string): Promise<Challenge> {
    const ch = this.challenges.get(verificationId);
    if (!ch) throw new AuthError('NO_CHALLENGE', 'Request a new OTP');
    if (this.now() > ch.expiresAt) {
      this.challenges.delete(verificationId);
      throw new AuthError('EXPIRED', 'OTP expired, request a new one');
    }
    if (ch.attempts >= this.cfg.maxAttempts) {
      this.challenges.delete(verificationId);
      throw new AuthError('TOO_MANY_ATTEMPTS', 'Too many wrong attempts, request a new OTP');
    }
    ch.attempts += 1;
    if (!/^\d{6}$/.test(code) || (await sha256Hex(`${verificationId}:${code}`)) !== ch.codeHash) throw new AuthError('INVALID_CODE', 'Wrong OTP');
    this.challenges.delete(verificationId);
    return ch;
  }

  private async uidFor(phone: string) {
    return `mock_${(await sha256Hex(phone)).slice(0, 24)}`;
  }

  async verifyOtp(verificationId: string, code: string): Promise<AuthSession> {
    const ch = await this.check(verificationId, code);
    const isNewUser = !this.users.has(ch.phone);
    const uid = this.users.get(ch.phone) ?? (await this.uidFor(ch.phone));
    this.users.set(ch.phone, uid);
    this.session = { uid, phone: ch.phone, isAnonymous: false, isNewUser };
    return { ...this.session };
  }

  async signInAnonymously(): Promise<AuthSession> {
    this.session = { uid: `anon_${randomId(12)}`, phone: null, isAnonymous: true, isNewUser: true };
    return { ...this.session };
  }

  async linkPhone(verificationId: string, code: string): Promise<AuthSession> {
    const current = this.session;
    if (!current?.isAnonymous) throw new AuthError('NOT_ANONYMOUS', 'Only an anonymous session can be upgraded');
    const ch = await this.check(verificationId, code);
    if (this.users.has(ch.phone)) throw new AuthError('PHONE_IN_USE', 'This number already has an account — sign in instead');
    this.users.set(ch.phone, current.uid); // keep the same uid, as Firebase linking does
    this.session = { uid: current.uid, phone: ch.phone, isAnonymous: false, isNewUser: true };
    return { ...this.session };
  }

  currentSession() {
    return this.session ? { ...this.session } : null;
  }

  async signOut() {
    this.session = null;
  }
}
