# Deployment guide: GitHub Pages + Supabase + Gemini + Google Sheets

This package is already connected to your Supabase project:

- Project reference: `ydnpucuwnloutfqiycub`
- Project URL: `https://ydnpucuwnloutfqiycub.supabase.co`
- Frontend key: already added to `public/config.js`
- Expected GitHub Pages URL: `https://ahmadok12.github.io/AI-Cash-Manager/`

The publishable key is intentionally included in browser code. Never add a
Supabase secret key, service-role key, or Gemini API key to this repository.

## Step 1 — Configure Google Cloud

1. Open https://console.cloud.google.com/.
2. Create or select a Google Cloud project named **Hisaab AI**.
3. Open **APIs & Services → Library**.
4. Search for **Google Sheets API** and enable it.
5. Open **Google Auth Platform → Branding**.
6. Enter the app name **Hisaab AI**, your support email, and developer email.
7. Open **Audience**, select **External**, and keep the app in testing mode.
8. Add your Gmail address and every tester's Gmail address under **Test users**.
9. Open **Data Access** and add these scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/spreadsheets`
10. Open **Clients → Create client → Web application**.
11. Add this exact authorized redirect URI:

    `https://ydnpucuwnloutfqiycub.supabase.co/auth/v1/callback`

12. Create the client, then copy its **Client ID** and **Client Secret**.

## Step 2 — Enable Google login in Supabase

1. Open your Supabase project:
   https://supabase.com/dashboard/project/ydnpucuwnloutfqiycub
2. Go to **Authentication → Sign In / Providers → Google**.
3. Enable Google.
4. Paste the Google Client ID and Client Secret from Step 1.
5. Save the provider.
6. Go to **Authentication → URL Configuration**.
7. Set **Site URL** to:

   `https://ahmadok12.github.io/AI-Cash-Manager/`

8. Add these **Redirect URLs**:
   - `https://ahmadok12.github.io/AI-Cash-Manager/`
   - `http://localhost:5173/`

If your GitHub username or repository name is different, replace the GitHub
Pages address everywhere before testing.

## Step 3 — Create the Gemini API key

1. Open https://aistudio.google.com/.
2. Create a Gemini API key.
3. Restrict it to the Gemini API where that option is available.
4. Keep it private. Do not put it in `public/config.js`, GitHub, or any frontend file.

The Edge Function defaults to the stable `gemini-3.5-flash` model.

## Step 4 — Install the tools locally

1. Install Node.js 22 from https://nodejs.org/.
2. Extract this project ZIP.
3. Open the extracted project folder in Windows Terminal, PowerShell, or VS Code.
4. Check that Node and npm work:

```bash
node --version
npm --version
```

5. Install the project dependencies:

```bash
npm install
```

The Supabase CLI is run through `npx`, so a separate global installation is not required.

## Step 5 — Link and configure Supabase

Run these commands from the extracted project folder:

```bash
npx supabase login
npx supabase link --project-ref ydnpucuwnloutfqiycub
npx supabase secrets set GEMINI_API_KEY=PASTE_YOUR_PRIVATE_GEMINI_KEY_HERE
npx supabase secrets set GEMINI_MODEL=gemini-3.5-flash
npx supabase secrets set ALLOWED_ORIGINS=https://ahmadok12.github.io
npx supabase functions deploy parse-transaction
```

Important:

- Replace only `PASTE_YOUR_PRIVATE_GEMINI_KEY_HERE`.
- Do not add a trailing slash or repository path to `ALLOWED_ORIGINS`.
- The function requires a signed-in Supabase user before it calls Gemini.

## Step 6 — Upload the app to GitHub

1. Sign in at https://github.com/.
2. Create a new repository named exactly **AI-Cash-Manager**.
3. Choose **Public** for the simplest GitHub Pages deployment.
4. Do not initialize it with another README if you plan to upload this full package.
5. Extract the ZIP on your computer.
6. Upload every file and folder from inside the extracted project folder, including:
   - `.github`
   - `public`
   - `src`
   - `supabase`
   - all root files
7. Commit the files to the `main` branch.

If GitHub's web uploader hides `.github`, upload with GitHub Desktop or Git:

```bash
git init
git add .
git commit -m "Deploy Hisaab AI Cash Manager"
git branch -M main
git remote add origin https://github.com/ahmadok12/AI-Cash-Manager.git
git push -u origin main
```

## Step 7 — Turn on GitHub Pages

1. Open the GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Open the repository's **Actions** tab.
5. Wait for **Deploy GitHub Pages** to show a green check.
6. Open:

   `https://ahmadok12.github.io/AI-Cash-Manager/`

The included workflow automatically rebuilds and redeploys the app after every
push to `main`.

## Step 8 — Test the complete flow

1. Open the GitHub Pages URL.
2. Go to **Settings → Connect Google Sheets**.
3. Choose a Google account that is listed as a Google OAuth test user.
4. Approve the requested profile and spreadsheet permissions.
5. After returning to Hisaab, tap **Connect Google Sheets** again if necessary.
6. Confirm that **Hisaab AI Cashbook** is created in that Google account.
7. Add an opening balance.
8. Record these test transactions:
   - `500 rs Imran se liye` → Money in
   - `2000 rs diye chaye wale ko` → Money out
   - `50000 Meezan Bank main jama karwaye` → Money out / Deposited
   - `20000 Meezan Bank se nikalwaye` → Money in / Withdrawn
9. Test Voice, Chat, and Manual entry.
10. Complete **Close today's cash** and verify the daily closing in Google Sheets.

## Troubleshooting

- **Google 403 / Access blocked:** Add that Gmail address under Google OAuth test users and confirm Google Sheets API is enabled.
- **Redirects to the wrong page:** Make the Supabase Site URL and Redirect URL exactly match `https://ahmadok12.github.io/AI-Cash-Manager/`, including the trailing slash.
- **Gemini uses Smart Mode fallback:** Confirm the Edge Function is deployed and all three function secrets exist.
- **Function returns 401:** Sign out, reconnect Google, and retry. The Gemini function requires a valid user session.
- **CORS error:** Set `ALLOWED_ORIGINS` to `https://ahmadok12.github.io` only.
- **Sheet does not open or sync:** Reconnect Google. Google provider access tokens expire and may need renewed consent.
- **GitHub Action fails:** Open the failed job, expand the red step, and confirm that all files—including `package-lock.json`—were uploaded.

## Security check before user testing

- Gemini key exists only in Supabase Edge Function secrets.
- No Supabase secret/service-role key is in GitHub.
- `public/config.js` contains only the project URL and publishable key.
- Google OAuth remains in testing mode with only approved testers.
- The deployed Edge Function rejects unknown browser origins.
