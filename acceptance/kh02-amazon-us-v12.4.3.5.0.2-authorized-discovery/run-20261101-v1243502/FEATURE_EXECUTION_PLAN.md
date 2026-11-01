# KH-02 V12.4.3.5.0.2 — Feature Execution Plan & Function Map

- **Branch**: `feature/kh02-amazon-us-pilot-v12.4.3.5.0`
- **Base (`origin/master`)**: `c1833362cf6634917f2ff94df19d97c393247d94`
- **Initial HEAD**: `5f32a0cf242f2d2de92489c4ee27a96b5d62ae7f`
- **Tested Source (`CODE_SHA`)**: `1e0cde43a14d54444e64ea1a7e890488e491ee11`
- **Release Version**: `12.4.3.5.0.2`

## Implemented & Repaired Functions
1. `src/services/kh02/marketplace/amazonCreatorsApiClient.ts`:
   - `resolveCreatorsApiEligibility(env, registrationStatus): AmazonAccessDecision`
   - `createCreatorsApiClient(config): CreatorsApiClient`
   - `searchItemsByCandidateIntent(intent, context): Promise<SearchItemsResponse>`
   - `getItemsByAsins(asins, context): Promise<GetItemsResponse>`
   - `classifyCreatorsApiFailure(error, response): ClassifiedCreatorsApiStatus`
2. `src/services/kh02/marketplace/amazonUsAuthorizedDiscoveryAdapter.ts`:
   - `deriveAmazonSearchIntents(candidate, niche, options): AmazonSearchIntent[]`
   - `planAmazonDiscoveryBudget(candidates, remainingBudget, policy): AmazonDiscoveryPlan`
   - `discoverAmazonProductsForCandidates(params): Promise<AmazonDiscoveryResult>`
   - `selectAmazonCandidateMatches(candidate, listings): AmazonMatchDecision[]`
   - `normalizeAmazonSearchItem(raw, invocation): NormalizedAmazonSearchItemResult`
   - `computeAmazonNonInflationDelta(beforeSnapshot, afterSnapshot): AmazonNonInflationComparisonResult` (BUG T2 repair)
3. `src/services/kh02/marketplace/amazonUsEvidenceAdapter.ts`:
   - `runAmazonUsPilotEnrichment` wired to `discoverAmazonProductsForCandidates` for candidates without explicit URLs
   - `fetchAuthorizedAmazonProductEvidence` wired to `getItemsByAsins` when Creators API client is active
4. `src/services/kh02/marketplace/amazonUsMcpTransport.ts` & `amazonUsIdentity.ts`:
   - `navigateAndCaptureProductSnapshot` preserves `httpStatus: null` (`UNOBSERVED_NULL`) when unobserved and rejects `isError: true` (BUG T4 repair)
5. `src/app/products/page.tsx`:
   - Exposes `data-amazon-brand`, `data-amazon-price`, `data-amazon-currency`, `data-amazon-availability`, `data-amazon-verification-scope`, `data-amazon-source-origin` for genuine 3-way DOM parity (BUG T3 repair)
