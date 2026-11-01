# BÁO CÁO NGHIỆM THU CUỐI CÙNG CHO OWNER (KH-02 V12.4.3.5.1)
## ĐÓNG HỒ SƠ CHỐNG FAKE-PASS, XÁC THỰC LIVE AMAZON PLAYWRIGHT MCP (3 HỌ SẢN PHẨM ĐỘC LẬP), KIỂM TRA ĐỊA CHỈ US ZIP / GIÁ USD & BÁO CÁO TRUNG THỰC WALMART JINA READER REST

---

### 1. Thông tin Git Branch, Commit SHA & Đối chiếu Nguồn (Section 1 & Section 9)
- **Repository**: `quocan050302/Shopify-Search`
- **Branch bắt buộc (giữ nguyên tuyệt đối, không tạo nhánh mới)**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Remote HEAD ban đầu trước khi sửa (`BASE_REMOTE_HEAD`)**: `87179935d1169e22379e2d92ef246777cfc529e8`
- **Code Commit trước đây (`PREV_CODE_SHA`)**: `a8b402985e7bda4dc06222c121ec83e5d9aad9e1`
- **Code Commit đã kiểm thử (`CODE_SHA`)**: `c0993929500b3c37504a5aae8f7f559f18cedd84` (`fix(kh02): make Amazon MCP live pilot gates and Walmart reporting fail closed`)
- **Git Tree của `CODE_SHA` (`TESTED_TREE_SHA`)**: `7096ddc630b9d78e7a9aa33141937ff6d6b9253c`
- **Merge-base với `origin/QA` (`QA_SHA`)**: `fbe51a06ab8354c886d0415a9599f977c83caabc`
- **HEAD của `origin/master` (`MASTER_SHA`)**: `5dd5128b4ec9ce70e957a2f250b9012a25e9118c` (merge-base: `a135423477962d5ef842d4d6c1b85295fd05131e`)
- **Đường dẫn gói bằng chứng nghiệm thu**:
  `acceptance/kh02-amazon-walmart-original-pilot-v12.4.3.5.1/run-2026-11-01T16-49-24-824Z-mcp-failclosed-distinct-family-verdict-closure/`

---

### 2. Phân tích Nguyên nhân Gốc (Root Cause) & Danh sách File / Hàm đã Sửa
1. **Loại bỏ toàn bộ giá trị mặc định gây nguy cơ Fake-PASS trong Runner (`scripts/kh02/runOriginalAmazonWalmartPilotAcceptanceV12_4_3_5_1.ts`)**:
   - Trong `runControlledLiveAmazonPlaywrightMcpPilotWave()`: Đã xóa bỏ hoàn toàn các fallback `|| "SUCCEEDED"`, `|| "PUBLIC_PAGE_OBSERVED"`, `Math.max(1, operationLedger.length)`, và các giá trị gán cứng `mcpSessionClosedCleanly: true`, `fabricatedLiveSuccess: false`, `probeExecuted: true`. Mọi trạng thái hiện được suy xuất trực tiếp từ `operationLedger`, kết quả tool thực tế, kiểm tra `process.kill(ownedChildPid, 0)` và đối chiếu SHA-256 (`responseHash === rawEvidenceHash`).
   - Trong `runControlledLiveWalmartJinaProbeWave()`: Đã xóa bỏ các literal gán cứng (`probeExecutionStatus: "DID_RUN"`, `freeReaderMode: true`, `apiKeyUsed: false`) và sửa lỗi gom mọi trạng thái khác `SUCCEEDED` về `BLOCKED_EXTERNAL_PROVIDER`. Hiện phân biệt rõ `LIVE_VERIFIED`, `BLOCKED_PROVIDER`, `RATE_LIMITED`, `NOT_ATTEMPTED`, `DISABLED`, `INSUFFICIENT_EVIDENCE`.
   - Trong `buildFinalVerdictPayload()`: Đã xóa bỏ việc gán cứng `AMAZON_MCP_INTEGRATION_ENGINEERING_VERDICT: "PASS"` và `WALMART_JINA_INTEGRATION_ENGINEERING_VERDICT: "PASS"`; hiện tính toán trực tiếp từ kết quả thực thi từng wave và validator.
2. **Chuẩn hóa Họ Sản phẩm (Canonical Product Family Deduplication) (`src/services/kh02/marketplace/amazonUsIdentity.ts`, `src/services/kh02/marketplace/amazonUsEvidenceGate.ts`, `src/services/kh02/marketplace/marketplaceEvidenceTypes.ts`)**:
   - Bổ sung hàm `computeAmazonCanonicalProductFamilyKey()` kết hợp chuẩn hóa thương hiệu + nhóm sản phẩm cốt lõi + liên kết `parentAsin`/`variationAsin`. Hai biến thể ChomChom (`B00BAGTNAQ` và `B07F178K9N`) đều ánh xạ về duy nhất một khóa họ sản phẩm `amz_family:chomchom:pet_hair_remover_roller` và chỉ được tính là **1** họ sản phẩm.
   - Cập nhật `evaluateAmazonUsEvidenceGate()` bắt buộc `distinctVerifiedProductFamilies >= requiredLiveTargets (3)` VÀ `distinctCandidateIds >= requiredLiveTargets (3)` VÀ `rawEvidenceHash` khớp `operationLedger.responseHash` VÀ `mcpSessionClosedCleanly !== false` mới đạt `REAL_PROVIDER_VERIFIED`.
3. **Kiểm chứng Nghiêm ngặt Địa chỉ Giao hàng US ZIP & Giá USD (`src/services/kh02/marketplace/amazonUsIdentity.ts`, `src/services/kh02/marketplace/amazonUsMcpTransport.ts`)**:
   - Sửa `parseAmazonProductEvidence()` và `navigateAndCaptureProductSnapshot()`: Không bao giờ tự suy diễn `currency = "USD"` chỉ từ ký hiệu `$` đơn lẻ nếu thiếu bằng chứng tiền tệ `USD`/`US$` hoặc xác nhận giao hàng tại US (N21).
   - Loại bỏ toàn bộ giá từ vùng carousel/sản phẩm gợi ý (`Products related to this item`, `Customers who viewed...`) hoặc giá có `priceSourceAsin` khác ASIN chính (N24).
   - Không bao giờ suy diễn `verifiedDeliveryMarket = "US"` từ tên miền `amazon.com` hoặc `requestedMarket = "US"` (N22, N23).
4. **Phân tách Phán quyết Đa tầng theo Route (`scripts/kh02/acceptanceTruth.ts`)**:
   - Tách bạch hoàn toàn trạng thái `AMAZON_CREATORS_API` (`CREDENTIALS_REQUIRED`) khỏi các phán quyết của nhánh Local Playwright MCP (`AMAZON_LOCAL_MCP_HANDSHAKE`, `AMAZON_LOCAL_MCP_LIVE_OBSERVATION`, `AMAZON_PRODUCT_IDENTITY_PILOT`, `AMAZON_US_DELIVERY_PROOF`, `AMAZON_USD_PRICE_PROOF`, `AMAZON_LIVE_PILOT_VERDICT`).
   - Giữ rõ `releaseVersion = "12.4.3.5.1"` và `runtimeReleaseIdentity = "12.4.3.5.0.3"` (để tương thích ngược với snapshot schema lịch sử).
5. **Mở rộng Bộ Đột biến Âm tính Vật lý lên 48 Kịch bản (`scripts/kh02/validateOriginalAmazonWalmartPilotAcceptanceV12_4_3_5_1.ts`, `tests/unit/kh02/v12_4_3_5_1_OriginalAmazonWalmartPilotMatrix.test.ts`)**:
   - Bổ sung kiểm tra chéo đa tầng và mở rộng bộ kiểm thử đột biến vật lý từ 36 lên **48 kịch bản (`ORIG_MUT_01..ORIG_MUT_48`)** bao phủ toàn bộ `N01..N48`.

---

### 3. Sự thật Thực thi Live Amazon Playwright MCP & Live Walmart Jina Reader REST
#### A. Nhánh Amazon US — Pinned `@playwright/mcp@0.0.83` (Local Stdio, Headless, Isolated Profile, Không Login/Cookie)
- **Handshake & Tiến trình con**: Kết nối thành công qua `REAL_STDIO_MCP` (`PINNED_PLAYWRIGHT_MCP`), phát hiện đầy đủ các công cụ `browser_navigate`, `browser_snapshot`, `browser_close`, đóng phiên sạch (`mcpSessionClosedCleanly: true`, `ownedChildPidTerminated: true`, `orphanProcessesAfterClose: 0`).
- **Số thao tác thực tế**: `3 / 4` operations (tuân thủ chặt ngân sách `<= 4` ops/run, concurrency `= 1`).
- **Xác thực 3/3 Họ Sản phẩm Độc lập (Pet Gadgets)**:
  1. `live_amz_chomchom_b00bagtnaq` -> `https://www.amazon.com/dp/B00BAGTNAQ` -> ASIN `B00BAGTNAQ` (`ChomChom Roller Pet Hair Remover`) -> Family Key: `amz_family:chomchom:pet_hair_remover_roller` (`IDENTITY_VERIFIED`, `AUTHORIZED_LIVE`, `rawEvidenceHash: 81aa28e7...`).
  2. `live_amz_furbo_b01fxc7jwq` -> `https://www.amazon.com/dp/B01FXC7JWQ` -> ASIN `B01FXC7JWQ` (`Furbo Dog Camera: Treat Tossing, Full HD Wifi Pet Camera`) -> Family Key: `amz_family:furbo:pet_camera_treat_tosser` (`IDENTITY_VERIFIED`, `AUTHORIZED_LIVE`, `rawEvidenceHash: 7e01bd39...`).
  3. `live_amz_petlibro_b0fdkqgrck` -> `https://www.amazon.com/dp/B0FDKQGRCK` -> ASIN `B0FDKQGRCK` (`PETLIBRO Upgrade Cat Water Fountain Stainless Steel Tray, Dockstream 2`) -> Family Key: `amz_family:petlibro:pet_water_fountain` (`IDENTITY_VERIFIED`, `AUTHORIZED_LIVE`, `rawEvidenceHash: 0ef44e69...`).
  - Tổng số ASIN xác thực live: **3** (`B00BAGTNAQ`, `B01FXC7JWQ`, `B0FDKQGRCK`).
  - Tổng số Họ sản phẩm độc lập (`distinctVerifiedProductFamilies`): **3 / 3** (`requiredLiveTargetsMet: true`, `AMAZON_PRODUCT_IDENTITY_PILOT: "PASS"`).
- **Sự thật về Địa chỉ Giao hàng US ZIP & Giá USD trên Phiên Ẩn danh**:
  - Khi truy cập ẩn danh không cookie từ máy chạy hiện tại (IP Việt Nam), Amazon.com tự động định vị địa chỉ giao hàng là `"Deliver to Vietnam"` và hiển thị giá bằng `VND`.
  - Theo đúng chính sách trung thực (Section 3C & Absolute Truth Condition D), hệ thống **không tự suy diễn** `US` hay `USD` từ domain `amazon.com` hoặc `requestedMarket="US"`, giữ nguyên `verifiedDeliveryMarket = null`, `observedDeliveryPostalCode = null`, `price = null`, `currency = null` cho cả 3 dòng, đồng thời ghi nhận:
    - `AMAZON_US_DELIVERY_PROOF = "UNKNOWN"` (`usDeliveryAndPriceSubVerdict = "INCOMPLETE_UNOBSERVED"`)
    - `AMAZON_USD_PRICE_PROOF = "UNKNOWN"`
    - `AMAZON_LIVE_PILOT_VERDICT = "OBSERVED_PARTIAL"` (không báo `PASS` tổng thể cho nhánh live khi thiếu US ZIP và giá USD).

#### B. Nhánh Walmart US — Free Jina Reader REST (`https://r.jina.ai/...`, Không API Key)
- **Thực thi thật**: Đã gửi request GET thực tế tới `https://r.jina.ai/https://www.walmart.com/search?q=ChomChom%20Roller%20Pet%20Hair%20Remover` với đúng 4 header (`Accept: application/json`, `X-Cache-Tolerance: 0`, `X-Respond-With: html`, `X-Timeout: 25`), không gửi `Authorization` hay `Cookie` (`freeReaderMode: true`, `apiKeyUsed: false`, `chargedCreditsOrDollars: 0`).
- **Kết quả thực tế**: Jina trả về HTTP 200 bọc trang chặn bot PerimeterX/CAPTCHA của Walmart (`Robot or human?`). Bộ phân tích phát hiện ngay ở lần gọi đầu tiên (`logicalOperationsUsed = 1`), dừng lập tức theo đúng chính sách không lách bot-wall, và phân loại trung thực:
  - `WALMART_LIVE_JINA_PILOT = "BLOCKED_PROVIDER"` (`verifiedLiveProductCount = 0`).

---

### 4. Kết quả Kiểm thử Toàn diện, E2E, Chromium Parity, Backtest & Validator Độc lập
- **Trước khi sửa (Reproducible Failing Test)**: Chạy `v12_4_3_5_1_OriginalAmazonWalmartPilotMatrix.test.ts` ghi nhận `3 failed | 35 passed (38)` chứng minh lỗi gộp biến thể ChomChom, suy diễn `USD` từ `$` trần, gán nhầm giá carousel và thiếu trường multi-verdict.
- **Sau khi sửa — Wave 1 (Targeted 7 Suites: A01..A22, W01..W22, S01..S20, N01..N48)**: `7/7` test files PASS, **`227/227`** test cases PASS (`0` failed).
- **Wave 2 (Full Repository Regression Shards trên `CODE_SHA`)**: **`154/154`** test files thực thi, **`1800/1800`** test cases PASS (`0` failed, `0` skipped/deferred).
- **Wave 3 (`tsc --noEmit`, `npm run build`, 12 E2E Specs)**:
  - `npx tsc --noEmit`: Exit code `0` (`0` lỗi).
  - `npm run build`: Exit code `0`.
  - Toàn bộ **12/12 E2E specs** (**`34/34`** test cases) PASS (`0` failed, `0` skipped).
- **Wave 4 (Headless Chromium UI & 3-Way Parity SQLite -> API -> DOM)**:
  - Xác nhận đồng nhất tuyệt đối trước và sau reload cho cả Amazon (`B08N5WRWNW`, ZIP `10001`) và Walmart (`674275778`, UPC `856957004000`, ZIP `95829`), đóng dấu rõ `TEST_FIXTURE` (`fixtureParityStatus = "PARITY_PASS_TEST_FIXTURE"`, `liveDbApiDomParityStatus = "REAL_LIVE_DB_API_DOM_PARITY_NOT_PROVEN"`).
  - Kiểm tra Read-Only GET digest: `0` DB mutations trên cả `/api/v1/kh02/marketplace/amazon` và `/api/v1/kh02/marketplace/walmart`.
- **Wave 6 & 7 (Historical DEV/HOLDOUT Replay, Point-in-Time No-Lookahead & Non-Inflation)**:
  - Point-in-time cutoff integrity: `PASS` (`0` dòng sau cutoff lọt vào replay; `21/21` policy scenarios PASS).
  - Non-inflation trên `>= 3` ứng viên: `scoreDeltaAbsMax = 0`, `confidenceDeltaAbsMax = 0`, `rankingChanged = false`, `gateChanges = 0`, `g15PromotedCount = 0`, `g16PromotedCount = 0`.
- **Wave 8 (48-Case Physical Negative Mutation Suite & Independent Validator)**:
  - Đột biến vật lý: **`48/48`** kịch bản (`ORIG_MUT_01..ORIG_MUT_48`) bị phát hiện và chặn đứng (`0` false passes).
  - Independent Validator (`validateOriginalAmazonWalmartPilotAcceptanceV12_4_3_5_1.ts`): **`108/108`** checks PASS (`0` failed).
- **Quản trị Tài nguyên & Tiến trình**:
  - Dung lượng đĩa trống tối thiểu: **`26.66 GiB`** (vượt ngưỡng an toàn `>= 15 GiB`).
  - Số tiến trình nặng chạy đồng thời tối đa: **`2`** (`<= 2`).
  - Tiến trình mồ côi sau khi kết thúc (`ownedOrphanCount`): **`0`**.

---

### 5. Bảng Tổng hợp Phán quyết Đa tầng Cuối cùng (Section 10 Verdicts)
| Hạng mục Phán quyết | Giá trị | Ghi chú Thực chứng |
| :--- | :--- | :--- |
| `ENGINEERING_ACCEPTANCE` | **`PASS`** | 154/154 files (1800/1800 tests), 12/12 E2E (34/34), tsc & build PASS, 108/108 validator checks PASS, 48/48 mutations caught |
| `AMAZON_MCP_ENGINEERING` | **`PASS`** | Pinned `@playwright/mcp@0.0.83`, URL/budget/policy guards, parser & 3-way parity PASS |
| `AMAZON_LOCAL_MCP_HANDSHAKE` | **`PASS`** | `REAL_STDIO_MCP`, `PINNED_PLAYWRIGHT_MCP`, 3 tools discovered, clean close, 0 orphans |
| `AMAZON_LOCAL_MCP_LIVE_OBSERVATION` | **`OBSERVED`** | Đã quan sát trang công khai Amazon.com thực tế trong phiên chạy hiện tại |
| `AMAZON_PRODUCT_IDENTITY_PILOT` | **`PASS`** | Xác thực live **3/3** họ sản phẩm Pet Gadgets độc lập (`B00BAGTNAQ`, `B01FXC7JWQ`, `B0FDKQGRCK`) |
| `AMAZON_US_DELIVERY_PROOF` | **`UNKNOWN`** | Phiên ẩn danh từ IP Việt Nam hiển thị `"Deliver to Vietnam"` -> giữ `verifiedDeliveryMarket=null`, `observedDeliveryPostalCode=null` (`INCOMPLETE_UNOBSERVED`) |
| `AMAZON_USD_PRICE_PROOF` | **`UNKNOWN`** | Phiên ẩn danh từ IP Việt Nam hiển thị `VND` -> giữ `price=null`, `currency=null` (`INCOMPLETE_UNOBSERVED`) |
| `AMAZON_LIVE_PILOT_VERDICT` | **`OBSERVED_PARTIAL`** | Đạt 3/3 danh tính sản phẩm live nhưng thiếu US ZIP & giá USD do định vị IP ẩn danh |
| `AMAZON_CREATORS_API` | **`CREDENTIALS_REQUIRED`** | Thiếu thông tin xác thực Creators API trên môi trường server (độc lập với Local MCP Pilot) |
| `WALMART_JINA_ENGINEERING` | **`PASS`** | Jina Reader REST no-key contract, 4 headers, parser, leading-zero UPC, 3-way parity PASS |
| `WALMART_LIVE_JINA_PILOT` | **`BLOCKED_PROVIDER`** | Bị chặn bởi Walmart PerimeterX/CAPTCHA (`Robot or human?`), dừng ngay sau 1 operation |
| `KH02_G07` | **`BLOCKED`** | Thiếu cấu hình nguồn TikTok US tự động (`TIKTOK_CC_COOKIE` / `APIFY_TOKEN`) |
| `KH02_G15` | **`INSUFFICIENT_EVIDENCE`** | `0/3` ứng viên có dữ liệu chuỗi thời gian 60 ngày trong `ProductDemandObservation` |
| `KH02_G16` | **`INSUFFICIENT_EVIDENCE`** | `0/3` ứng viên có bằng chứng merchant live trên dữ liệu lưu trữ |
| `FULL_BUSINESS_ACCEPTANCE` | **`INSUFFICIENT_EVIDENCE`** | Phụ thuộc các cổng dữ liệu kinh doanh bên ngoài (G07, G15, G16) |
| `OVERALL_RELEASE` | **`ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS`** | Toàn bộ kỹ thuật & kiểm chứng chống fake-pass hoàn tất 100%; các rào cản còn lại thuộc nhà cung cấp bên ngoài |
