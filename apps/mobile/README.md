# Pansari Express — phone app (Expo)

One Android + iPhone app for everyone (Expo SDK 58, Expo Router, NativeWind). After sign-in each
person lands in their own part of the app:

| Who | Opens | What they do |
|---|---|---|
| Customer | Shop tabs | Browse nearest store, cart, UPI / card (test) / wallet / COD, track order, delivery code, wallet, help chat |
| Shop owner (`seller`) | `/owner` | Online orders (accept → pack → hand to rider / send out → deliver, cancel), assign riders, riders & COD cash, stock, business KYC, recall banner |
| Staff | `/staff` | Pick & pack (bin-sorted list with FEFO batch numbers, camera barcode scan), assign rider, receive stock, shelf count |
| Rider | `/rider` | Go on shift, collect → start trip → deliver with code, cash in hand + ledger, earnings, KYC photos |
| Compliance | `/compliance` | KYC review with document photo, listing review, batch / whole-product recalls, audit log |
| Super admin | `/admin` | Overview, people & roles by phone, delivery zones (rectangle editor + address check), GST/HSN master, listings, audit |

It reuses `@pansari/client` (DataClient + demo backend) and `@pansari/shared` (GST engine, FEFO,
order / rider / recall rules), so totals, stock and permissions behave exactly like the web app.

## Run

```bash
# once, from the repo root
npm ci && npm run build -w @pansari/shared && npm run build -w @pansari/adapters
cd apps/mobile && npm ci
npx expo start            # scan the QR with Expo Go, or press a / i for an emulator
```

Demo mode: data lives on the phone. On the sign-in screen tap any demo account (OTP 123456).

## Installable Android APK (no Play Store)

```bash
npm i -g eas-cli
eas login                 # your Expo account
eas build -p android --profile preview    # demo-mode APK, ~15 min on Expo's servers
```
`eas.json` profiles: `preview` (demo APK), `live` (APK against real Firebase), `production` (Play Store bundle).

## Notes

* Not part of the root npm workspaces on purpose (keeps React Native's dependency tree away from
  the web build). It links the shared packages with `file:` dependencies; `metro.config.js` watches them.
* `lib/polyfills.ts` adds Web Crypto (random bytes, SHA-256, HMAC) for Hermes.
* Camera: `expo-camera` (barcodes), `expo-image-picker` (KYC / delivery photos), `expo-location` (rider shift).
* `npx expo export --platform android` checks the bundle; CI runs it in `.github/workflows/mobile.yml`.
  `--platform web` + a static server lets you click through every role in a browser.
