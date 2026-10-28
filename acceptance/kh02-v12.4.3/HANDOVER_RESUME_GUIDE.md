# SWAI KH-02 V12.4.3 — File Bàn Giao & Hướng Dẫn Chạy Tiếp (Handover & Resume Guide)

- **Phiên bản:** `12.4.3` (`SWAI_KH02_RELEASE_VERSION = "12.4.3"`)
- **Nhánh Git:** `feature/kh02-v12.1.3-runtime-truth-closure`
- **Baseline Commit Đã Review:** `05657392bc7dfcc96fd62803b468fbdf04a84679`
- **Trạng Thái Hiện Tại:** **ĐÃ CHẠY XONG 100% BỘ TEST, BACKTEST & ACCEPTANCE V12.4.3** (`11 PASS | 0 FAIL | 4 INSUFFICIENT_EVIDENCE | 0 BLOCKED`)

---

## 1. Tóm Tắt Những Gì Đã Hoàn Tất Hôm Nay

1. **Đã sửa triệt để cả 8 Baseline Findings (`F01`–`F08`):**
   - `F01`: Xây dựng động cơ phân biệt sản phẩm 6 cấp (`src/services/kh02/identity/productDistinctnessEngine.ts`) và áp dụng đồng nhất tại `discoverProductCandidatesFromAds()`, `evaluateShortlistDistinctness()`, `selectTopResearchShortlist()`, và `runEvergreenProductResearch()`. Hai candidate cùng `canonicalProductUrl` khác title luôn gộp thành `1` (`distinctCount = 1`).
   - `F02`: URL `/products/<handle>` chỉ là locator; lỗi fetch (`HTTP_403`, `HTTP_404`, `TIMEOUT`, `CAPTCHA_OR_CHALLENGE`, `NON_PRODUCT_PAGE`) và raw headline `"Facebook Ad: 123..."` không bao giờ trả `VERIFIED`.
   - `F03`: Bảo toàn toàn bộ trường định danh (`sku`, `gtin`, `model`, `brand`, `merchantProductId`, `variantId`, `requestedUrl`, `resolvedFinalUrl`, `declaredCanonicalUrl`, `normalizedProductUrl`, `fetchOutcome`, `verificationReason`, `verificationLimitations`, `contradictions`) từ extractor -> resolver -> candidate -> SQLite snapshot -> UI.
   - `F04` & `F05`: Đánh giá độ phủ và kích hoạt Adaptive Recovery Vòng 2 diễn ra **sau** khi qua cổng kiểm chứng (`Stage 4`, `Stage 4b`, `Stage 4c`); đan xen candidate theo `familyKey` và tự động refill từ `unverifiedQueue` khi ứng viên đầu bị loại hoặc trùng.
   - `F06`: Tách biệt 11 trạng thái chẩn đoán của Google Ads Transparency (`stateBreakdown`), phân loại `PRODUCT_SPECIFIC` vs `BRAND_RELATED`, không bao giờ báo `isLive = true` khi `productAssociatedCount === 0`.
   - `F07`: Nhận diện và gom cụm theo `familyKey` (ví dụ 3 bình xịt dầu ăn trong Kitchen được gom vào 1 họ `oil_dispenser_sprayer`, `homogeneousFamilyDetected = true`), ưu tiên chọn 3 họ sản phẩm khác nhau cho `BROAD_CATEGORY`.
   - `F08`: Đồng bộ hóa kết quả nghiệm thu trên toàn bộ 8 kịch bản nghiên cứu và ghi nhận chính xác commit revision trong toàn bộ 15 artifacts tại `acceptance/kh02-v12.4.3/`.

2. **Kết Quả Kiểm Thử & Nghiệm Thu Đã Chạy Xong:**
   - **50 Kịch Bản Hồi Quy Bắt Buộc (`A01–F50`):** `50/50 PASS` (`tests/unit/kh02/v12_4_3_IdentityDistinctnessRecovery.test.ts`)
   - **KH-02 Unit Tests:** `33/33 files PASS` (`426/426 tests`)
   - **KH-02 Integration Tests:** `8/8 files PASS` (`27/27 tests`)
   - **KH-01 Verification Suite:** `5/5 files PASS` (`69/69 tests`)
   - **Backtest DEV vs HOLDOUT (`scripts/kh02/runBacktestV12_4_3.ts`):** `PASS` (`FalseVerified: 10 -> 0`, `DuplicateFalseSplit: 2 -> 0`, `DistinctFalseMerge: 0`, `skuPropagationRecall: 0 -> 1`, `demandMappingAccuracy: 0 -> 1`, `AntiOverfittingAudit: PASS`)
   - **Master Acceptance V12.4.3 (`npm run acceptance:kh02:v12.4.3`):** Exit code `0` — `11 PASS | 0 FAIL | 4 INSUFFICIENT_EVIDENCE | 0 BLOCKED`.

---

## 2. Các Lệnh Để Ngày Mai Kiểm Tra Hoặc Chạy Tiếp Ngay

Khi mở lại máy vào ngày mai, bạn có thể chạy ngay các lệnh sau từ thư mục gốc `/Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search`:

### A. Kiểm tra nhanh các bộ test & backtest (chỉ mất ~15 giây)
```bash
# 1. Chạy 50 kịch bản hồi quy bắt buộc của V12.4.3 (A01-F50)
npx vitest run tests/unit/kh02/v12_4_3_IdentityDistinctnessRecovery.test.ts

# 2. Chạy bộ Backtest đa tầng DEV vs HOLDOUT chống overfitting
npm run backtest:kh02:v12.4.3

# 3. Chạy toàn bộ Unit Test + Integration Test của KH-02
npm run kh02:test:unit
npx vitest run tests/integration/kh02
```

### B. Khởi động ứng dụng Web + Worker để xem trực tiếp trên trình duyệt
```bash
# Terminal 1: Chạy Next.js server
npm run dev

# Terminal 2: Chạy KH-02 Background Worker
npm run worker:kh02
```
Sau đó mở `http://localhost:3000/products` để xem giao diện V12.4.3 với đầy đủ badge `Identity Status`, `Product Family`, `SKU/Model/Merchant ID`, `Verification Reason/Limitations`, và bảng đối chiếu `Top 3 Research Shortlist` vs `Verified Evergreen Top 3`.

### C. Chạy lại toàn bộ 15 Gates Acceptance E2E (nếu muốn tái tạo lại 15 artifacts)
```bash
npm run acceptance:kh02:v12.4.3
```

---

## 3. Danh Sách 15 Artifacts Đã Xuất Tại `acceptance/kh02-v12.4.3/`

1. `acceptance/kh02-v12.4.3/MANIFEST.json`
2. `acceptance/kh02-v12.4.3/GATE_VERIFICATION_MATRIX.json`
3. `acceptance/kh02-v12.4.3/BASELINE_FINDINGS_REPRODUCTION_AND_FIXES.json`
4. `acceptance/kh02-v12.4.3/IDENTITY_VERIFICATION_EVIDENCE.json`
5. `acceptance/kh02-v12.4.3/PRODUCT_DISTINCTNESS_AND_FAMILY_AUDIT.json`
6. `acceptance/kh02-v12.4.3/ADAPTIVE_RECOVERY_TRACE.json`
7. `acceptance/kh02-v12.4.3/GOOGLE_TRANSPARENCY_PRODUCT_EVIDENCE.json`
8. `acceptance/kh02-v12.4.3/DEMAND_HISTORY_COVERAGE.json`
9. `acceptance/kh02-v12.4.3/PET_GADGETS_US_90D_REAL_RUN.json`
10. `acceptance/kh02-v12.4.3/DIY_US_180D_REAL_RUN.json`
11. `acceptance/kh02-v12.4.3/KITCHEN_US_30D_REAL_RUN.json`
12. `acceptance/kh02-v12.4.3/REGRESSION_NICHES_SUMMARY.json`
13. `acceptance/kh02-v12.4.3/BACKTEST_DEV_VS_HOLDOUT.json`
14. `acceptance/kh02-v12.4.3/BROWSER_RELOAD_RECONCILIATION.json`
15. `acceptance/kh02-v12.4.3/ACCEPTANCE_REPORT_V12_4_3.md`

---

## 4. Hướng Phát Triển Tiếp Theo (Nếu Muốn Nâng 4 Gates `INSUFFICIENT_EVIDENCE` Lên `PASS` Thực Tế)

Hiện tại 4 gates `G09`, `G10`, `G11`, `G12` đang trả kết quả trung thực là `INSUFFICIENT_EVIDENCE` (không có gate nào `FAIL`). Để nâng chúng lên `PASS` với dữ liệu live thực tế trong bước tiếp theo:
1. **Mở rộng thu thập Meta Ads & giải quyết shortlinks/social redirects:** Tăng số lượng ads mỗi query hoặc cho phép theo dõi thêm các trang đích Shopify thực ngoài 3 requests đầu tiên khi tỷ lệ quảng cáo không có link sản phẩm trên Meta cao.
2. **Vượt rào cản HTTP 429 của Google Ads Transparency (`/sorry/index`):** Đợi IP hết thời gian chặn tạm thời của Google hoặc cấu hình proxy/session cho MCP `google_ads_mcp` để `search_advertiser` lấy được creatives live mà không bị chặn CAPTCHA.
3. **Bổ sung chuỗi dữ liệu Demand History (`>= 60D`, `>= 3` điểm):** Import dữ liệu Google Trends US thực tế hoặc cấp phép truy vấn SerpApi Google Trends cho các ứng viên đã đạt `identityStatus = "VERIFIED"` để đủ điều kiện vượt cổng `VERIFIED_EVERGREEN`.
