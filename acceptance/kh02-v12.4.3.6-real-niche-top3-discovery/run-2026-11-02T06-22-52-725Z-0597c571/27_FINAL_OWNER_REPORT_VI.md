# BÁO CÁO NGHIỆM THU KỸ THUẬT & DỮ LIỆU THỰC TẾ — KH-02 V12.4.3.6

## 1. Thông tin nhánh, SHA & Phạm vi thực thi
- **Repository**: `quocan050302/Shopify-Search`
- **Branch (giữ nguyên tuyệt đối)**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Baseline HEAD trước V12.4.3.6**: `b656a71ed6b43e040aa0000ebeb7b071ea6e9a39`
- **Commit 1 (Code SHA được kiểm thử)**: `0597c5717d13b5749e039bd6777aea12e910d08b` (Tree SHA: `8bb850abe46cd1ef2efe45092e1c00f49e513574`)
- **Thư mục bằng chứng nghiệm thu**: `acceptance/kh02-v12.4.3.6-real-niche-top3-discovery/run-2026-11-02T06-22-52-725Z-0597c571`

## 2. Kết quả đóng các lỗ hổng P0 trong KH-02 V12.4.3.6
1. **Biên tin cậy chuẩn hóa quan sát nguồn (`normalizeSourceObservation`)**:
   - Đã loại bỏ hoàn toàn `Math.random()` khỏi `src/services/kh02/identity/productCandidateDiscovery.ts` (`mathRandomCount = 0`).
   - Quan sát thiếu `sourceRecordId` được gán mã băm tất định `derived_obs_<16hex>` kèm `sourceIdOrigin = "INTERNAL_DERIVED"` và không bao giờ được tính là bằng chứng live độc lập của nhà cung cấp.
   - Quan sát thiếu `provenance` mặc định về `"UNKNOWN"` (tuyệt đối không mặc định `"LIVE_PROVIDER"`).
   - `verifiedDeliveryMarket` giữ nguyên `null` trừ khi trang đích xác nhận rõ ràng giao hàng tại US.
   - Các bản ghi placeholder `"Ad:raw"`, dấu thời gian tương lai (`> now + 5m`), xung đột cờ `isCached` / `LIVE_PROVIDER`, hoặc khác `workspaceId` đều bị từ chối fail-closed.
2. **Đường ống phát hiện sản phẩm động cho 2 ngách độc lập (`"Pet Gadgets"` vs `"Home Organization"`)**:
   - Bộ lập kế hoạch truy vấn (`buildKH02DiscoveryQueryPlan`), bộ lọc sản phẩm vật lý thực tế (`productRealityStatus`), gom cụm danh tính & gia đình sản phẩm (`familyKey`), và xếp hạng Top 3 chạy hoàn toàn động theo ngách người dùng nhập.
   - Hai ngách `"Pet Gadgets"` và `"Home Organization"` sinh ra tập truy vấn, tập ứng viên và Top 3 hoàn toàn tách biệt (`crossNicheShortlistOverlapCount = 0`, `crossNicheDomOverlapCount = 0`).
   - Kiểm chứng tính tất định: đảo ngược thứ tự đầu vào cho ra cùng danh sách Top 3 và cùng thứ tự xếp hạng (`reversedOrderProducesIdenticalShortlist = true`).
   - Tuyệt đối không độn (pad) cho đủ 3 sản phẩm khi chỉ có 1 hoặc 2 sản phẩm đạt chuẩn; ứng viên Provisional không bao giờ xuất hiện trong `evergreenWinners`.
3. **Chọn mục tiêu Amazon động (`selectDynamicAmazonVerificationTargets`) & Đóng phiên Playwright MCP cùng session**:
   - Các mục tiêu kiểm chứng Amazon US được chọn động từ shortlist của ngách đang chạy kèm sổ cái quyết định `targetSelectionLedger`.
   - Thực thi qua `@playwright/mcp@0.0.70` (`REAL_STDIO_MCP`) xác minh 3 gia đình sản phẩm thực tế khác nhau (`B00BAGTNAQ` ChomChom, `B01FXC7JWQ` Furbo, `B0FDKQGRCK` PETLIBRO) trong giới hạn `<= 4` thao tác/lần chạy.
   - Cùng phiên `sessionId = pw_mcp_mvyvgzpr_7d0156b4` đã đóng sạch sau khi công cụ cuối cùng hoàn tất (`mcpSessionClosedCleanly = true`, `ownedChildPidTerminated = true`).
   - Phiên duyệt ẩn danh hiện tại hiển thị giao hàng Việt Nam/VND nên `usDeliveryConfirmedCount = 0`, `observedUsdPriceCount = 0`: phân loại trung thực `AMAZON_PRODUCT_IDENTITY_PILOT = PASS`, `AMAZON_US_DELIVERY_PRICE_LIVE_PILOT = OBSERVED_PARTIAL`.
4. **Tạm dừng vận hành Walmart Live an toàn (`PAUSED_EXTERNAL`) & Giữ nguyên bằng chứng lịch sử**:
   - Chính sách mặc định giữ `featureEnabled = false`, `liveAllowed = false`, `operationalStatus = "PAUSED_EXTERNAL"`, `upstreamBlockerStatus = "BLOCKED_PROVIDER"`.
   - Số lượng request HTTP Walmart thực tế phát sinh trong toàn bộ quá trình chạy V12.4.3.6: **0 request** (`currentRunLiveWalmartHttpRequests = 0`).
   - Lưu trữ nguyên vẹn biên nhận chặn CAPTCHA thực tế ngày 2026-11-02 (`16,845 bytes`, SHA-256 `d2e2fcd4b0b64ca67ef00bb7026736592060526b29ac9546b51498f4750f0fd4`, `Robot or human?`, `px-captcha`, 0 sản phẩm xác thực) và giữ rõ bản chạy 21/21 ngày 2026-10-30 là `HISTORICAL_ONLY`.

## 3. Kết quả kiểm thử, Hồi quy toàn kho, E2E, Backtest & Đột biến vật lý
- **Ma trận đối chứng âm 48 kịch bản (`N01..N48` + `P01..P03`)**: `51/51` PASS.
- **Toàn bộ kho kiểm thử (Full Repository Regression)**: `155/155` tệp (`100%`), `1852/1852` test cases PASS, `0` lỗi.
- **12/12 bộ E2E (Playwright Chromium + Server Integration)**: `12/12` specs, `34/34` cases PASS, `0` bị bỏ qua.
- **Đồng nhất 3 chiều DB -> API -> Chromium DOM & Reload cho 2 ngách + Live Amazon**: PASS (`0` sai lệch trước và sau `page.reload()`).
- **Historical Replay Point-in-Time (không rò rỉ tương lai)**:
  - `DEV`: `19` quan sát, `0` shortlist, `0` danh tính xác thực -> `INSUFFICIENT_HISTORICAL_EVIDENCE`.
  - `HOLDOUT`: `380` quan sát, `3` sản phẩm shortlist khớp ngách, `0` danh tính xác thực độc lập -> `INSUFFICIENT_HISTORICAL_EVIDENCE`.
- **Đột biến âm vật lý (Physical Negative Mutation Suite)**: `52/52` đột biến bị bắt (`falsePassesCount = 0`), cây mã nguồn sạch tuyệt đối.
- **Quản trị tiến trình & Tài nguyên**: tối đa `2/2` tiến trình nặng đồng thời, dung lượng đĩa trống tối thiểu `64.79 GiB` (`>= 15 GiB`), `0` tiến trình mồ côi.

## 4. Bảng phán quyết phát hành chính thức (Section 16)
| Hạng mục | Phán quyết |
|---|---|
| `ENGINEERING_FOUNDATION` | **`PASS`** |
| `NICHE_TO_TOP3_DISCOVERY_PIPELINE` | **`PASS`** |
| `PROVENANCE_NORMALIZATION_TRUST_BOUNDARY` | **`PASS`** |
| `IDENTITY_AND_FAMILY_DEDUPLICATION` | **`PASS`** |
| `TWO_NICHE_DYNAMIC_DISCOVERY_PROOF` | **`PASS`** |
| `DB_API_UI_PARITY` | **`PASS`** |
| `AMAZON_LOCAL_MCP_ENGINEERING` | **`PASS`** |
| `AMAZON_PRODUCT_IDENTITY_PILOT` | **`PASS`** |
| `AMAZON_US_DELIVERY_PRICE_LIVE_PILOT` | **`OBSERVED_PARTIAL`** |
| `AMAZON_CREATORS_API` | **`BLOCKED_MISSING_CREDENTIALS`** |
| `WALMART_JINA_ENGINEERING` | **`PASS`** |
| `WALMART_LIVE_OPERATIONAL_STATUS` | **`PAUSED_BLOCKED_PROVIDER`** |
| `POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY` | **`PASS`** |
| `HISTORICAL_BUSINESS_EVIDENCE` | **`INSUFFICIENT_EVIDENCE`** |
| `G07_PAID_MEDIA_PERSISTENCE` | **`BLOCKED`** |
| `G15_LONGITUDINAL_DEMAND_60D` | **`INSUFFICIENT_EVIDENCE`** |
| `G16_INDEPENDENT_MERCHANT_PROOF` | **`INSUFFICIENT_EVIDENCE`** |
| `KH02_FULL_BUSINESS_ACCEPTANCE` | **`INSUFFICIENT_EVIDENCE`** |
| `OVERALL_RELEASE` | **`ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS`** |
