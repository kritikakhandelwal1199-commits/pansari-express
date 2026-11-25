'use client';
/**
 * Human check for the phone app's OTP sign-in. The app opens this page in a WebView;
 * Firebase reCAPTCHA runs here (on the app's own domain) and the token goes back to
 * the app, which then asks Firebase to send the SMS. Not linked from the website.
 */
import * as React from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, RecaptchaVerifier } from 'firebase/auth';

type RnWindow = Window & { ReactNativeWebView?: { postMessage: (m: string) => void } };

export default function RecaptchaPage() {
  const [state, setState] = React.useState<'working' | 'done' | 'error' | 'demo'>('working');
  React.useEffect(() => {
    const post = (m: object) => (window as RnWindow).ReactNativeWebView?.postMessage(JSON.stringify(m));
    if ((process.env.NEXT_PUBLIC_DATA_MODE ?? 'demo') !== 'firebase') {
      setState('demo');
      post({ type: 'error', message: 'This website is in demo mode' });
      return;
    }
    const app =
      getApps().find((a) => a.name === 'recaptcha') ??
      initializeApp(
        {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
        },
        'recaptcha',
      );
    const v = new RecaptchaVerifier(getAuth(app), 'recaptcha-box', { size: 'normal', callback: (token: string) => (setState('done'), post({ type: 'token', token })), 'expired-callback': () => post({ type: 'expired' }) });
    v.render().catch((e: unknown) => {
      setState('error');
      post({ type: 'error', message: e instanceof Error ? e.message : 'Could not load the check' });
    });
    return () => v.clear();
  }, []);
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid justify-items-center gap-4">
        <h1 className="text-xl font-bold">Quick check before we send your OTP</h1>
        {state === 'demo' ? <p className="text-muted">The demo website does not send real OTPs.</p> : null}
        {state === 'error' ? <p className="text-danger">Something went wrong. Close this and try again.</p> : null}
        {state === 'done' ? <p className="font-semibold text-leaf">Done — sending your OTP…</p> : null}
        <div id="recaptcha-box" />
      </div>
    </main>
  );
}
