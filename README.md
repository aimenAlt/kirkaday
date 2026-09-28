# kirkaday

Pre-launch site for KirkaDay, served at https://kirka.day (Vercel, production branch `main`).

- Static pages: `index.html`, `join.html`, `thanks.html`, `wholesale.html`, `wholesale/thanks.html`,
  `privacy.html`, `404.html`. Shared header/footer styles live in `assets/site.css`.
- `vercel.json`: clean URLs, no trailing slash, `/log` → https://log.kirka.day (301).
- `api/subscribe.js`: signup endpoint → Beehiiv. Needs `BEEHIIV_API_KEY` set in the Vercel
  project's environment variables (optional `BEEHIIV_PUBLICATION_ID`). Beehiiv custom fields
  `zip` and `source` must exist on the publication.
- Latest video on the home page: set `LATEST_YOUTUBE_ID` at the top of the page script in `index.html`.
- Wholesale form: Tally form `aQ7Q7W`, embedded on `/wholesale`.

Tooling (not deployed, see `.vercelignore`):

- `node api/_test/subscribe.test.mjs` runs the endpoint checks with Beehiiv mocked.
- `node scripts/og/build.mjs` re-renders the 1200x630 previews in `assets/og/` (Playwright).
