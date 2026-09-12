# Browser flow regression

`npm ci`, `npx playwright install chromium`, then `npm run test:e2e` run the normal `index.html` → `src/main.tsx` application at 360×640, 390×844 and 430×844.

The dedicated Vite development server does not load `.env` files or build an AIT. It fixes runtime configuration to dummy local values and uses production React to match the deployed app lifecycle. It aliases only `@apps-in-toss/web-framework`: the real App, TDS provider/dialogs, House, PlayScene, RevealCard, API client, SVG verification, reward controller and image download/decode buffer all run in Chromium.

Playwright intercepts the dummy local API with stateful sessions, ticket accounting and idempotent photo grants. Photo bytes and the exact treat image URLs are local fixtures. TDS font requests receive an empty local stylesheet and use system fonts. Unexpected external requests are blocked and fail the test. No Supabase server, ad network, submission or production credentials are used.

Scenarios cover two free visits followed by an earned ad visit, cancellation, failed native load, duplicate earned events, manual return, owner/replay preparation without grants, one decoded photo download, slow photo skeletons, and leaving during preparation or download. All input uses browser touch events. Timing evidence records the third touch, the real client's HTTP request and the modal insertion. Playwright retains failure traces/screenshots; each test attaches its API, native event and timing evidence. The successful complete journey also saves a screenshot.

`multi-user.spec.ts` uses separate browser contexts for A (the uploader) and B (a viewer), including a second fresh B context. B collects a photo, favorites it, reopens the persisted favorite from the album in the fresh context, removes it, and opens the still-owned photo again. A's real MyPets screen reloads the aggregate count as 0 → 1 → 0. Each account has separate local storage, API identity, tickets and photo state; only the fixture favorite table is shared. The fixture begins with a creator-approved dog. It does not perform or imply publication approval, simulate a successful upload screen, or prove real database cross-user permissions.

`npm run test:e2e:dev` starts a separate development React run through the same `main.tsx` and checks StrictMode's effect cleanup/remount plus a fresh page reload. It protects against the first house request being aborted without a replacement. Its report is in `playwright-report/development`.

`npm run test:server` runs isolated PGlite SQL tests plus actual Edge-handler tests with a denied network permission. It uses the pinned Deno development dependency and local npm modules; `DENO_BIN` can override its executable. Module downloads are disabled with `--cached-only`. This command never runs `check-pet-api-boundary.mjs`, which is a separate production smoke check.

The server command also includes the existing review-console HTTP security tests (ephemeral localhost server and injected gateway/photo transport), AIT storage tests (temporary fake bytes, not real build candidates), release flag validation and approved-pool fixtures. All `supabase/migrations/*.node-test.mjs` files are discovered, including the multi-user SQL journey. No production review decision, AIT promotion, pool query or notification is made.

`npm run test:regression` runs Vitest and both application/browser type checks. `npm run test:flows` runs the server, regression, production React browser suite and development smoke in order and stops on failure. Historical `.tmp`/AIT trees and browser specs are excluded from Vitest.

## QA coverage boundaries

| Area | Automated checks in this repository | Separate release verification |
| --- | --- | --- |
| Ads and photo reveal | Chromium normal App → actual API client/reward controller → SDK callbacks; actual Edge handler; PGlite credit consumption, cancellation and retry | Android/iOS native ad presentation, inventory/fill, dismissal ordering and the exact candidate AIT |
| Favorites and uploader counts | Multi-user Chromium sessions and fresh-session album reopen; App rollback/late-response tests; PGlite idempotency, ownership and preserved grants | Cross-user behavior against a designated non-production backend; real PostgreSQL concurrent connections |
| Upload and creator review | UploadFlow input/retry tests, API upload receipt tests, submission/review SQL, localhost review HTTP authority/SVG checks | Device picker → actual compression/upload → pending owner view → explicit creator confirmation → another user's view; no continuous Chromium or device upload journey is claimed |
| Share reward | Native bridge unit tests, App recovery tests, event-specific SQL credits and conflicts | Native invitation → callbacks → actual Edge recording → spending/relaunch recovery; browser fixture deliberately leaves sharing unsupported |
| Recharge notifications | App agreement/denial/disable tests; policy and sender tests; composed SQL → actual worker → AES decrypt → sender/response parser → final transport fixture, including confirmed-once, opt-out and uncertain-result no-resend; night deferral rules | Native agreement UI, template/consent wiring, worker HTTP entry point and receipt by an explicitly designated test recipient; browser fixture deliberately leaves notifications unsupported |

The current actual-Edge suite covers `photoPrepare`, final owner-photo signing failure/retry, and earned ads. It does not claim actual entry-point coverage for upload/share/favorite dispatch or the notification worker. Passing fake transport and PGlite checks is not evidence of a deployed database, a running schedule, push delivery, SDK availability or real ad inventory.

Before deploying the Edge code that adds `photoPrepare`, apply and verify the additive `supabase/migrations/20260912000100_photo_prepare_rate_limit.sql` migration. The prior SQL action constraint rejects `photoPrepare`; deploying only the handler would leave preparation unavailable. SQL application, Edge deployment, AIT build/upload and individual dog publication are distinct steps. Exact operational gates and current QA results belong in `docs/QA_STRATEGY.md`.

These checks verify browser behavior with deterministic host responses. Actual native rendering, ad inventory, server deployment and AIT upload remain separate release checks.
