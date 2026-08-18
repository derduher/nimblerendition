# nimblerendition

The root of <https://nimblerendition.com> — a landing page linking to the apps
hosted on the domain, plus the two other files that belong at the root.

| Path            | Repo                                                  |
| --------------- | ----------------------------------------------------- |
| `/`             | this repo                                             |
| `/blaster/`     | [derduher/blaster](https://github.com/derduher/blaster) |
| `/threadwell/`  | [derduher/finproc](https://github.com/derduher/finproc) |
| `/hugos/`       | [derduher/hugos](https://github.com/derduher/hugos)   |

All four live in one S3 bucket behind one CloudFront distribution. Each app
deploys into its own prefix and may `--delete` inside it; **this repo never
uses `--delete`**, because at the root that would erase the apps.

## Layout

- `site/index.html` — the landing page. No build step; it is served as written.
- `site/sw.js` — a tombstone service worker. blaster used to be served from the
  domain root and left a root-scoped worker installed in every browser that
  ever played it. That worker would keep serving the old game in place of this
  page, and a worker only updates by re-fetching its own script — so this file
  has to sit at `/sw.js`, uncached, until returning visitors have picked it up.
  It clears the caches, unregisters itself, and reloads the tab.
- `site/favicon.svg` — the root favicon.

## Deploy

Pushing to `main` syncs `site/` to the bucket root and invalidates the root
paths. The workflow assumes an AWS role over OIDC and needs these Actions
variables on the `Production` environment: `AWS_ROLE_ARN`, `S3_BUCKET`,
`CLOUDFRONT_DISTRIBUTION_ID`, and optionally `AWS_REGION`.
