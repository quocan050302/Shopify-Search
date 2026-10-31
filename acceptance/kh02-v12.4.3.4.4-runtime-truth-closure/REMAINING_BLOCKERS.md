# Remaining External Blockers & Owner Actions

## 1. Google Cloud BigQuery ADC (Gate G09)
- **Status**: `BLOCKED_CONFIGURATION`
- **Impact**: Real BigQuery upstream calls fail closed safely with zero cost.
- **Required Owner Action**: Run `gcloud auth application-default login` and configure `BIGQUERY_PROJECT_ID` in `.env.local`.

## 2. G15 Evergreen Longitudinal Demand (Gate G15)
- **Status**: `INSUFFICIENT_EVIDENCE` (0/3 Qualifying)
- **Impact**: Public BigQuery Top Terms dataset does not index arbitrary e-commerce SKU terms.
- **Required Owner Action**: Provide official Google Trends CSV exports for target SKUs via the authorized CSV import mechanism.

## 3. G16 Verified Live Top-3 (Gate G16)
- **Status**: `INSUFFICIENT_EVIDENCE` (2/3 Verified)
- **Impact**: UAHPET and KittySpout are verified live; UprootClean CheckoutChamp funnel retains PROBABLE status.
- **Required Owner Action**: None required in code; awaits either additional live merchant candidate discovery or merchant domain linking.
