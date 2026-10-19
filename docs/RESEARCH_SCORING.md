# Winning Potential Research Scoring Engine (WPS)

## 1. Core Principles
The **Winning Potential Score (WPS)** is an objective, multi-factor research priority index rated from **0 to 100**.

> **Important**: This score does NOT guarantee sales profitability or financial return. It measures observable market validation, creative effort, and advertising persistence to help researchers prioritize products worth studying.

---

## 2. Mathematical Model & Component Weights

The score is computed as a weighted combination of normalized signals:

$$\text{WPS} = \sum_{i} (w_i \times S_i)$$

Where:
- $w_i$ is the weight of signal $i$.
- $S_i \in [0, 100]$ is the normalized score of signal $i$.

### Signal Breakdown:
1. **Observed Longevity ($w_1 = 0.25$)**:
   - Days an advertisement has been observed actively running.
   - Long-running ads strongly indicate ongoing positive advertiser ROI (advertisers rarely pay for unprofitable ads for 30–90+ consecutive days).
   - Normalization: $\min(100, \frac{\text{daysActive}}{90} \times 100)$.

2. **Creative Diversity & Iterations ($w_2 = 0.20$)**:
   - Number of distinct creative variations, hooks, or aspect ratios tested by the same advertiser for this product.
   - Indicates serious scaling and creative testing budget.
   - Normalization: $\min(100, \frac{\text{variantCount}}{10} \times 100)$.

3. **Genuine Performance Signals ($w_3 = 0.20$)**:
   - Authentic engagement metrics (observable likes, shares, comments, or official platform transparency impression brackets).
   - Missing metrics are handled gracefully (see Section 3).

4. **Recent Active Recency ($w_4 = 0.15$)**:
   - Recency of last observed impression or ad status.
   - Active within 48h: 100 pts; 7 days: 80 pts; 30 days: 40 pts; >60 days: 10 pts.

5. **Product & Offer Clarity ($w_5 = 0.10$)**:
   - Technical readability of landing page, explicit pricing observed, functional CTA, clear product niche.

6. **AI Creative Assessment ($w_6 = 0.10$)**:
   - Hook strength (0-3s retention hook), problem-solution structure, UGC quality, and emotional pacing.

---

## 3. Handling Missing Metrics
When public platforms restrict certain metrics (such as exact impression counts or CTR):
- Missing metrics are **NEVER filled with synthetic zeros or invented numbers**.
- The scoring engine normalizes across the subset of available signals by redistributing missing weights proportionally.
- Each calculation returns an accompanying **Evidence Confidence Score (ECS)**.

$$\text{ECS} = \frac{\text{Sum of Available Signal Weights}}{\text{Total Possible Weights}} \times \text{Source Trust Factor}$$

Confidence Tiers:
- **`HIGH`** ($\ge 80\%$): Complete observation history with verified provider backing.
- **`MEDIUM`** ($50\% - 79\%$): Strong observational data with some restricted private metrics.
- **`LOW`** ($< 50\%$): Single-point observation or newly imported ad URL.
