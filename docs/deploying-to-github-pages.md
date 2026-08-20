# Deploying to GitHub Pages

This app is a static SPA with no backend, so GitHub Pages can host it as-is. This repo is
already set up for the easiest option below — you only need one manual step in GitHub's UI.

## Recommended: auto-deploy with GitHub Actions

**Already in this repo:**
- `.github/workflows/deploy.yml` — builds the app and publishes `dist/` on every push to `main`
  (and on manual trigger).
- `vite.config.ts` has `base: './'` — this makes every built asset path relative
  (`./assets/...` instead of `/assets/...`), so the site works at whatever subpath GitHub Pages
  serves it from (`https://<user>.github.io/<repo>/`) without hardcoding the repo name anywhere.
  This only works because the app has no client-side routes; don't add a router without
  revisiting this.

**What you need to do, once:**

1. Push this repo to GitHub (if you haven't already):
   ```sh
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions.**
   (Not "Deploy from a branch" - that's the other, manual option below.)
3. Push to `main` (or re-run the workflow from the **Actions** tab). The workflow builds and
   deploys automatically.
4. Your site is live at `https://<you>.github.io/<repo>/`. GitHub shows the exact URL on the
   Pages settings screen once the first deployment finishes.

From here on, every push to `main` redeploys automatically - nothing else to remember.

## Alternative: manual deploy from a branch (no Actions)

If you'd rather not use GitHub Actions at all:

```sh
npm install -D gh-pages
```

Add to `package.json` scripts:
```json
"deploy": "npm run build && npx gh-pages -d dist"
```

Then whenever you want to publish the current code:
```sh
npm run deploy
```

This pushes `dist/` to a `gh-pages` branch. On GitHub: **Settings → Pages → Build and
deployment → Source → Deploy from a branch**, pick `gh-pages` / `/(root)`. Unlike the Actions
setup, this does **not** auto-update on push - you have to remember to run `npm run deploy`
after each change you want published.

## Notes

- The site is entirely client-side: form state and drafts live in the visitor's own browser
  (`localStorage`), and GitHub pushes go through the visitor's own logged-in GitHub session
  (see `src/lib/github.ts`). There's nothing to configure server-side either way.
- If you ever add client-side routing (e.g. React Router), GitHub Pages needs the
  [SPA fallback trick](https://github.com/rafgraph/spa-github-pages) (a `404.html` that
  redirects back to `index.html`) since it has no server-side rewrite rules. Not needed today -
  this app has a single route.
