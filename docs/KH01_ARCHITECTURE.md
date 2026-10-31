# KH-01 — System Architecture & Component Design
**SWAI V11.4 — Competitor Product, Offer & Funnel Intelligence Engine**

## 1. System Overview

SWAI V11.4 introduces the **KH-01 Engine**, transforming SWAI from an ad library browser into an evidence-based ecommerce research and decision platform for Shopify operators in the United States. 

The core architecture operates under the `RESEARCH_ONLY` doctrine:
- **No data fabrication**: Competitor conversion rates, revenues, ROAS, ad spend, and supplier prices are never fabricated or simulated.
- **Evidence vs Inference**: Measurable storefront observations (`SOURCE_OBSERVED`) are strictly segregated from user inputs (`USER_ENTERED`), user assumptions (`USER_ESTIMATED`), and analytical heuristics (`MODEL_INFERRED`).
- **Explainable Decision Gates**: Readiness for product testing requires passing explicit evidence-backed gates across 6 foundational pillars.
- **Lightweight by default**: Controlled concurrency (1 job default), bounded timeouts (8s), strict redirect limits (3 hops), payload ceilings (2MB), and no automatic DOM crawling on page renders.

---

## 2. Architectural Diagram

```mermaid
flowchart TD
    subgraph UI ["Frontend (Next.js 16 + React 19)"]
        A1[Meta Ads Explorer] -->|Select Ad| A2[AdDetailDrawer]
        A2 -->|Identify Product| A3[Candidate Modal]
        A3 -->|Confirm / Link| A4[Product Intelligence Workspace]
        A4 --> P1[1. Product Panel]
        A4 --> P2[2. Creative Panel]
        A4 --> P3[3. Offer Panel]
        A4 --> P4[4. Landing Page Panel]
        A4 --> P5[5. Economics Panel]
        A4 --> P6[6. Fulfillment Panel]
        A4 --> P7[7. Decision Audit Panel]
    end

    subgraph API ["REST API Layer (/api/v1/research)"]
        R1[/products/from-ad]
        R2[/products/:id/overview]
        R3[/products/:id/landing-page-jobs]
        R4[/jobs/:jobId]
        R5[/products/:id/offers]
        R6[/products/:id/funnel]
        R7[/products/:id/economics]
        R8[/products/:id/fulfillment]
        R9[/products/:id/opportunity]
        R10[/products/:id/decisions]
    end

    subgraph Services ["Domain Services Layer"]
        S1[researchAuthService]
        S2[productIdentityService]
        S3[linkValidationService]
        S4[landingPageInspectionService]
        S5[funnelAnalysisService]
        S6[offerExtractionService]
        S7[economics.ts]
        S8[fulfillmentAssessmentService]
        S9[opportunityAssessmentService]
        S10[evidenceService]
    end

    subgraph Worker ["Background Worker (kh01Worker)"]
        W1[SyncJob Queue: KH01_LANDING_PAGE_RESEARCH]
        W2[Atomic Claim & Lease: Concurrency = 1]
        W3[Bounded Fetch & Parser]
        W4[Snapshot Persistence & Evidence Creation]
    end

    subgraph DB ["Prisma 7 + SQLite / libSQL Storage"]
        D1[(CompetitorAd / Advertiser)]
        D2[(ResearchProduct / CompetitorStore / AdProductLink)]
        D3[(ResearchEvidence)]
        D4[(CompetitorOfferSnapshot)]
        D5[(LandingPageSnapshot)]
        D6[(ProductEconomicsScenario)]
        D7[(SupplierQuote / FulfillmentAssessment)]
        D8[(ProductOpportunityAssessment / ResearchDecision)]
    end

    UI --> API
    API --> Services
    Services --> DB
    Worker --> Services
    Worker --> DB
```

---

## 3. Core Modules & Responsibilities

| Module | File Location | Key Functions |
|---|---|---|
| **Security & Auth** | `src/services/research/researchAuthService.ts` | `resolveAuthorizedResearchContext`, `assertAdWorkspaceAccess`, `assertProductWorkspaceAccess` |
| **URL Hardening** | `src/services/links/linkValidationService.ts` | `validatePublicResearchUrl`, `fetchPublicResearchPage` |
| **Product Identity** | `src/services/research/productIdentityService.ts` | `extractProductIdentityCandidate`, `resolveCompetitorStore`, `resolveOrCreateResearchProduct`, `attachAdvertisementToProduct`, `getProductAdvertisingProfile` |
| **Offer Intelligence** | `src/services/research/offerExtractionService.ts` | `extractStructuredProductOffer`, `extractPromotionalOffer`, `normalizeCompetitorOffer`, `persistCompetitorOfferSnapshot`, `compareCompetitorOffers` |
| **Funnel & CRO** | `src/services/research/funnelAnalysisService.ts` | `extractPageStructure`, `inspectTrustSignals`, `inspectAboveTheFold`, `inspectOfferPresentation`, `inspectMessageMatch`, `analyzeCompetitorFunnel` |
| **Landing Inspection** | `src/services/research/landingPageInspectionService.ts` | `createLandingPageResearchJob`, `executeLandingPageResearchJob`, `parsePublicLandingPage` |
| **Snapshots** | `src/services/research/landingPageSnapshotService.ts` | `saveLandingPageSnapshot`, `compareLandingPageSnapshots` |
| **Unit Economics** | `src/lib/economics.ts` | `parseMoney`, `calculateOrderEconomics`, `buildOfferEconomicsScenario`, `compareEconomicsScenarios`, `evaluateEconomicsEligibility` |
| **Fulfillment Risk** | `src/services/research/fulfillmentAssessmentService.ts` | `recordSupplierQuote`, `calculateFulfillmentRisk`, `identifyCriticalFulfillmentGaps`, `saveFulfillmentAssessment` |
| **Opportunity Assessment** | `src/services/research/opportunityAssessmentService.ts` | `evaluateProductPillar`, `evaluateCreativePillar`, `evaluateOfferPillar`, `evaluateLandingPagePillar`, `evaluateEconomicsPillar`, `evaluateFulfillmentPillar`, `calculateOpportunityAssessment`, `evaluateSmallTestReadiness`, `explainOpportunityRecommendation` |
| **Evidence Provenance** | `src/services/research/evidenceService.ts` | `createResearchEvidence`, `evaluateEvidenceReadiness` |
| **Background Worker** | `src/workers/kh01Worker.ts` | `claimPendingKh01Job`, `executeKh01Job`, `persistKh01Heartbeat`, `recoverInterruptedKh01Jobs`, `stopKh01Worker` |
| **Diagnostics Doctor** | `scripts/kh01Doctor.ts` | Automated sanity check for DB connection, schema models, resource budgets, and tenant isolation |

---

## 4. Tenant Isolation & Authorization Protocol

Every mutation and read in the KH-01 research API executes within a resolved `ResearchAccessContext`:
```typescript
export interface ResearchAccessContext {
  workspaceId: string;
  actorId: string | null;
  accessMode: "AUTHENTICATED" | "EXPLICIT_LOCAL_DEV";
}
```
1. Caller-supplied headers (`x-workspace-id`) or query params are validated against authorized session cookies (`swai_admin_token`) or verified server state.
2. In production or authenticated environments, missing or invalid credentials throw `HTTP 401 Unauthorized`.
3. In local development mode (`NODE_ENV === "development"` or `SWAI_DEV_ALLOW_LOCAL === "true"`), a safe local default context is resolved, but ownership boundaries are strictly verified.
4. Ad and product access verify actual database ownership or linkage; cross-workspace operations are rejected with `HTTP 403 Forbidden`.
