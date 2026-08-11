# Deployment guide: GitHub Pages + Supabase + Gemini + Google Sheets

Use a separate Supabase project for Hisaab. Do not reuse the SCS Tracking or SCS ERP projects.

## 1. Create the Supabase project

1. Sign in at https://supabase.com/dashboard.
2. Select **New project**.
3. Name it **Hisaab AI Cash Manager**.
4. Choose the nearest region and create the project.
5. Open **Project Settings → Data API** and copy:
   - Project URL, such as `https://abc123.supabase.co`
   - Publishable key beginning with `sb_publishable_`
6. Open `public/config.js` in this project and replace both placeholders.

The publishable key is designed for browser use. Never put a Supabase secret/service-role key in this file.

## 2. Configure Google Cloud

1. Go to https://console.cloud.google.com/ and create a project named **Hisaab AI**.
2. Open **APIs & Services → Library** and enable **Google Sheets API**.
3. Open **Google Auth Platform → Branding** and enter the app name and contact emails.
4. Under **Audience**, choose **External**.
5. Keep the app in testing mode and add each tester's Gmail address under **Test users**.
6. Under **Data Access**, add these scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/spreadsheets`
7. Open **Clients → Create client → Web application**.
8. Add this authorized redirect URI, replacing `YOUR_PROJECT_REF`:

   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`

9. Create the client and copy the Google Client ID and Client Secret.

## 3. Enable Google login in Supabase

1. In Supabase, open **Authentication → Providers → Google**.
2. Enable Google.
3. Paste the Google Client ID and Client Secret.
4. Save.
5. Open **Authentication → URL Configuration**.
6. Set **Site URL** to your final GitHub Pages URL:

   `https://YOUR_GITHUB_USERNAME.github.io/AI-Cash-Manager/`

7. Add the same address under **Redirect URLs**. For local testing also add `http://localhost:5173/`.

## 4. Create and secure the Gemini key

1. Go to https://aistudio.google.com/.
2. Create a Gemini API key.
3. Restrict it to the Gemini API where available.
4. Do not paste the key into `public/config.js`, GitHub, or any frontend file.

## 5. Deploy the Supabase Edge Function

Install the Supabase CLI, sign in, then run these commands from the project folder:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set GEMINI_API_KEY=YOUR_PRIVATE_GEMINI_KEY
npx supabase secrets set GEMINI_MODEL=gemini-3.5-flash
npx supabase secrets set ALLOWED_ORIGINS=https://YOUR_GITHUB_USERNAME.github.io
npx supabase functions deploy parse-transaction
```

`verify_jwt = true` is already configured in `supabase/config.toml`, so only signed-in users can consume the Gemini endpoint. `ALLOWED_ORIGINS` accepts a comma-separated list if you later add another domain.

## 6. Upload to GitHub

1. Create a GitHub repository named **AI-Cash-Manager**.
2. Upload all files and folders from this project, including `.github` and `supabase`.
3. Commit to the `main` branch.
4. Open **Repository Settings → Pages**.
5. Under **Build and deployment → Source**, select **GitHub Actions**.
6. Open the **Actions** tab. The **Deploy GitHub Pages** workflow will build and publish the site.
7. When it finishes, open:

   `https://YOUR_GITHUB_USERNAME.github.io/AI-Cash-Manager/`

If your repository name differs, use that exact repository name in the URL and in Supabase's Site URL/Redirect URLs.

## 7. User-testing flow

Each tester should:

1. Open the GitHub Pages URL.
2. Press **Connect Google Sheets**.
3. Choose the Gmail account you added as a Google OAuth test user.
4. Approve profile and spreadsheet access.
5. After returning to Hisaab, wait for **Google Sheet created and connected**. The app automatically creates **Hisaab AI Cashbook** and synchronizes local entries.
6. Test voice, chat, and manual entries.
7. Add an opening balance, then confirm it appears as an opening transaction.
8. Complete **Close today's cash** and check that expected cash, counted cash, and any difference are clear.
9. Press the Google Sheets button to open the tester's sheet and confirm the transaction rows.

## 8. Troubleshooting

- **Google error 403 / access blocked:** add the Gmail address under Google OAuth test users and verify the Sheets API is enabled.
- **“Google hasn't verified this app”:** while the OAuth app is in Testing, use only Gmail addresses listed under **Google Auth Platform → Audience → Test users**. Approved testers may need to select **Advanced → Go to Hisaab AI**. To remove this warning for everyone, publish the OAuth app and complete Google's sensitive-scope verification for the Sheets permission.
- **Redirects to the wrong page:** make Supabase Site URL and Redirect URL exactly match the GitHub Pages URL, including the repository path and trailing slash.
- **Gemini falls back to Smart Mode:** verify the function is deployed and all three function secrets are present.
- **Function returns 401:** sign out/reconnect Google; the function requires a valid Supabase user session.
- **CORS error:** `ALLOWED_ORIGINS` must be the origin only, for example `https://ahmadok12.github.io`, without the repository path.
- **No sheet appears:** open **Settings → Reconnect Google Sheets**. The app validates any saved sheet ID, creates **Hisaab AI Cashbook** when needed, and shows the specific Google API error if creation fails.
- **Sheet does not open:** reconnect Google; Google provider access tokens expire and may need renewed consent.

## Security checklist before public testing

- Gemini key exists only in Supabase secrets.
- `verify_jwt` remains enabled.
- Google OAuth is in testing mode with only approved testers.
- No Supabase service-role or secret key exists in the repository.
- `public/config.js` contains only the Supabase URL and publishable key.
