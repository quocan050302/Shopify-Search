# SWAI KH-02 — Leaderboard User Interface Specification
**Document ID:** `KH02_05_LEADERBOARD_UI`  
**Module:** KH-02 — Evergreen Winning Products Intelligence (V12.0)  
**Primary Route:** `/products`  
**Date:** October 26, 2026  
**Status:** IMPLEMENTED  

---

## 1. Visual Hierarchy & Aesthetic Direction

The KH-02 Leaderboard adopts the visual hierarchy of the user-provided leaderboard reference, adapted into a high-density, professional SaaS commercial intelligence workspace.

```text
+------------------------------------------------------------------------------------------------+
|  SWAI V12.0 - Evergreen Winning Products Intelligence                                         |
|  [Trophy] EVERGREEN OPPORTUNITY LEADERBOARD                                                   |
|                                                                                                |
|  [ Search Niche: "Pet Gadgets" ]  [ 30D | 90D* | 180D | 365D ]  [ Analyze Evergreen Niche ]   |
|  Sources: [Meta: Active] [TikTok Ads: US] [TikTok Organic: Metered] [Google Ads: Domains]      |
+------------------------------------------------------------------------------------------------+
|                                                                                                |
|  #1 GOLD PODIUM ROW (Border: #F4C95D)                                                          |
|  [ THUMB / PLAY ]  Reusable Pet Hair Remover Roller                 Score: 84/100              |
|                    Problem: Eliminates embedded pet fur from sofa   Confidence: 78%            |
|                    Category: Pet Gadgets | Domain: cleanpaws.com    [ Inspect Analysis -> ]    |
|                                                                                                |
|  #2 ICE BLUE ROW (Border: #66C9EB)                                                             |
|  [ THUMB / PLAY ]  Ultrasonic Dog Bark Deterrent Device             Score: 78/100              |
|                    Problem: Stops neighbor dog barking humanely     Confidence: 72%            |
|                    Category: Pet Gadgets | Domain: barksafe.co      [ Inspect Analysis -> ]    |
|                                                                                                |
|  #3 CORAL ROW (Border: #F48B87)                                                                |
|  [ THUMB / PLAY ]  Hands-Free Dog Leash with Shock Absorber         Score: 71/100              |
|                    Problem: Prevents leash pulling wrist strain     Confidence: 68%            |
|                    Category: Pet Gadgets | Domain: roamcanine.com   [ Inspect Analysis -> ]    |
|                                                                                                |
|  OTHER RESEARCHED CANDIDATES (#4 - #15)                                                        |
|  #4 Silicone Pet Grooming Glove                                     Score: 66/100  [ View ]    |
|  #5 Portable Dog Water Bottle Dispenser                             Score: 64/100  [ View ]    |
+------------------------------------------------------------------------------------------------+
```

---

## 2. Color Palette & Visual Tokens

| Ranking Position | Border Token | Badge Token | Description |
| :--- | :--- | :--- | :--- |
| **#1 Winner** | `#F4C95D` (Gold / Champagne) | `bg-[#F4C95D] text-black` | First-place gold accent with subtle radiant glow. |
| **#2 Contender** | `#66C9EB` (Ice Blue / Cyan) | `bg-[#66C9EB] text-black` | Second-place silver/cyan accent. |
| **#3 Opportunity**| `#F48B87` (Coral / Rose) | `bg-[#F48B87] text-black` | Third-place warm rose accent. |
| **Secondary #4+** | `#261d40` (Muted Violet) | `bg-[#141026] text-slate-400` | Compact rows for secondary candidates. |
| **Background** | `#0B1020` | Dark Navy Base | Low-glare dark dashboard background. |
| **Panels** | `#161228` / `#1D1733` | Rich Deep Purple | Elevation and containment for leaderboard cards. |

---

## 3. Key Functional Capabilities

1. **Live Niche Research:** Researchers can input arbitrary consumer product niches (e.g. `Pet Gadgets`, `Home Cleaning`, `Kitchen Organization`, `Car Accessories`) and select time horizons (30D, 90D, 180D, 365D).
2. **Video & Thumbnail Previews:** Product cards display verified video thumbnails or genuine product photography with interactive play overlays where playable.
3. **No-Fabrication Fallback:** If fewer than 3 products satisfy evergreen thresholds, the UI displays a clean informative banner rather than fabricating false winners.
4. **Catalog Backward Compatibility:** A persistent view mode toggle preserves full access to all historical database SKUs and stored `ResearchProduct` records (`All Researched SKUs`).

---

## 4. Verification Checkpoint

The leaderboard UI is implemented in:
- `src/app/products/page.tsx`

Phase 5 requirements are fulfilled.
