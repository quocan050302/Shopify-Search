# KH-02 V19.3.3.4 — 07_ALTERNATIVE_G15_DATA_SOURCE_FEASIBILITY.md

Audited code: `f2ab3e34e080ac5558176109f99f0c6bd9e817b8`; branch `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`. Retrieved/executed 2026-11-08 (Asia/Ho_Chi_Minh).

No tested free source supplies scalable, independently verifiable longitudinal demand for arbitrary competitor SKUs under current access.

| Source | Classification | What it measures / history / geography | Attribution, access, reproducibility and cost | G15 suitability |
|---|---|---|---|---|
| Official Trends CSV | VIABLE_WITH_MANUAL_INPUT | Relative US search interest; three actual year-long weekly exports | Zero paid charges; immutable bytes/query/geo/capture provenance can be retained; independent SKU attribution and approved import still required | Best immediate demand pilot; no automatic eligibility |
| Official Trends Alpha | ACCESS_RESTRICTED | Official five-year country/subregion historical interest | Limited alpha; no account entitlement established; do not assume quota or apply automatically | Future candidate, not viable now |
| BigQuery top/rising terms | NOT_PRODUCT_ATTRIBUTABLE | Official US DMA daily history can span years | Sandbox requires independently verified no-billing configuration; only top/rising terms, not arbitrary SKU terms | Context/discovery; sparse niche coverage |
| Merchant-authorized Shopify order exports | VIABLE_WITH_MANUAL_INPUT | Actual dated orders; US geography and line-item SKU possible if merchant grants access | Requires merchant ownership/authorization, complete exports, privacy minimization and timestamp provenance. API defaults to 60 days; older access needs appropriate scopes. No merchant account added | Strong SKU demand only for participating merchants; separate reviewed source model required |
| Merchant-owned Search Console | ACCESS_RESTRICTED | Dated own-property search performance, country and page filters | Requires authorized property access; competitor access not available. PDP/page-query mapping can still aggregate multiple products; query omissions constrain completeness | Possible first-party corroboration after separate review, not a competitor data substitute |
| Wikimedia pageviews | NOT_PRODUCT_ATTRIBUTABLE | Long historical article attention | Public documented API; language is not US geography and articles are not merchant SKUs | Unsuitable for current gate |
| Marketplace snapshot/rank | INSUFFICIENT_HISTORICAL_DEPTH | Current price, offer and possibly current rank | A current snapshot or old review date does not reconstruct historical demand. Third-party historical providers may be paid; not called | No substitution for longitudinal evidence |
| Ad age / first shown / creative count | NOT_PRODUCT_ATTRIBUTABLE | Advertising activity | Not search demand or sales; same SKU can have many creatives | Not G15 |
| HasData TikTok | UNSUPPORTED_OR_POLICY_BLOCKED | No current evidence obtained | Project policy disabled, no key, credit consumption forbidden | No role |

Recommended separate architecture proposal: keep raw acquisitions immutable and distinguish observation period, provider capture, local import, approval, revocation and first-availability timestamps. Bind each approval to hash + workspace + canonical merchant product + exact term/geo/cadence. Preserve family-demand evidence separately from SKU-demand evidence. Use source-specific adapters and coverage/attribution policies, with point-in-time exports for DEV/HOLDOUT. Do not give a newly collected old-dated series historical availability before acquisition.

For a small curated research workflow, finish approved CSV review and product binding first. For a fully automated many-niche competitor product, the demonstrated coverage is insufficient: negotiate an authorized source or separately review a merchant-participation model. No gate or ranking change is implemented.

References: [Shopify order access scopes](https://shopify.dev/docs/api/usage/access-scopes), [Search Console query API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [Wikimedia pageview API](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html). These are feasibility proposals; none is represented as connected or executed here.
