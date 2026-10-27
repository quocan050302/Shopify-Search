# Validation: KH-02 free provider integration

Baseline reviewed: `bd2613f4fed6f53bd37b9f5abb17fbc4f06c0751` on `feature/kh02-v12.1.3-runtime-truth-closure`.

- Real Google MCP query: PASS, no fixture. Exact advertiser `AR01709643824168435713`, creative `CR02617007969560166401`, requested region US; see GOOGLE_LIVE_QUERY.json. Installation succeeded inside the isolated checkout. No user production installation was modified.
- New provider contract tests: 13/13 PASS. Includes SerpApi Free quota gating, requested date range, epoch timestamps, unknown/paid/exhausted balances, secret-safe errors, HasData current video fields and Free quota gating, nested Google creative metadata and failed-query classification. HasData and SerpApi HTTP responses in these tests are fixtures, not live evidence.
- Discovery + new provider tests after final discovery changes: 20/20 PASS.
- Focused provider checks including V12.2.2 diagnostics: 36/36 PASS before final small account-validation and UI-label changes; the changed contract tests were rerun and passed afterward.
- KH-01 regression: 69/69 PASS.
- Full KH-02 unit suite: 164/166 PASS. Two Meta diagnostics assertions expect SOURCE_ACCESS_VERIFIED but receive NOT_CONFIGURED in this checkout without a Meta collector. Names: `kh02V12_1_2_RuntimeOwnership: reports truthful provider readiness without hardcoded SOURCE_DATA_VERIFIED`; `kh02V12_1_4_2_Reliability: truthfully diagnoses Meta Ads as SOURCE_ACCESS_VERIFIED`. These were not weakened or removed.
- ESLint on new component, setup script, rewritten demand provider and contract tests: PASS.
- TypeScript source check before Next generated route types: PASS. Production build does not pass; see below.
- Chromium functional UI check against an isolated SQLite database: PASS, 4 setup guides, correct HasData and SerpApi links, no page errors. Webpack fallback does not load the repository's Turbopack-only Tailwind loader, so this is not a styled visual acceptance result.
- `git diff --check`: PASS.

## Build limitations

The default Turbopack build cannot create a Prisma junction under the Windows sandbox (Access denied). `next build --webpack` compiles successfully, then Next route type validation fails on existing extra exports in unchanged files:

- `src/app/api/v1/media/upload/route.ts`: `validateVideoMagicBytes`.
- `src/app/api/v1/test/db-observation/route.ts`: `resolveDbObservationSecurityContext`.
- `src/app/explorer/page.tsx`: `resolveExplorerScope`.

No production-ready verdict is claimed. These build errors and the two Meta-environment assertions remain outside this provider patch.

## Personal-account limitations

No HasData key, SerpApi key or TikTok session was supplied. Therefore live TikTok Organic, live Trends and automated TikTok Ads US remain unverified. Unknown HasData quota/plan schemas remain blocked; the actual account response must explicitly identify a Free plan and a sufficient balance. No paid mode or auto-renew was enabled, and no user accounts were registered.
