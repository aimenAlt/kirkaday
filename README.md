# kirkaday

Pre-launch site for KirkaDay, served at https://kirka.day (Vercel, production branch `main`).

- Static pages: `index.html`, `join.html`, `thanks.html`, `wholesale.html`, `wholesale/thanks.html`,
  `privacy.html`, `404.html`. Shared header/footer styles live in `assets/site.css`.
- `vercel.json`: clean URLs, no trailing slash, `/log` → https://log.kirka.day (301).
- `api/subscribe.js`: signup endpoint → Beehiiv, single opt-in (active at once,
  welcome email sent; bots filtered by honeypot and a 2-second minimum on the form). Needs `BEEHIIV_API_KEY` set in the Vercel
  project's environment variables (optional `BEEHIIV_PUBLICATION_ID`). Beehiiv custom fields
  `zip` and `source` must exist on the publication.
- `api/drink.js`: saves the /thanks go-to-drink poll answer to the subscriber's `go_to_drink`
  custom field (created on first use if missing). Same env vars.
- Latest video on the home page: set `LATEST_YOUTUBE_ID` at the top of the page script in `index.html`.
- Wholesale form: Tally form `aQ7Q7W`, embedded on `/wholesale`.

Tooling (not deployed, see `.vercelignore`):

- `node api/_test/subscribe.test.mjs` and `node api/_test/drink.test.mjs` run the endpoint checks
  with Beehiiv mocked.
- `node scripts/og/build.mjs` re-renders the 1200x630 previews in `assets/og/` (Playwright).
