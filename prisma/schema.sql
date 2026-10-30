CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'RESEARCHER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "workspaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Default Research Workspace',
    "operatingMode" TEXT NOT NULL DEFAULT 'RESEARCH_ONLY',
    "targetMarket" TEXT NOT NULL DEFAULT 'US',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "workspace_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "data_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "capabilities" TEXT NOT NULL,
    "supportedRegions" TEXT NOT NULL,
    "rateLimitInfo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "provider_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "authDetails" TEXT,
    "lastTestedAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "provider_connections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provider_connections_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "advertisers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profileUrl" TEXT,
    "avatarUrl" TEXT,
    "domain" TEXT,
    "country" TEXT DEFAULT 'US',
    "verifiedStatus" TEXT NOT NULL DEFAULT 'OBSERVED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "ad_media_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'VIDEO',
    "videoUrl" TEXT,
    "embedUrl" TEXT,
    "thumbnailUrl" TEXT,
    "aspectRatio" TEXT DEFAULT '9:16',
    "durationSeconds" REAL,
    "width" INTEGER,
    "height" INTEGER,
    "availability" TEXT NOT NULL DEFAULT 'READY',
    "source" TEXT NOT NULL DEFAULT 'OFFICIAL_EMBED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ad_media_assets_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "ad_metric_observations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "metricValue" REAL,
    "textValue" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'OBSERVED',
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ad_metric_observations_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "competitor_stores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "advertiserId" TEXT,
    "domain" TEXT NOT NULL,
    "storeName" TEXT,
    "commercePlatform" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "country" TEXT DEFAULT 'US',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "competitor_stores_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertisers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "research_products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "description" TEXT,
    "imageUrl" TEXT,
    "currentPrice" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "productUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "research_products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "competitor_stores" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "product_price_observations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'STOREFRONT_HTTP',
    CONSTRAINT "product_price_observations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "ad_product_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'HIGH_CONFIDENCE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ad_product_links_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ad_product_links_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "creative_analyses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL DEFAULT 'gemini-1.5-pro',
    "hookType" TEXT NOT NULL,
    "hookQualityScore" REAL NOT NULL,
    "pacingScore" REAL NOT NULL,
    "ctaClassification" TEXT NOT NULL,
    "sellingPoints" TEXT NOT NULL,
    "weaknesses" TEXT NOT NULL,
    "scriptIdeas" TEXT,
    "rawAnalysis" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "creative_analyses_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "research_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "totalScore" REAL NOT NULL,
    "tier" TEXT NOT NULL,
    "longevityScore" REAL NOT NULL,
    "diversityScore" REAL NOT NULL,
    "performanceScore" REAL NOT NULL,
    "recencyScore" REAL NOT NULL,
    "clarityScore" REAL NOT NULL,
    "aiQualityScore" REAL NOT NULL,
    "confidenceScore" REAL NOT NULL,
    "formulaVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "scoreBreakdown" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "research_scores_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "watchlists" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "watchlists_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "watchlists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "watchlist_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "adId" TEXT,
    "productId" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watchlist_items_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "watchlists" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "watchlist_items_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "watchlist_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "saved_searches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filtersJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "saved_searches_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "research_notes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "adId" TEXT,
    "productId" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "tags" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "research_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "research_notes_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "research_notes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "sync_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "resultJson" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workerId" TEXT,
    "claimToken" TEXT,
    "fencingToken" TEXT,
    "fencingGeneration" INTEGER NOT NULL DEFAULT 0,
    "recordVersion" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" DATETIME,
    "attemptNumber" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "sync_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "sync_jobs_jobType_status_idx" ON "sync_jobs"("jobType", "status");
CREATE INDEX IF NOT EXISTS "sync_jobs_workerId_status_idx" ON "sync_jobs"("workerId", "status");
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detailsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "connected_shops" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "accessToken" TEXT,
    "scopes" TEXT,
    "installedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "connected_shops_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "advertising_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "accessToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "advertising_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key" ON "workspace_members"("workspaceId", "userId");
CREATE UNIQUE INDEX "data_sources_name_key" ON "data_sources"("name");
CREATE UNIQUE INDEX "provider_connections_workspaceId_dataSourceId_key" ON "provider_connections"("workspaceId", "dataSourceId");
CREATE UNIQUE INDEX "advertisers_externalId_key" ON "advertisers"("externalId");
CREATE INDEX "advertisers_platform_name_idx" ON "advertisers"("platform", "name");
CREATE INDEX "ad_metric_observations_adId_metricKey_idx" ON "ad_metric_observations"("adId", "metricKey");
CREATE UNIQUE INDEX "competitor_stores_domain_key" ON "competitor_stores"("domain");
CREATE INDEX "research_products_category_idx" ON "research_products"("category");
CREATE INDEX "product_price_observations_productId_observedAt_idx" ON "product_price_observations"("productId", "observedAt");
CREATE UNIQUE INDEX "ad_product_links_adId_productId_key" ON "ad_product_links"("adId", "productId");
CREATE INDEX "creative_analyses_adId_idx" ON "creative_analyses"("adId");
CREATE INDEX "research_scores_adId_createdAt_idx" ON "research_scores"("adId", "createdAt");
CREATE INDEX "research_scores_totalScore_idx" ON "research_scores"("totalScore");
CREATE UNIQUE INDEX "watchlist_items_watchlistId_itemType_adId_productId_key" ON "watchlist_items"("watchlistId", "itemType", "adId", "productId");
CREATE UNIQUE INDEX "connected_shops_shopDomain_key" ON "connected_shops"("shopDomain");
CREATE UNIQUE INDEX "advertising_accounts_workspaceId_platform_accountId_key" ON "advertising_accounts"("workspaceId", "platform", "accountId");
CREATE TABLE IF NOT EXISTS "ad_lifecycle_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceTimestamp" DATETIME,
    "evidenceReference" TEXT,
    "confidence" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ad_lifecycle_events_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "evergreen_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "totalScore" REAL,
    "tier" TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
    "longevityScore" REAL,
    "observationScore" REAL,
    "coverageScore" REAL,
    "sourceReliabilityScore" REAL,
    "evidenceConfidence" REAL,
    "coverageStatus" TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
    "availableSignals" TEXT,
    "missingSignals" TEXT,
    "longevityCategory" TEXT,
    "calendarAgeDays" INTEGER,
    "observedActiveDays" INTEGER,
    "observationCoverageDays" INTEGER,
    "verifiedActiveObservationCount" INTEGER,
    "scoreBreakdown" TEXT,
    "formulaVersion" TEXT NOT NULL DEFAULT '7.0.0',
    "explanation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evergreen_scores_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "product_demand_observations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'US',
    "keyword" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "demandValue" REAL,
    "valueType" TEXT NOT NULL DEFAULT 'RELATIVE_INTEREST',
    "demandStabilityClass" TEXT,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceReference" TEXT,
    "methodologyVersion" TEXT NOT NULL DEFAULT '1.0',
    CONSTRAINT "product_demand_observations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "product_creative_variants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "productId" TEXT,
    "advertiserId" TEXT,
    "creativeFormat" TEXT NOT NULL DEFAULT 'VIDEO',
    "creativeAngle" TEXT,
    "firstObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "sourceReference" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_creative_variants_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "research_decisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT,
    "productId" TEXT,
    "decision" TEXT NOT NULL,
    "notes" TEXT,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "research_decisions_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "research_decisions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "evergreen_product_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "totalScore" REAL,
    "tier" TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
    "demandStabilityScore" REAL,
    "adPersistenceScore" REAL,
    "creativeInvestScore" REAL,
    "productAvailScore" REAL,
    "evidenceConfidence" REAL,
    "demandStabilityClass" TEXT,
    "observationPeriodDays" INTEGER,
    "demandObservationCount" INTEGER,
    "linkedAdCount" INTEGER,
    "distinctCreativeCount" INTEGER,
    "scoreBreakdown" TEXT,
    "formulaVersion" TEXT NOT NULL DEFAULT '7.0.0',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evergreen_product_scores_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "ad_observations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "isActive" BOOLEAN,
    "evidenceType" TEXT NOT NULL DEFAULT 'USER_OBSERVED',
    "verificationMethod" TEXT,
    "evidenceReference" TEXT,
    "sourceTimestamp" DATETIME,
    "confidence" REAL,
    "rawPayload" TEXT,
    CONSTRAINT "ad_observations_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ad_observations_adId_observedAt_idx" ON "ad_observations"("adId", "observedAt");
CREATE INDEX "ad_observations_adId_observationStatus_idx" ON "ad_observations"("adId", "observationStatus");
CREATE TABLE IF NOT EXISTS "competitor_ads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "advertiserId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalAdId" TEXT,
    "platform" TEXT NOT NULL,
    "targetMarket" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "headline" TEXT,
    "bodyText" TEXT,
    "callToAction" TEXT,
    "landingPageUrl" TEXT,
    "originalAdUrl" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "daysRunning" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "category" TEXT NOT NULL DEFAULT 'Other',
    "dataConfidence" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "sourceReportedStartAt" DATETIME,
    "sourceReportedEndAt" DATETIME,
    "lastVerifiedActiveAt" DATETIME,
    "lastVerifiedInactiveAt" DATETIME,
    "firstObservedAt" DATETIME,
    "lastObservedAt" DATETIME,
    "longevityCategory" TEXT,
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedActiveCount" INTEGER NOT NULL DEFAULT 0,
    "isSyntheticQuarantine" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "competitor_ads_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertisers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "competitor_ads_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "competitor_ads_externalAdId_key" ON "competitor_ads"("externalAdId");
CREATE INDEX "competitor_ads_platform_status_idx" ON "competitor_ads"("platform", "status");
CREATE INDEX "competitor_ads_platform_lifecycleStatus_idx" ON "competitor_ads"("platform", "lifecycleStatus");
CREATE INDEX "competitor_ads_category_idx" ON "competitor_ads"("category");
CREATE INDEX "competitor_ads_firstSeenAt_idx" ON "competitor_ads"("firstSeenAt");
CREATE INDEX "competitor_ads_longevityCategory_idx" ON "competitor_ads"("longevityCategory");
CREATE INDEX "ad_lifecycle_events_adId_occurredAt_idx" ON "ad_lifecycle_events"("adId", "occurredAt");
CREATE INDEX "evergreen_scores_adId_createdAt_idx" ON "evergreen_scores"("adId", "createdAt");
CREATE INDEX "evergreen_scores_totalScore_idx" ON "evergreen_scores"("totalScore");
CREATE INDEX "product_demand_observations_productId_periodStart_idx" ON "product_demand_observations"("productId", "periodStart");
CREATE INDEX "product_demand_observations_keyword_region_idx" ON "product_demand_observations"("keyword", "region");
CREATE INDEX "product_creative_variants_adId_idx" ON "product_creative_variants"("adId");
CREATE INDEX "product_creative_variants_productId_idx" ON "product_creative_variants"("productId");
CREATE INDEX "evergreen_product_scores_productId_createdAt_idx" ON "evergreen_product_scores"("productId", "createdAt");
CREATE TABLE IF NOT EXISTS "discovery_schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'US TikTok Top Ads Discovery',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "providerId" TEXT NOT NULL DEFAULT 'tiktok-topads',
    "searchWindowDays" INTEGER NOT NULL DEFAULT 30,
    "targetMarket" TEXT NOT NULL DEFAULT 'US',
    "keywordsJson" TEXT NOT NULL DEFAULT '["ecommerce","gadget","beauty"]',
    "industriesJson" TEXT NOT NULL DEFAULT '[]',
    "dailyLimit" INTEGER NOT NULL DEFAULT 20,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "hourOfDayUtc" INTEGER NOT NULL DEFAULT 6,
    "lastRunAt" DATETIME,
    "nextEligibleRunAt" DATETIME,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "discovery_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "jobId" TEXT,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "runMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "queryConfigJson" TEXT NOT NULL,
    "cursor" TEXT,
    "requestedLimit" INTEGER NOT NULL DEFAULT 20,
    "actualRetrievedCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "newUniqueCount" INTEGER NOT NULL DEFAULT 0,
    "existingDuplicateCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "totalRequestCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" REAL,
    "actualCostUsd" REAL,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorCategory" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "heartbeatAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "discovery_runs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "discovery_schedules" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "provider_request_ledgers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "discoveryRunId" TEXT,
    "jobId" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerRequestId" TEXT,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" REAL,
    "actualCost" REAL,
    "creditUnit" TEXT NOT NULL DEFAULT 'CREDITS',
    "errorCategory" TEXT,
    "requestDurationMs" INTEGER,
    "endpointRedacted" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_request_ledgers_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "discovery_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "ad_source_identities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "sourceExternalId" TEXT,
    "stableIdentityHash" TEXT NOT NULL,
    "canonicalSourceUrl" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ad_source_identities_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "discovery_schedules_workspaceId_enabled_idx" ON "discovery_schedules"("workspaceId", "enabled");
CREATE INDEX "discovery_runs_workspaceId_status_idx" ON "discovery_runs"("workspaceId", "status");
CREATE INDEX "discovery_runs_providerId_createdAt_idx" ON "discovery_runs"("providerId", "createdAt");
CREATE INDEX "provider_request_ledgers_providerId_requestedAt_idx" ON "provider_request_ledgers"("providerId", "requestedAt");
CREATE INDEX "provider_request_ledgers_discoveryRunId_idx" ON "provider_request_ledgers"("discoveryRunId");
CREATE UNIQUE INDEX "ad_source_identities_stableIdentityHash_key" ON "ad_source_identities"("stableIdentityHash");
CREATE INDEX "ad_source_identities_platform_providerId_sourceExternalId_idx" ON "ad_source_identities"("platform", "providerId", "sourceExternalId");
CREATE INDEX "ad_source_identities_adId_idx" ON "ad_source_identities"("adId");
CREATE TABLE IF NOT EXISTS "discovery_run_ads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "providerId" TEXT NOT NULL,
    "libraryId" TEXT,
    "ingestOutcome" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "discovery_run_ads_runId_fkey" FOREIGN KEY ("runId") REFERENCES "discovery_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "discovery_run_ads_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "discovery_run_ads_workspaceId_runId_idx" ON "discovery_run_ads"("workspaceId", "runId");
CREATE INDEX "discovery_run_ads_adId_idx" ON "discovery_run_ads"("adId");
CREATE UNIQUE INDEX "discovery_run_ads_runId_adId_key" ON "discovery_run_ads"("runId", "adId");
CREATE TABLE IF NOT EXISTS "research_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT DEFAULT 'default-workspace',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "observedValue" TEXT,
    "sourceUrl" TEXT,
    "observationMethod" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'SOURCE_OBSERVED',
    "sourceContentRef" TEXT,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" DATETIME,
    "verifierActorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT,
    CONSTRAINT "research_evidence_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "competitor_offer_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT DEFAULT 'default-workspace',
    "productId" TEXT,
    "storeId" TEXT,
    "adId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sellingPrice" REAL,
    "compareAtPrice" REAL,
    "bundleQuantity" INTEGER NOT NULL DEFAULT 1,
    "hasFreeShipping" BOOLEAN NOT NULL DEFAULT false,
    "shippingThreshold" REAL,
    "availability" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "offerDataJson" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "competitor_offer_snapshots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "competitor_offer_snapshots_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "competitor_stores" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "competitor_offer_snapshots_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "landing_page_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT DEFAULT 'default-workspace',
    "productId" TEXT,
    "storeId" TEXT,
    "adId" TEXT,
    "originalUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "httpStatus" INTEGER NOT NULL DEFAULT 200,
    "accessStatus" TEXT NOT NULL DEFAULT 'SUCCESS',
    "pageTitle" TEXT,
    "metaDescription" TEXT,
    "contentHash" TEXT NOT NULL,
    "observationsJson" TEXT NOT NULL,
    "croSignalsJson" TEXT NOT NULL,
    "messageMatchJson" TEXT,
    "warningsJson" TEXT,
    "analysisVersion" TEXT NOT NULL DEFAULT '11.4.0',
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "landing_page_snapshots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "landing_page_snapshots_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "competitor_stores" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "landing_page_snapshots_adId_fkey" FOREIGN KEY ("adId") REFERENCES "competitor_ads" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "product_economics_scenarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT DEFAULT 'default-workspace',
    "productId" TEXT NOT NULL,
    "scenarioName" TEXT NOT NULL,
    "inputsJson" TEXT NOT NULL,
    "outputsJson" TEXT NOT NULL,
    "assumptionProvenanceJson" TEXT NOT NULL,
    "calculationVersion" TEXT NOT NULL DEFAULT '11.4.0',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "product_economics_scenarios_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "supplier_quotes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT DEFAULT 'default-workspace',
    "productId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "productIdentifier" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "unitCost" REAL NOT NULL,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "processingTimeDays" INTEGER,
    "shippingCostEstimate" REAL,
    "shippingLeadTimeDays" INTEGER,
    "destinationCountry" TEXT NOT NULL DEFAULT 'US',
    "quoteSource" TEXT NOT NULL,
    "quoteDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "supplier_quotes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "fulfillment_assessments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT DEFAULT 'default-workspace',
    "productId" TEXT NOT NULL,
    "productWeightGrams" REAL,
    "packageDimensionsCm" TEXT,
    "isFragile" BOOLEAN NOT NULL DEFAULT false,
    "hasBatteryOrLiquid" BOOLEAN NOT NULL DEFAULT false,
    "regulatoryNotes" TEXT,
    "overallRiskLevel" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "risksJson" TEXT NOT NULL,
    "criticalGapsJson" TEXT NOT NULL,
    "assessmentVersion" TEXT NOT NULL DEFAULT '11.4.0',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "fulfillment_assessments_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "product_opportunity_assessments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT DEFAULT 'default-workspace',
    "productId" TEXT NOT NULL,
    "methodologyVersion" TEXT NOT NULL DEFAULT '11.4.0',
    "opportunityScore" REAL,
    "evidenceReadinessScore" REAL,
    "pillarsJson" TEXT NOT NULL,
    "strengthsJson" TEXT NOT NULL,
    "risksJson" TEXT NOT NULL,
    "missingCriticalEvidenceJson" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "recommendationRationale" TEXT NOT NULL,
    "testReadinessStatus" TEXT NOT NULL DEFAULT 'BLOCKED_MISSING_DATA',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "product_opportunity_assessments_productId_fkey" FOREIGN KEY ("productId") REFERENCES "research_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "research_evidence_subjectType_subjectId_idx" ON "research_evidence"("subjectType", "subjectId");
CREATE INDEX "research_evidence_pillar_idx" ON "research_evidence"("pillar");
CREATE INDEX "research_evidence_classification_idx" ON "research_evidence"("classification");
CREATE INDEX "competitor_offer_snapshots_productId_observedAt_idx" ON "competitor_offer_snapshots"("productId", "observedAt");
CREATE INDEX "competitor_offer_snapshots_storeId_observedAt_idx" ON "competitor_offer_snapshots"("storeId", "observedAt");
CREATE INDEX "competitor_offer_snapshots_snapshotHash_idx" ON "competitor_offer_snapshots"("snapshotHash");
CREATE INDEX "landing_page_snapshots_productId_observedAt_idx" ON "landing_page_snapshots"("productId", "observedAt");
CREATE INDEX "landing_page_snapshots_storeId_observedAt_idx" ON "landing_page_snapshots"("storeId", "observedAt");
CREATE INDEX "landing_page_snapshots_contentHash_idx" ON "landing_page_snapshots"("contentHash");
CREATE INDEX "product_economics_scenarios_productId_createdAt_idx" ON "product_economics_scenarios"("productId", "createdAt");
CREATE INDEX "supplier_quotes_productId_quoteDate_idx" ON "supplier_quotes"("productId", "quoteDate");
CREATE INDEX "fulfillment_assessments_productId_idx" ON "fulfillment_assessments"("productId");
CREATE INDEX "product_opportunity_assessments_productId_createdAt_idx" ON "product_opportunity_assessments"("productId", "createdAt");
