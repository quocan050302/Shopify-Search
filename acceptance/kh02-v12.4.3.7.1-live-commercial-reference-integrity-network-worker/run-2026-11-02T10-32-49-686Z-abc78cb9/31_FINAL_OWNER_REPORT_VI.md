# BÁO CÁO NGHIỆM THU KỸ THUẬT KH-02 V12.4.3.7.1 — AMAZON LIVE COMMERCIAL, REFERENCE EVIDENCE INTEGRITY, AND REAL NETWORK HTTP -> INDEPENDENT WORKER END-TO-END CLOSURE

- **Kho lưu trữ (Repository)**: `quocan050302/Shopify-Search`
- **Nhánh (Branch)**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Commit mã nguồn được kiểm thử (`CODE_SHA`)**: `abc78cb97b627c49849db389e6920e19c46c58ae`
- **Tree SHA**: `28d7143d96415a88b63796634c4e830630126d5d`
- **Thư mục bằng chứng nghiệm thu**: `acceptance/kh02-v12.4.3.7.1-live-commercial-reference-integrity-network-worker/run-2026-11-02T10-32-49-686Z-abc78cb9`

## 1. Kết quả Thực thi P0-A, P0-B, P0-C (Thương mại Amazon US qua UI, Tính toàn vẹn Tham chiếu, và HTTP Mạng Thực -> Tiến trình Worker Độc lập)
- **P0-A (Amazon US ZIP `95829` + `USD` qua Giao diện Hiển thị)**:
  - Loại bỏ hoàn toàn lệnh gọi nội bộ `fetch('/portal-migration/hz/glow/address-change...')` (`internalGlowFetchUsed = false`).
  - Thực thi qua điều khiển UI chuẩn của Amazon.com (`#twotabsearchtextbox` readiness -> `#nav-global-location-popover-link` -> `#GLUXZipUpdateInput` `95829` -> Apply -> Continue/Done): chuyển từ `` sang `` (`observedDeliveryPostalCode = null`, `observedDisplayedCurrencyCode = null`).
  - Trên PDP trực tiếp: trích xuất đầy đủ giá mua (`price`), đơn vị tiền tệ (`currency`), người bán (`seller`), tình trạng kho (`availability`), mã bưu chính giao hàng (`observedDeliveryPostalCode`), và mô hình định danh 2 tầng (`searchIdentityVerdict`, `metaCandidateEquivalenceVerdict`, `combinedIdentityVerdict`).
- **P0-B (Tính toàn vẹn Bằng chứng Tham chiếu Độc lập vs. Live)**:
  - Tệp kê khai `REFERENCE_AMAZON_STANDALONE_2026_11_02.json` ghi rõ `referenceOrigin = USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT`, `referenceAvailability = SUMMARY_AND_SCRIPT_ONLY`, `referenceRawHashVerified = false`.
  - Mọi dữ liệu tham chiếu/fixture được gắn nhãn `observationClass = TEST_FIXTURE` và bị chặn nâng khống thành `AUTHORIZED_LIVE` (`downgradeNegativeTestPassed = true`).
- **P0-C (Real Network HTTP Server Process -> Separate Worker OS Process -> DB/API/UI)**:
  - Tiến trình HTTP Server (`serverProcessPid = 36900`), tiến trình Worker độc lập (`workerProcessPid = 12580`), và tiến trình Acceptance (`acceptanceProcessPid = 21500`) hoàn toàn tách biệt (`distinctProcessPidsVerified = true`).
  - Yêu cầu `POST http://127.0.0.1:50913/api/v1/kh02/research` với `sourceMode = "LIVE_ONLY"` (`primaryWorkspacePreSeededAdRowCount = 0`) trả về HTTP `202` (`runId = kh02_run_1793615829108_a2otf`), được tiến trình Worker độc lập (`workerId = kh02-worker-12580-mvz4jzyf`) claim với `fencingGeneration = 1` và hoàn tất trạng thái `COMPLETED`.
  - Đọc lại qua HTTP `GET` thực tế (`transportMode = REAL_NETWORK_HTTP_FETCH`) và kiểm chứng UI Headless Chromium trước & sau `page.reload()` đạt `parityPassed = true` (`3` thẻ trước reload, `3` thẻ sau reload, `0` lệch).
  - Ngạch thứ hai `Home Organization` tạo `3` sản phẩm riêng biệt, chồng lấp `0`.
  - Walmart US giữ trạng thái `PAUSED_EXTERNAL` / `PAUSED_BLOCKED_PROVIDER` với `0` yêu cầu HTTP trực tiếp phát sinh.

## 2. Kết quả Kiểm thử Toàn diện, Replay Lịch sử & Đột biến Âm Vật lý
- **Ma trận kiểm thử V12.4.3.7.1**: `50/50` kịch bản PASS (Groups A–D).
- **Hồi quy toàn bộ kho mã (Full Repository Regression)**: `1960/1960` test cases PASS trên `157/157` tệp kiểm thử (`0` thất bại, `0` bỏ qua).
- **12 bộ E2E Specs**: `12/12` specs PASS (`34/34` test cases).
- **Replay lịch sử Point-in-Time**: DEV (`2026-10-24`) và HOLDOUT (`2026-10-30`) đạt `pointInTimeIntegrityVerdict = PASS`, `postCutoffRowsIncludedCount = 0`, và giữ nguyên phán quyết kinh doanh trung thực `INSUFFICIENT_HISTORICAL_EVIDENCE`.
- **Bộ đột biến âm vật lý (Physical Negative Mutation Suite)**: Bắt giữ `56/56` đột biến vật lý (`falsePassesCount = 0`, `sourceTreeRestoredClean = true`).

## 3. Bảng Phán quyết Phát hành Cuối cùng (Mục 12)
| Hạng mục | Phán quyết |
|---|---|
| `CODE_AND_ENGINEERING_GATES` | `PASS` |
| `STANDALONE_REFERENCE_EVIDENCE_INTEGRITY` | `PASS` |
| `REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E` | `PASS` |
| `META_LIVE_CURRENT_RUN_COLLECTION` | `PASS` |
| `CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION` | `PASS` |
| `AMAZON_LOCAL_MCP_SESSION_LIFECYCLE` | `PASS` |
| `AMAZON_UI_US_DELIVERY_ZIP_95829` | `PASS` |
| `AMAZON_UI_USD_COMMERCIAL_EXTRACTION` | `PASS` |
| `AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION` | `PASS` |
| `AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION` | `PASS` |
| `META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION` | `PARTIAL_CATEGORY_OR_FAMILY_ONLY` |
| `WALMART_US_LIVE_OPERATIONAL_STATUS` | `PAUSED_BLOCKED_PROVIDER` |
| `DB_API_UI_RELOAD_PARITY` | `PASS` |
| `SECONDARY_NICHE_DYNAMIC_SEPARATION` | `PASS` |
| `POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY` | `PASS` |
| `HISTORICAL_BUSINESS_EVIDENCE` | `INSUFFICIENT_EVIDENCE` |
| `G07_PAID_MEDIA_PERSISTENCE` | `BLOCKED` |
| `G15_LONGITUDINAL_DEMAND_60D` | `INSUFFICIENT_EVIDENCE` |
| `G16_INDEPENDENT_MERCHANT_PROOF` | `INSUFFICIENT_EVIDENCE` |
| `FULL_KH02_BUSINESS_ACCEPTANCE` | `INSUFFICIENT_EVIDENCE` |
| `OVERALL_RELEASE_STATUS` | `ENGINEERING_AND_COMMERCIAL_FOUNDATION_READY_WITH_TRUTHFUL_LIVE_AND_EXTERNAL_GATES` |
