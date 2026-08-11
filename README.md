# Hisaab AI Cash Manager

Mobile-first cashbook for Roman Urdu and English transaction entry. The frontend is deployed on GitHub Pages, Gemini runs inside a JWT-protected Supabase Edge Function, and every tester stores transactions in a Google Sheet owned by their own Google account.

## Included

- Voice, chat, and manual transaction entry
- Focused mobile-only dashboard with three direct one-tap entry shortcuts
- Opening balance entry from Home or Settings
- Daily closing summary with expected cash, counted cash, difference, and notes
- Separate History, Insights, and Settings tabs
- Roman Urdu rules for `liye`, `diye`, `jama karwaye`, and `nikalwaye`
- Gemini structured parsing with an offline rules-based fallback
- Supabase Google authentication
- Per-user Google Sheet creation and synchronization
- Local device persistence, search, confirmation, and undo
- Mobile-first typography and accessible touch targets
- Installable home-screen app metadata and Android app shortcuts
- GitHub Pages deployment workflow

## Architecture

```text
GitHub Pages frontend
  ├─ Supabase Auth → Google OAuth
  ├─ Google Sheets API → user's own spreadsheet
  └─ Supabase Edge Function → Gemini API
```

The Gemini key is never stored in the frontend or GitHub repository.

## Local development

1. Install Node.js 22.
2. Run `npm install`.
3. The supplied `public/config.js` is already connected to Supabase project
   `ydnpucuwnloutfqiycub` with its browser-safe publishable key.
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
- `50000 Meezan Bank main jama karwaye` → Money out / Deposited
- `20000 Meezan Bank se nikalwaye` → Money in / Withdrawn
- `1000 Ali` → Ask the user to confirm the direction
