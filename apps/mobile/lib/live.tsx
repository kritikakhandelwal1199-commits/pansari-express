/**
 * Live (Firebase) mode for the phone app.
 *
 * Uses the same FirebaseDataClient as the website (@pansari/client/firebase). Two phone-only pieces:
 *  - Auth keeps the session in AsyncStorage (React Native persistence).
 *  - Firebase phone OTP needs a reCAPTCHA token. The app opens the website's /recaptcha page in a
 *    WebView; the token comes back by postMessage and Firebase then sends the SMS.
 */
import * as React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FirebaseAuth from 'firebase/auth';
import type { ApplicationVerifier, Auth } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import { FirebaseDataClient } from '@pansari/client/firebase';

export const DATA_MODE = process.env.EXPO_PUBLIC_DATA_MODE === 'firebase' ? 'firebase' : 'demo';
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? '').replace(/\/$/, '');

/* ------------------------------------------------------------------ reCAPTCHA bridge */

type Pending = { resolve: (t: string) => void; reject: (e: Error) => void };
let pending: Pending | null = null;
let show: ((on: boolean) => void) | null = null;

function askToken(): Promise<string> {
  if (!show) return Promise.reject(new Error('Sign-in check is not ready — restart the app'));
  if (!WEB_URL) return Promise.reject(new Error('EXPO_PUBLIC_WEB_URL is not set for this build'));
  pending?.reject(new Error('Cancelled'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    show?.(true);
  });
}

const verifier: ApplicationVerifier & { _reset: () => void } = {
  type: 'recaptcha',
  verify: askToken,
  _reset: () => undefined,
};

/** Mount once near the root: renders the WebView sheet when an OTP is requested. */
export function RecaptchaHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    show = setOpen;
    return () => {
      show = null;
    };
  }, []);
  const close = (err?: string) => {
    setOpen(false);
    if (err) pending?.reject(new Error(err));
    pending = null;
  };
  if (DATA_MODE !== 'firebase') return null;
  return (
    <Modal visible={open} animationType="slide" onRequestClose={() => close('Cancelled')}>
      <View className="flex-1 bg-bg pt-12">
        <View className="flex-row items-center justify-between px-4 pb-2">
          <Text className="text-lg font-bold text-ink">One quick check</Text>
          <Pressable accessibilityRole="button" onPress={() => close('Cancelled')}>
            <Text className="font-bold text-kum">Cancel</Text>
          </Pressable>
        </View>
        {open ? (
          <WebView
            source={{ uri: `${WEB_URL}/recaptcha/` }}
            originWhitelist={['https://*']}
            javaScriptEnabled
            onMessage={(e) => {
              try {
                const m = JSON.parse(e.nativeEvent.data) as { type: string; token?: string; message?: string };
                if (m.type === 'token' && m.token) {
                  pending?.resolve(m.token);
                  pending = null;
                  setOpen(false);
                } else if (m.type === 'error') close(m.message ?? 'Check failed');
              } catch {
                /* ignore other messages */
              }
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ client */

export function createLiveClient(): FirebaseDataClient {
  const env = process.env;
  const getRnPersistence = (FirebaseAuth as unknown as { getReactNativePersistence?: (s: typeof AsyncStorage) => FirebaseAuth.Persistence }).getReactNativePersistence;
  return new FirebaseDataClient({
    firebase: {
      apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
      authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
    },
    functionsRegion: env.EXPO_PUBLIC_FUNCTIONS_REGION ?? 'asia-south1',
    edgeUrl: env.EXPO_PUBLIC_EDGE_URL ?? '',
    useEmulators: false,
    makeAuth: (app: FirebaseApp): Auth => (getRnPersistence ? FirebaseAuth.initializeAuth(app, { persistence: getRnPersistence(AsyncStorage) }) : FirebaseAuth.getAuth(app)),
    verifier: () => verifier,
  });
}
