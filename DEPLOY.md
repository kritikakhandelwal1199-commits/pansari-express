# Deploying Pansari Express

1. Install **Node.js 22 LTS** from https://nodejs.org (if `node -v` shows less than 22).
2. Double-click **deploy.cmd** in this folder.
3. Follow the yellow prompts:
   - sign in to Google when the browser opens (Firebase),
   - switch the new project to the **Blaze** plan and add your card (set a budget alert),
   - enable **Phone** and **Anonymous** sign-in and click **Storage → Get started** (Claude can do these in the browser),
   - sign in to Cloudflare when the browser opens.
4. At the end it prints your website (`https://<project>.web.app`).
5. Open `/login`, sign in with your (admin) number, press **First-time setup: make me the super admin**.
6. In **People & roles**, add the shop owner's number as **Shop owner**, then staff, riders (with home store) and compliance.

Phone app and the full go-live checklist: see **docs/GO-LIVE.md**.

Re-running deploy.cmd is safe; it skips finished steps (see `deploy-state.json` — keep it private).
To publish code changes later, run deploy.cmd again.

Still in test mode after deploy: in-app UPI for walk-in customers (simulated), e-invoice IRN (local test
key), Turnstile human check (mock). Switch these on only after the live providers are approved.
