# KH-01 V11.4.2 — Destination-Pinned Public Research Transport Report

## Executive Summary
This document records the design, implementation, and empirical verification of the destination-pinned public research transport created in SWAI V11.4.2 under Master Plan KH-01 Checkpoint 2.

---

## 1. Problem Solved: DNS Rebinding & TOCTOU Vulnerability
Previously, URL validation resolved DNS via `resolveAndValidatePublicDestination(hostname)` and then invoked global `fetch(url)`. This created a Time-of-Check to Time-of-Use (TOCTOU) gap where an attacker-controlled authoritative DNS server could respond with a legitimate public IP during validation and subsequently return an internal IP (`127.0.0.1` or `169.254.169.254`) when `fetch()` re-resolved the host.

---

## 2. Pinned Transport Architecture (`src/services/links/verifiedPublicTransport.ts`)
The new transport solves this at the socket layer:
1. **Pre-Validation**: `resolveAndValidatePublicDestination` verifies all A and AAAA records against the restricted IP blocklist.
2. **Pinned Socket Lookup**: `createVerifiedPublicDispatcher` supplies a custom `lookup` handler to the Node.js `http.Agent` / `https.Agent`. The socket connection is physically bound to `destination.selectedAddress`. No secondary DNS resolution can occur.
3. **TLS SNI & Host Header**: Sets `servername: destination.normalizedHostname` and `Host: destination.normalizedHostname`, ensuring full SNI support for CDNs and Cloudflare.
4. **Certificate Verification**: Enforces `rejectUnauthorized: true`. TLS certificates are strictly validated against `destination.normalizedHostname`.
5. **Streaming Payload Protection**: Stream chunks are monitored on the fly. If incoming bytes exceed `maxResponseBytes` (default 2MB), the response is truncated and the socket is destroyed immediately to prevent memory exhaustion.
6. **Hop-by-Hop Redirect Isolation**: Each redirect hop destroys the current transport, fully re-validates the new destination URL and IP, and instantiates an isolated transport.

---

## 3. Test Verification
- `tests/unit/verifiedTransport.test.ts`: Passed (3/3 tests)
  - Pinned IP binding verification
  - AbortSignal termination
  - Bounded payload truncation
- `tests/unit/kh01Security.test.ts`: Passed (30/30 tests)
  - Loopback, private IPv4/IPv6, cloud metadata, hex/octal, and IPv4-mapped IPv6 rejection.
