# KH-01 V11.4.4 — Baseline Operational Specification

**Target Version**: V11.4.4  
**Date**: 2026-10-24  
**Branch**: `feature/v11-meta-collector-remove-muse`  
**Base Commit**: `53e6feb5ce1290b37317c6249dbe2d6cbf45141c`  
**Operating Mode**: `RESEARCH_ONLY`  

## System Architecture Overview
The KH-01 system (Shopify Winning Ads Intelligence) bridges real Meta advertisements to product identity, landing page analysis, observed offers, financial unit economics, six-pillar opportunity evaluation, and human research decisions.

```
Real Meta Ad -> Product Identity -> Competitor Product -> Research Job
      |
      v
Isolated DB Claim -> Atomic Worker Execution -> Landing Snapshot + Offer Snapshot + Research Evidence
      |
      v
Real Next.js HTTP API (Port 127.0.0.1:<port>)
      |
      v
Real Browser E2E Interaction (/products/:id/intelligence)
      |
      v
Unit Economics + Six Pillars -> Honest Recommendation -> Human Decision
```

## Baseline Testing Verification
- **Unit & Integration Suite**: 36 test files, 370 tests passing via Vitest.
- **Type Checking**: Clean TypeScript compilation (`tsc --noEmit`).
- **Safety Foundations**: Canonical SQLite path checking, active database collision defense, and lazy transaction proxy.
