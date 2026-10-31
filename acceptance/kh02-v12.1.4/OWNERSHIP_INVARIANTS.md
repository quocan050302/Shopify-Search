# SWAI KH-02 V12.1.4 — Ownership Invariants & CAS Specifications

## Core Invariants
1. **Single Authorized Owner:** Exactly one worker process holds the active lease for a RUNNING job at any time.
2. **Dedicated Columns:** Authorization checks query dedicated columns: `workerId`, `claimToken`, `fencingToken`, `fencingGeneration`, `recordVersion`, `leaseExpiresAt`. No JSON substring searches.
3. **Fencing Generation Monotonicity:** `fencingGeneration` increments ONLY when a job transitions from PENDING to RUNNING under a new claim or recovery. It NEVER increments during heartbeat lease renewal.
4. **Record Version Monotonicity:** `recordVersion` increments atomically on every authorized mutation (progress, heartbeat, snapshot commit).
5. **Write-Time Expiry Validation:** Recovery updates atomically verify `leaseExpiresAt <= now` at write time. If a heartbeat extended the lease first, recovery updates 0 rows and leaves the active owner undisturbed.
6. **Stale Worker Rejection:** Any write from a worker holding a stale generation or expired lease is rejected with 0 rows affected.
