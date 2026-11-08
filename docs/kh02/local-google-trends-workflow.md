# Free local Google Trends workflow

Open `/products/trends` from Product Finder. Select an existing workspace product, choose its exact search term, open the official US/12-month Explore link, download the **Interest over time** CSV and select it in the app. File selection automatically validates, saves completed periods to ProductDemandObservation, reads them back and evaluates the existing G15/G16 functions. Use **Re-evaluate** after an authorized review or application restart.

Acquisition remains user-assisted. On 2026-11-08 `https://trends.google.com/robots.txt` disallows `/explore?` and `/trends/explore?`. No automatic Explore scraper, hidden Trends endpoint, pytrends, paid provider, proxy, CAPTCHA workaround or Alpha entitlement is introduced. Google documents the export at https://support.google.com/trends/answer/4365538 and gated Alpha access at https://developers.google.com/search/apis/trends. The API returns `automaticAcquisitionAvailable=false`.

## Evidence and business authority

A file plus user-supplied source URL proves neither Google origin nor SKU attribution. Unapproved uploads may be persisted for research but remain unverified under G15. This flow does **not** create approval records, signing keys, approvers or query aliases. Existing business approval can be reused via an `authorityId` supplied to the API, or discovered by the current authority verifier. It must match hash, workspace, product, term, geography and availability; a supplied invalid authority is rejected. Existing G15/G16 thresholds and source authority logic are unchanged.

`POST /api/v1/demand/local-trends` accepts exactly `productId`, `query`, `sourceUrl`, `rawCsv` and optional `authorityId`. It uses the existing research principal/workspace authorization, rejects cross-origin browser writes and bounds body/CSV/row counts. No external calls occur during import or evaluation. Future/incomplete periods are excluded, conflicting re-exports return 409, and re-uploading identical observations skips duplicates. Independently scaled CSVs are never merged for evaluation.

The existing original CSV store retains immutable content-addressed bytes. A SOURCE_SUBMITTED research-evidence receipt binds upload context to the product. G15/G16 output is computed from DB readback and a server-side saved candidate where available; a product row/PDP alone never acquires verified identity. Missing identity, advertising evidence, source approval or demand remains a gate failure. No winner snapshot is published automatically.

Partial outcomes are explicit: observation transactions are atomic, but an evaluation/audit-receipt failure after commit is reported as committed rows with evaluationError/warning. Re-evaluation reads the latest stored receipt. No zero-row or partial failure is presented as a verified winner.
