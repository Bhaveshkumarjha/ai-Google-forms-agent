# AI Forms Agent

Chat with an AI, review a preview, confirm, and get a **real Google Form** (created in your own Google account).
Need file uploads (not possible through the Google Forms API)? The same chat can create a **custom form** hosted on this site, with 10 MB uploads and a responses dashboard.

Stack: Flask, Bootstrap 5, SQLite (PostgreSQL optional), Google OAuth 2.0, Google Forms API, Gemini API (free tier).

## What works

- Google sign-in, per-user dashboard, history with search, settings, delete account
- AI chat: describe a form, or paste your own questions and options, or upload PDF / DOCX / TXT (10 MB)
- Pasted/uploaded questions are parsed **locally first** (your wording and option order are kept exactly, and no AI quota is used). Only unstructured requests go to Gemini, and anything Gemini extracts from your text is checked against the source: invented wording is flagged in the preview
- Preview and editor: edit, add, delete, reorder, required flags, question types, quiz answer keys and points
- Question types: multiple choice, checkboxes, dropdown, true/false, short answer, paragraph, email, file upload (custom only)
- Google Form creation: create, add questions, quiz settings and answer keys, **publish** (API forms are unpublished by default), then return the real respondent link. Partial failures are reported honestly
- Custom forms: public link `/c/<slug>`, file uploads up to 10 MB per file (PDF, DOCX, TXT, PNG, JPG, checked by real content), quiz scoring, responses table, CSV export, authorized file download

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                    # then fill it in (see below)
python -c "import secrets; print(secrets.token_hex(32))"                              # -> SECRET_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # -> TOKEN_ENC_KEY
python app.py                                           # http://localhost:5000
```

No Google keys yet? Set `DEV_LOGIN=1` in `.env` to sign in with a fake local user and try custom forms and pasted questions. **Never enable DEV_LOGIN in production.**

Run the tests: `pip install pytest && pytest`

## Google Cloud setup (free)

1. console.cloud.google.com: create a project.
2. **APIs & Services > Library**: enable **Google Forms API**.
3. **OAuth consent screen**: user type External, add the scope `https://www.googleapis.com/auth/forms.body` (plus openid, email, profile). While the app is in **Testing**, add your Google accounts as **test users**.
4. **Credentials > Create credentials > OAuth client ID > Web application**. Authorized redirect URIs:
   - `http://localhost:5000/auth/google/callback`
   - `https://YOUR-APP.onrender.com/auth/google/callback` (after you deploy)
5. Put the client ID and secret in `.env`.

Things to know (check Google's current rules, they change):
- In **Testing** mode only listed test users can sign in, and (as far as I know) refresh tokens for external apps in testing expire after about 7 days, so users may need to reconnect from Settings.
- Letting the general public use the app needs **Google OAuth verification** for the Forms scope (privacy policy, homepage, review time). Unverified apps show a warning screen.
- The Forms API has its own quotas (see your Cloud Console). Quota errors are shown to the user.

## Gemini API (free tier)

1. aistudio.google.com/apikey: create a key. **Keep billing off.** Put it in `GEMINI_API_KEY`.
2. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. Google's docs listed `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.6-flash` and `gemini-3.8-flash` with free-tier pricing when this was written (2026-10-10); model names change, so if you see "model not found", update `GEMINI_MODEL`.
3. Free-tier quotas (requests per minute/day) are per **project**, not per user, so all your users share them. I could not read the exact numbers in the docs; see the rate-limit page in AI Studio. When the limit is hit the app shows a clear message and **never switches to a paid model**.
4. Google's pricing page says free-tier content **may be used to improve Google products**. The chat page warns users not to paste confidential data. Pasted question lists are parsed locally and never sent to Gemini.
5. The code calls the `generateContent` REST endpoint, which Google's docs describe as the legacy API (new projects are steered to the Interactions API). It still works, and all model output is validated server-side, but if Google retires it, `ai._call_gemini` is the only function to change.

## Deploy on Render (free tier, check current terms)

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn wsgi:app`
- Environment: all variables from `.env.example`, with `FLASK_DEBUG=0`, `TRUST_PROXY=1`, and **no** `DEV_LOGIN`.
- Add your Render URL's callback to the Google OAuth client.
- **Free-tier warning:** as far as I know, Render free web services sleep when idle and have an ephemeral disk, so **SQLite data and uploaded files can be lost** on restart or redeploy. For anything real, use a persistent PostgreSQL database (`DATABASE_URL=postgresql://...`) and move uploads to object storage. I did not verify Render's current free database terms.
- The rate limiter stores counters in memory per worker (`RATELIMIT_STORAGE_URI=memory://`). Use Redis if you scale to several workers.

## Security notes

- Google OAuth with state/nonce validation (Authlib), new session after login, HttpOnly + SameSite + Secure cookies
- Google tokens stored **encrypted** (Fernet); automatic refresh; revoked on account deletion
- CSRF protection on every POST (including fetch calls), rate limits on login, AI, upload and public submission routes
- Every record is checked against the signed-in owner and returns 404 otherwise
- Uploads: extension + size + real content check, random stored names, served only as attachments to the owner, never executed; DOCX zip-bomb guard
- Strict CSP, `nosniff`, no inline scripts; user and model text is rendered with `textContent` / Jinja escaping
- CSV export neutralises spreadsheet formulas; errors are logged server-side without secrets

## Known limits

- The Google Forms API cannot create file-upload questions (so those forms are custom), and an "Email" question becomes a plain short-answer question in Google Forms.
- Scanned or image-only PDFs are not supported (no OCR). Excel and image extraction are not built.
- If a Word document uses automatic list lettering (A., B.), the letters are not in the file text, so the local parser cannot see them; such documents fall back to Gemini.
- Deleting a form here does not delete it from Google Forms (the app only holds the forms.body scope).
- Tables are created with `db.create_all()`; add Flask-Migrate before changing the schema in production.
- Tested automatically: parsing, validation, request building and call order for the Google Forms API (with mocked HTTP), token refresh, Gemini handling (mocked), uploads, custom forms, ownership checks, CSRF, account deletion. **Not tested against real services:** the live Google OAuth round trip, real Google Forms API calls and real Gemini calls (they need your credentials).

## Project layout

```
app.py, wsgi.py        app factory, security headers, error pages
config.py              settings from environment
models.py              User, Draft, Message, Form, Submission
auth.py                Google OAuth routes
views.py               dashboard, chat, preview, create, history, responses, settings
public.py              public custom-form pages
ai.py                  validation, local question parser, Gemini
gforms.py              Google Forms API client
docextract.py          PDF / DOCX / TXT text extraction
filestore.py           safe upload validation
templates/, static/    Bootstrap UI
tests/                 pytest suite
```
