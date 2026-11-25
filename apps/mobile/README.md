# Pansari Express — customer phone app (Expo)

Android + iPhone app from one codebase (Expo SDK 58, Expo Router, NativeWind).
Same screens and rules as the web shop: browse the nearest store, cart with delivery fee,
UPI / card (test mode) / wallet / cash on delivery, order tracking with the 4-digit delivery
code, wallet with instant refunds, and the help chatbot.

It reuses `@pansari/client` (the DataClient + demo backend) and `@pansari/shared` (GST engine,
FEFO stock planner, order rules, chatbot), so totals and stock behave exactly like the web app.

## Run

```bash
# once, from the repo root
npm ci && npm run build -w @pansari/shared && npm run build -w @pansari/adapters
# then
cd apps/mobile
npm ci
npx expo start            # scan the QR with Expo Go, or press a / i for an emulator
```

Demo mode only for now: data lives on the phone (AsyncStorage). Sign in with any number
(OTP 123456) or tap "Customer · Priya". On an order, **Demo: next step** plays the store's
part (accept → pack → send out → deliver) because the store works on another device.

## Notes

* Not part of the root npm workspaces on purpose (keeps React Native's dependency tree away
  from the web build). It links the shared packages with `file:` dependencies; `metro.config.js`
  watches them.
* `lib/polyfills.ts` adds Web Crypto (random bytes, SHA-256, HMAC) for Hermes.
* Going live needs a React Native Firebase DataClient (phone OTP via `@react-native-firebase/auth`)
  plugged into `lib/data.tsx`, plus an EAS build for the stores.
* `npx expo export --platform android` checks the bundle; CI runs it in `.github/workflows/mobile.yml`.
