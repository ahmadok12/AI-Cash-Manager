# Hisaab AI Cash Manager

## Google Sheets cashbook columns

The Transactions sheet keeps money received and money paid in separate columns and recalculates the running balance whenever transactions are added, edited, deleted, or re-synced.

```text
ID | Date | Time | Wallet | Type | Money In (PKR) | Money Out (PKR) | Wallet Balance (PKR) | Description | Entry method | Parser
```

Mobile-first cashbook for Roman Urdu and English transaction entry. The frontend is deployed on GitHub Pages, Gemini runs inside a JWT-protected Supabase Edge Function, and every tester stores transactions in a Google Sheet owned by their own Google account.

## Included

- Voice, chat, and manual transaction entry
- Focused mobile-only dashboard with three direct one-tap entry shortcuts
- Multiple cash and bank wallets with independent balances
- One editable opening balance per wallet
- Wallet-to-wallet transfers that do not change total cashbook balance
- Separate Savings and Khaata buttons for quick access
- Savings goals for future assets, shopping, tours, and other plans; every saving or withdrawal uses a selected wallet and updates its balance
- Open Khaatas for ongoing lending and receipts
- Target receivables with optional monthly installment schedules and overdue/partial/paid states
- Lending and installment receipts linked to the selected wallet so both cash and receivables stay correct
- Editable savings goals, initial Khaata receivables, and every Savings/Khaata cash entry
- Date-filtered A4 Khaata PDFs with activity, brought-forward balance, and installment schedule
- Date-filtered cash in/out reports in PDF and CSV
- Mobile file sharing to WhatsApp, with PDF download plus prepared WhatsApp message as the desktop fallback
- Daily closing summary per wallet with expected balance, counted balance, difference, and notes
- Separate History, Insights, and Settings tabs
- Roman Urdu rules for `liye`, `diye`, `jama karwaye`, and `nikalwaye`
- Deterministic Roman Urdu/English compound-number parsing shared by the app and Edge Function
- Gemini structured parsing with an offline rules-based fallback
- Supabase Google authentication
- Per-user Google Sheet creation and synchronization
- Automatic sheet creation after Google authorization
- Edit and delete past entries with Google Sheets synchronization
- Per-wallet balance protection that blocks money-out above the available balance
- Local device persistence, search, and confirmation
- Three-step first-run onboarding for currency, the first wallet, and optional Google Sheets connection
- Automatic migration of existing v2.3 entries into the user’s original wallet
- Editable voice/chat confirmation before saving
- Configurable currency with English-only labels (`Rs.` for PKR; never `₹`)
- Google Sheet change detection with explicit import or restore choices
- Optional private Supabase backup for entries recorded before Google Sheets is connected
- Mobile-first typography and accessible touch targets
- Installable home-screen app metadata and Android app shortcuts
- GitHub Pages deployment workflow

## Architecture

```text
GitHub Pages frontend
  ├─ Supabase Auth → anonymous session, later linked to Google OAuth
  ├─ Supabase Database → private per-user backup (RLS protected)
  ├─ Google Sheets API → user's own spreadsheet
  └─ Supabase Edge Function → Gemini API
```

The Gemini key is never stored in the frontend or GitHub repository.

The app/Supabase ledger is the source of truth. If a user edits the Google Sheet, Hisaab detects the difference and asks whether to import the validated Sheet version or restore the Sheet from the app. It never resolves an accounting conflict silently.

## Local development

1. Install Node.js 22.
2. Run `npm install`.
3. The included `public/config.js` is already configured for project `ydnpucuwnloutfqiycub`.
4. Run `npm run dev`.

For production setup, follow [DEPLOYMENT.md](DEPLOYMENT.md).

## Add Hisaab to a phone home screen

### iPhone

1. Open the deployed app in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**, then **Add**.

iOS adds the main Hisaab app icon. To create a separate Voice or Chat icon, use the Apple Shortcuts app: create an **Open URLs** shortcut with `?quick=voice` or `?quick=chat` added to the deployed app URL, then choose **Add to Home Screen**. iOS still requires a tap inside the app before microphone recording can begin.

### Android

1. Open the deployed app in Chrome.
2. Open the Chrome menu and tap **Install app** or **Add to Home screen**.
3. Long-press the installed Hisaab icon to access **Voice**, **Chat**, and **Manual** shortcuts when supported by the launcher.

The browser must ask for microphone permission on the first voice entry. A home-screen launch cannot bypass that security permission.

## Test phrases

- `500 rs Imran se liye` → Money in
- `2000 rs diye chaye wale ko` → Money out
- `50000 Meezan Bank main jama karwaye` → Cash Wallet to Meezan Bank transfer (when both wallets exist)
- `20000 Meezan Bank se nikalwaye` → Meezan Bank to Cash Wallet transfer (when both wallets exist)
- `500 chaye wale ko diye` → Money out, then choose the wallet before saving
- `500 Meezan Bank se bill pay kiya` → Money out from the matching Meezan Bank wallet
- `1000 Ali` → Ask the user to confirm the direction
- `2 hazar 5 so 60 diye` → Rs. 2,560 money out
- `do hazaar paanch sau saath diye` → Rs. 2,560 money out

Run `npm test` to verify wallet balances, savings calculations, installment allocation, and the compound-number parser before deployment.
