# KH-02 V12.4.3.7.19.3.2.9 — Baseline C0, Branch, Tree & Call-Graph Audit

## 1. Repository & Branch Lock Verification
- **Repository**: `quocan050302/Shopify-Search` (`https://github.com/quocan050302/Shopify-Search.git`)
- **Locked Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Observed Baseline Remote HEAD (`C0`)**: `3c60dfc7c1657c8c3c3e6bbeee19809e29a49df4`
- **Observed Baseline Tree (`Tree(C0)`)**: `d002df2d091b2a1721391e2adf258ba509e08d1d`
- **Prior V19.3.2.8 Tested Code Commit**: `16e6f1ca3ea5ab08d9b40afe89795c050e7545e3`
- **V19.3.2.9 Initial Workflow Commit**: `cdb3aa14690e62cf269e0d1457a00918dd983c2c` (triggered initial GitHub Actions run `42335392227`)
- **V19.3.2.9 CI Bootstrap Commit**: `70b08f19e30648e6b3c2c239cf7b26bfa460582e` (triggered GitHub Actions run `42338116837`, 5/6 jobs green)
- **V19.3.2.9 Final Tested & Pushed Code + Workflow Commit (`C1` / `HEAD`)**: `cbc2eddfad582800f4bc26c9691216e413ab0666`
- **V19.3.2.9 Final Tested Source Tree (`Tree(C1)`)**: `1d906fb040de164e3d365fd7b5449d81b1fed7aa`
- **Remote Branch Sync Status**: `origin/feature/kh02-walmart-us-jina-reader-v12.4.3.5.1 === cbc2eddfad582800f4bc26c9691216e413ab0666` (0 ahead, 0 behind; ordinary fast-forward push only; no rebase, no merge, no force-push, no reset).

## 2. Host Hardware, OS & Billing/Free-Tier Baseline
- **OS / Platform**: Windows (`win32`, `x64`), Node.js `v22.14.0`
- **CPU Cores**: 12 logical cores (`VITEST_MAX_WORKERS` bounded to `<= 4` for unit, `1` for serialized SQLite integration; runner DAG concurrency `<= 2`)
- **Free Disk at Preflight**: `66,968,055,808` bytes (`~62.37 GiB`, strictly above the `2.0 GiB` hard floor)
- **Free RAM at Preflight**: `5,202,878,464` bytes (`~4.85 GiB`, strictly above the `1.5 GiB` hard floor)
- **GitHub Repository Visibility & Free-Tier Status**:
  - Verified via `GET https://api.github.com/repos/quocan050302/Shopify-Search` (`HTTP 200`): `"private": false`, `"visibility": "public"`.
  - GitHub Actions standard Linux runners (`ubuntu-24.04`) are free ($0.00 cost) for public repositories, and every job in `.github/workflows/kh02-ci.yml` enforces `if: github.repository_visibility == 'public'`.
  - Prior to V19.3.2.9 (`C0`), `.github/workflows/` did not exist (`total_count: 0` on `/actions/workflows`).
