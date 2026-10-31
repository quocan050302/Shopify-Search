# Free Source Coverage Limitation Decision

## 1. G15 Demand Gate Reality
G15 requires at least 3 distinct products with >= 26 weekly longitudinal search volume data points from an authorized source.
- **BigQuery Public Data**: Only indexes top macro queries. Arbitrary product SKUs are absent (`UNSUPPORTED_FREE_SOURCE`).
- **Google Trends Explore**: Not accessible via official free automated API.
- **Truthful Outcome**: 0/3 products qualify under G15 without external manual CSV imports. This is an honest external data limitation, not a code defect.

## 2. G16 Merchant Identity Gate Reality
G16 requires 3 live verified distinct products in the same run.
- **UAHPET**: Verified with JSON-LD on `uahpet.com`.
- **KittySpout**: Verified with JSON-LD on `kittyspout.com`.
- **UprootClean**: Operates on a CheckoutChamp funnel (`cc.uprootclean.com/main/phr`) lacking standard root JSON-LD merchant schema. Under strict identity rules, it remains `PROBABLE` and cannot be fraudulently upgraded to `VERIFIED`.
- **Truthful Outcome**: 2/3 products verified live.
