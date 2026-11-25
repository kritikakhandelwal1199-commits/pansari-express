# Going live — checklist for Rahul

Everything below needs your own accounts, card or sign-ins, so you do these steps yourself.
The code side is ready: website, phone app (all roles), Cloud Functions, rules and indexes.

Payments, e-invoice IRN and the bot check (Turnstile) stay in **test mode** until their providers
approve you. Customers can still order with **cash on delivery** and **wallet**.

---

## 0. One-time: your PC

1. Install **Node.js 22 LTS** (https://nodejs.org) and **Git**.
2. (Optional) **Java 21**, only if you want to run the security-rules test on your PC.
3. `git clone https://github.com/kritikakhandelwal1199-commits/pansari-express.git`
4. In the folder: `npm ci`, then `npm run build -w @pansari/shared` and `npm run build -w @pansari/adapters`.

## 1. Security rules — already checked

GitHub runs the security-rules tests automatically (Actions → "Security rules tests") whenever the
rules change. Before deploying, open the repo's **Actions** tab and make sure the latest run is green.
To run them yourself: `npm run test:rules` (needs Java 21).

## 2. Deploy the backend and website

1. Open `deploy.ps1` and check the line `[string]$OwnerPhone = '+918696131859'`.
   **This number becomes the super admin.** Change it to your own mobile number if it isn't yours.
2. Double-click **deploy.cmd** and follow the prompts (see DEPLOY.md):
   - sign in to Google (Firebase) and Cloudflare when the browser opens,
   - switch the project to the **Blaze** plan, add your card and **set a budget alert** (e.g. ₹1,000),
   - when asked, allow Cloud Storage to read Firestore (needed for delivery photos).
3. In the Firebase console → **Authentication → Sign-in method**: turn on **Phone** and **Anonymous**.
   Under **Settings → SMS region policy**, allow only **India**.
4. When it finishes it prints `https://<project>.web.app`.

## 3. First sign-in and roles

1. Open `https://<project>.web.app/login` and sign in with the super-admin number (real OTP by SMS).
2. Press **First-time setup: make me the super admin**. It loads the sample stores and products and
   opens **People & roles**.
3. Add people with their mobile numbers:
   - the shop owner → **Shop owner**,
   - counter / picker staff → **Staff** (tick their stores),
   - riders → **Rider** (pick their home store),
   - the person checking documents → **Compliance**.
   They sign in with their own number; the role applies on their next sign-in.
4. Replace the sample catalogue and stock with the real ones (Seller portal → Products, Stock).
5. Edit **Delivery zones** to the real areas and fees, and check the **GST tax master** rates with your CA.
6. Owner: upload the **Business KYC** documents. Riders: upload theirs in the rider app.

## 4. Phone app (Android APK, no Play Store needed)

`deploy.cmd` wrote the app's settings to `apps/mobile/.env`.

```bash
npm i -g eas-cli
cd apps/mobile
npm ci
eas login                                   # your Expo account (free)
eas build -p android --profile live         # real Firebase; ~15 min on Expo's servers
```
EAS gives you a link to download the `.apk`. Install it on the phones (allow "install unknown apps").
Everyone uses the same app; after sign-in each person lands in their own section.

- `--profile preview` builds the **demo** app (sample data on the phone, OTP 123456) for training.
- For the Play Store later: `eas build -p android --profile production` (needs a Google Play
  developer account, one-time US$25).

How OTP works in the app: Firebase needs a quick "I'm not a robot" check before sending the SMS.
The app shows it from your website (`/recaptcha`), so the website must be deployed first.

## 5. Before opening to customers

- Place a few real test orders: COD, wallet; assign a rider; deliver with the code; hand in cash;
  pay the rider; raise and complete a test recall; do a hygiene check.
- Check the GST invoice PDF with your CA (GSTIN, HSN, rates, invoice numbering).
- Keep the Blaze budget alert on. Typical cost at small scale is a few hundred rupees a month.

## Later, when providers approve you

| Feature | Provider | What changes |
|---|---|---|
| Online UPI / card payments | Razorpay / PhonePe PG | Payment adapter keys in function secrets |
| E-invoice IRN (B2B) | NIC IRP / GSP | GST adapter credentials |
| Bot check on walk-in QR | Cloudflare Turnstile | Site + secret key |
| Rider payouts by API | RazorpayX | Payouts recorded today become API calls |
