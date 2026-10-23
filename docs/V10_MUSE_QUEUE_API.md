# SWAI V10 — Muse Queue & Ingestion API Specification

This document details the REST API endpoints used by the Muse AI external research agent and the SWAI frontend.

---

## Authentication

All state-changing endpoints and queue queries require authorization via:
- Header: `Authorization: Bearer <MUSE_INGESTION_TOKEN>` or `x-muse-token: <MUSE_INGESTION_TOKEN>`
- Fallback: `ADMIN_API_KEY` / `SWAI_ADMIN_TOKEN`

---

## 1. Create Research Request
- **Endpoint**: `POST /api/v1/discovery/muse/requests`
- **Body**:
  ```json
  {
    "keywords": ["pet hair remover", "lint brush"],
    "market": "US",
    "requestedLimit": 25,
    "creativePreference": "VIDEO",
    "category": "Pet Supplies"
  }
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "data": {
      "requestId": "cmvkxf38n0001mug9reabepj2",
      "syncJobId": "cmvkxf38j0000mug97reywq0o",
      "status": "PENDING",
      "providerId": "muse-ad-library",
      "platform": "META",
      "keywords": ["pet hair remover", "lint brush"],
      "targetCount": 25
    }
  }
  ```

---

## 2. List Queued Requests
- **Endpoint**: `GET /api/v1/discovery/muse/requests?status=PENDING&limit=20`
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "data": [
      {
        "requestId": "cmvkxf38n0001mug9reabepj2",
        "status": "PENDING",
        "platform": "META",
        "keywords": ["pet hair remover"],
        "market": "US",
        "targetCount": 25,
        "createdAt": "2026-10-23T12:00:00.000Z"
      }
    ]
  }
  ```

---

## 3. Claim or Update Request
- **Endpoint**: `PATCH /api/v1/discovery/muse/requests/:id`
- **Claim Body**:
  ```json
  { "action": "CLAIM" }
  ```
- **Heartbeat Body**:
  ```json
  { "status": "RUNNING" }
  ```
- **Failure Body**:
  ```json
  { "status": "FAILED", "errorMessage": "Meta Ad Library blocked request." }
  ```
- **Response** (200 OK on success, 409 Conflict if already claimed by active agent):
  ```json
  {
    "success": true,
    "data": {
      "requestId": "cmvkxf38n0001mug9reabepj2",
      "status": "CLAIMED"
    }
  }
  ```

---

## 4. Submit Research Results
- **Endpoint**: `POST /api/v1/discovery/muse/requests/:id/results`
- **Body**:
  ```json
  {
    "submissionId": "sub_unique_idempotency_key_123",
    "records": [
      {
        "libraryId": "1642750633880173",
        "advertiserName": "Uproot Clean",
        "advertiserPageId": "109823481234",
        "headline": "Uproot Clean Pet Hair Remover",
        "bodyText": "Removes pet hair in seconds.",
        "callToAction": "Shop Now",
        "landingPageUrl": "https://cc.uprootclean.com/main/phr",
        "mediaType": "VIDEO",
        "durationSeconds": 41,
        "thumbnailUrl": "https://images.checkoutchamp.com/uproot_lint_llc/product11.jpeg",
        "category": "Pet Supplies",
        "sourceReportedStartAt": "2025-11-02",
        "activeStatus": "ACTIVE",
        "facebookPlacement": "CONFIRMED"
      }
    ]
  }
  ```
- **Response** (200 OK):
  ```json
  {
    "success": true,
    "data": {
      "requestId": "cmvkxf38n0001mug9reabepj2",
      "submissionId": "sub_unique_idempotency_key_123",
      "status": "COMPLETED",
      "outcomeCategory": "COMPLETED_WITH_RESULTS",
      "totalSubmitted": 1,
      "formatValid": 1,
      "newUniqueInserted": 1,
      "existingUpdated": 0,
      "rejectedCount": 0,
      "failedCount": 0,
      "adIds": ["cmvkxf39g0003mug956198pnw"]
    }
  }
  ```

---

## 5. Bridge Health & Heartbeat
- **Status Endpoint**: `GET /api/v1/discovery/muse/bridge`
- **Heartbeat Endpoint**: `POST /api/v1/discovery/muse/bridge`
  - Body: `{ "requestId": "<optional>" }`
