# Standard Operating Procedure (SOP): Manual Google Trends Official Explore CSV Onboarding

**Document**: `KH02_G15_G16_OFFICIAL_CSV_ONBOARDING_GUIDE_2026-11-06.md`
**Purpose**: Prescribes the exact, auditable procedure for human operators to manually acquire and ingest authentic Google Trends Explore CSV files for target candidate products (e.g. UAHPET Fresh Food Automatic Pet Feeder), enabling legitimate G15/G16 evaluation without automated scraping or paid API spend.

---

## 1. Web Export Acquisition Procedure

1. **Navigate to Official Interface**:
   - Open [Google Trends Explore](https://trends.google.com/trends/explore) in an authorized browser session.
2. **Configure Parameters**:
   - **Search Term**: Enter the product-specific search term. E.g., `automatic cat feeder` or `automatic pet feeder` or specific brand SKU `uahpet automatic feeder`.
     > [!IMPORTANT]
     > Product attribution must be exact. Do not use generic niche umbrella terms (e.g., "pet gadgets") as proof of a specific SKU's evergreen demand.
   - **Geographic Region**: Select `United States` (`geo=US`).
   - **Time Range**: Select `Past 90 days` (`date=today 3-m`) or `Past 12 months` (`date=today 12-m`). Must provide at least $\ge 60$ days of coverage to satisfy G15.
   - **Category**: Keep as `All categories` or target category (`Pet Supplies`).
   - **Search Type**: Keep as `Web Search`.
3. **Download Original CSV**:
   - Click the **Download** (CSV) icon located on the top right of the "Interest over time" chart.
   - Save the raw exported file. **DO NOT OPEN AND RE-SAVE IN EXCEL** or modify byte formatting in any text editor, as spreadsheet editors alter carriage returns (`\r\n`), timestamps, and quote encodings.

---

## 2. Evidence Context & Metadata Recording

Record the following metadata alongside the file:
- **Original Filename**: e.g., `multiTimeline.csv`
- **Capture Date & Time**: UTC timestamp of export.
- **Source Explore URL**: e.g., `https://trends.google.com/trends/explore?date=today%203-m&geo=US&q=automatic%20cat%20feeder`
- **Target Product ID / Candidate ID**: e.g., `cand_1212440541` (`cmvsy7zqh000jp0orhypwohho`)
- **Computed SHA-256 Checksum**: Computed directly from raw bytes via:
  ```powershell
  Get-FileHash -Algorithm SHA256 ./multiTimeline.csv
  ```

---

## 3. Required Header & Row Format

The validator (`googleTrendsCsvValidator.ts`) strictly requires official Google Trends structural signatures:
```csv
Category: All categories

Interest over time
Week,automatic cat feeder: (United States)
2026-08-02,78
2026-08-09,82
...
```
- Line 1 must contain `Category:` or `All categories`.
- Header must contain `Interest over time`.
- Column header must match `(Week|Day|Month|Date),<keyword>: (<Region>)`.
- Values must be integers `0–100` or `<1` (mapped safely to `0.5`).
- Must have $\ge 3$ distinct points covering $\ge 60$ days.

---

## 4. Ingestion Steps via API

Ingest the file via the authenticated API route:
```http
POST /api/v1/demand/import
Content-Type: application/json
Authorization: Bearer <USER_SESSION_TOKEN>

{
  "productId": "cmvsy7zqh000jp0orhypwohho",
  "canonicalProductName": "UAHPET Fresh Food Automatic Pet Feeder",
  "rawCsv": "<RAW_CSV_FILE_CONTENTS>"
}
```
The endpoint will:
1. Validate headers, region (`US`), and keyword alignment.
2. Compute file SHA-256 and store atomically at `data/google_trends_imports/<sha256>.csv`.
3. Verify byte integrity and row pointers.
4. Execute `executeDemandObservationBatchImport` within an isolated Prisma transaction.
5. Create durable, non-forgeable provenance record linking the candidate to authentic provider bytes.

---

## 5. Security & Isolation Safeguards

- **Ephemeral DB Testing First**: Always test newly acquired CSVs against an ephemeral or staging database before production commit.
- **Zero Lookahead**: Ensure all observation timestamps precede or equal the evaluation `asOfTimestamp`.
- **Zero Semantic Drift**: Query aliases must maintain brand/model distinctions. E.g., `uahpet feeder` is valid for UAHPET; generic `dog bowls` is rejected.
- **Relative Index Disclosure**: All imported points are classified as relative search interest index (0–100), never mislabeled as absolute search volume or revenue.
