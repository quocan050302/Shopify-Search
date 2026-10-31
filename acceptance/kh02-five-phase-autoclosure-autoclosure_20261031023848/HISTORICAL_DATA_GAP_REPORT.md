# Historical Data Gap and Point-in-Time Replay Report

## Executive Summary
- **Policy Scenarios**: 14/14 deterministic policy scenarios passed (Category A).
- **DEV Partition Replay**: Evaluated 19 historical ad records <= asOf. Reconstructed 10 candidate products.
- **HOLDOUT Partition Replay**: Evaluated 380 historical ad records <= asOf. Reconstructed 274 candidate products.
- **Anti-Leakage**: Zero future records leaked into either DEV or HOLDOUT partitions. Negative controls confirmed future-dated ads/observations are strictly excluded.
- **Demand Coverage Gap**: Neither DEV nor HOLDOUT candidate products possessed >= 26 weekly longitudinal points from authorized providers. Honest verdict: `INSUFFICIENT_HISTORICAL_EVIDENCE` (Zero false PASS).
