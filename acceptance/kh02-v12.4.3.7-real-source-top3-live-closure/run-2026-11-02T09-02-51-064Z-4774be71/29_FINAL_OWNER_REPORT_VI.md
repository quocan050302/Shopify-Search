# BÁO CÁO NGHIỆM THU KỸ THUẬT KH-02 V12.4.3.7 — REAL SOURCE-TO-TOP3 LIVE EXECUTION CLOSURE

- **Kho lưu trữ (Repository)**: `quocan050302/Shopify-Search`
- **Nhánh (Branch)**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Commit mã nguồn được kiểm thử (`CODE_SHA`)**: `4774be7148aec2b2a1efc23791c5ec5c789f231c`
- **Tree SHA**: `b5ae12ed7fdefcfb1569f8e3602f94d2f5dd8096`
- **Thư mục bằng chứng nghiệm thu**: `acceptance/kh02-v12.4.3.7-real-source-top3-live-closure/run-2026-11-02T09-02-51-064Z-4774be71`

## 1. Tóm tắt Kết quả Thực thi End-to-End Thực tế (`Pet Gadgets` & `Home Organization`)
- **Luồng thực thi API -> Worker**: `POST /api/v1/kh02/research` trả về HTTP `202` (`runId = kh02_run_1793610427837_c8ihk`), được `kh02Worker` claim với `fencingGeneration = 1` và hoàn tất trạng thái `COMPLETED`.
- **Thu thập Meta Ads & Tách biệt Provenance**: Đã thực thi thu thập Meta upstream (`liveAttempted = true`, `subqueriesExecutedCount = 4`), tách biệt tuyệt đối `LIVE_PROVIDER` (`35`) và `CACHED_SOURCE` (`3`), `0` bản ghi tổng hợp hoặc cache bị nâng khống thành `LIVE_PROVIDER`.
- **Khám phá Ứng viên & Khử trùng lặp Gia đình Sản phẩm**: Chọn ra `3` sản phẩm vật lý thuộc `3` gia đình sản phẩm khác nhau cho `Pet Gadgets`, đồng thời kiểm chứng ngạch thứ hai `Home Organization` (`3` sản phẩm, chồng lấp `0`).
- **Amazon US Local Playwright MCP Search -> Observed Href PDP -> Two-Tier Identity**:
  - Kết nối thật `@playwright/mcp@0.0.83@0.0.83` (`sessionId = pw_mcp_mvz1d9k5_5a813a6e`, `ownedChildPid = 20104`), thực thi `4/4` thao tác.
  - Trích xuất tối đa `5` thẻ Search không tài trợ, giữ nguyên `observedSearchHref`, mở PDP từ `href` quan sát được, hỗ trợ canonical `/clp/<ASIN>`, và đánh giá mô hình định danh 2 tầng (`searchIdentityVerdict`, `metaCandidateEquivalenceVerdict`, `combinedIdentityVerdict`).
  - Đóng phiên MCP sạch sẽ trong cùng phiên (`mcpSessionClosedCleanly = true`, `ownedChildPidTerminated = true`).
- **Đồng nhất DB -> API -> UI Headless Chromium trước & sau `page.reload()`**: `parityPassed = true` (`3` thẻ trước reload, `3` thẻ sau reload, `0` lệch).
- **Tạm dừng vận hành Walmart US**: `operationalStatus = PAUSED_EXTERNAL`, `0` yêu cầu HTTP trực tiếp phát sinh trong chạy thường, bảo toàn biên nhận chặn CAPTCHA ngày `2026-11-02`.

## 2. Kết quả Kiểm thử Toàn diện, Replay Lịch sử & Đột biến Âm Vật lý
- **Ma trận kiểm thử V12.4.3.7**: `58/58` kịch bản PASS (Groups A–E).
- **Hồi quy toàn bộ kho mã (Full Repository Regression)**: `1910/1910` test cases PASS trên `156/156` tệp kiểm thử (`0` thất bại, `0` bỏ qua).
- **12 bộ E2E Specs**: `12/12` specs PASS (`34/34` test cases).
- **Replay lịch sử Point-in-Time (không nhìn trước tương lai)**: DEV (`2026-10-24`) và HOLDOUT (`2026-10-30`) đạt `pointInTimeIntegrityVerdict = PASS`, `postCutoffRowsIncludedCount = 0`, và giữ nguyên phán quyết kinh doanh trung thực `INSUFFICIENT_HISTORICAL_EVIDENCE`.
- **Bộ đột biến âm vật lý (Physical Negative Mutation Suite)**: Bắt giữ `52/52` đột biến vật lý (`falsePassesCount = 0`, `sourceTreeRestoredClean = true`).

## 3. Bảng Phán quyết Phát hành Cuối cùng (Mục 13)
| Hạng mục | Phán quyết |
|---|---|
| `CODE_AND_ENGINEERING_GATES` | `PASS` |
| `META_LIVE_CURRENT_RUN_COLLECTION` | `DEGRADED_CACHE_SUPPLEMENTED` |
| `CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION` | `PASS` |
| `AMAZON_LOCAL_MCP_SESSION_LIFECYCLE` | `PASS` |
| `AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION` | `PASS` |
| `AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION` | `PASS` |
| `META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION` | `PARTIAL_CATEGORY_OR_FAMILY_ONLY` |
| `AMAZON_US_COMMERCIAL_COMPLETENESS_USD_ZIP_SELLER` | `OBSERVED_PARTIAL` |
| `WALMART_US_LIVE_OPERATIONAL_STATUS` | `PAUSED_BLOCKED_PROVIDER` |
| `DB_API_UI_RELOAD_PARITY` | `PASS` |
| `SECONDARY_NICHE_DYNAMIC_SEPARATION` | `PASS` |
| `POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY` | `PASS` |
| `HISTORICAL_BUSINESS_EVIDENCE` | `INSUFFICIENT_EVIDENCE` |
| `G07_PAID_MEDIA_PERSISTENCE` | `BLOCKED` |
| `G15_LONGITUDINAL_DEMAND_60D` | `INSUFFICIENT_EVIDENCE` |
| `G16_INDEPENDENT_MERCHANT_PROOF` | `INSUFFICIENT_EVIDENCE` |
| `FULL_KH02_BUSINESS_ACCEPTANCE` | `INSUFFICIENT_EVIDENCE` |
| `OVERALL_RELEASE_STATUS` | `ENGINEERING_READY_WITH_TRUTHFUL_LIVE_AND_EXTERNAL_BLOCKERS` |
