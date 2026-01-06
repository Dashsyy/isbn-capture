# Agent Guide: ISBN Capture

```
run codex resume 019b925e-2eed-7c03-8161-aacf55f55fd3
```

## Project Summary
- Laravel app with a Vite/Tailwind frontend and Breeze auth.
- Primary goal: capture ISBN scans, persist as scan intents, enrich async.
- Source of truth for behavior: `docs/isbn_scanner_design.md`.

## Core Product Rules
- Never lose a scan: persist immediately after detection.
- Enrichment is async and retryable; do not block capture on API calls.
- Treat invalid/non-book barcodes as `INVALID` but still store them.
- Scans and orders are user-owned; always scope queries by auth user.

## Key Locations
- Backend: `app/`, `routes/`, `config/`.
- Frontend: `resources/`.
- Design spec: `docs/isbn_scanner_design.md`.
- Detail page: `resources/views/scan-intents/show.blade.php`.

## Data Model Expectations
- Use normalized ISBN-13 when possible; keep original raw barcode.
- Track status transitions: `PENDING_LOOKUP`, `FOUND`, `NOT_FOUND`, `INVALID`, `ERROR`.
- Maintain retry bookkeeping: `tryCount`, `lastTriedAt`.
- Orders are a wishlist entry created after a successful lookup; status values: `new`, `reading`, `read`, `donate`.

## Implementation Guidance
- Prefer minimal, incremental changes that preserve existing flows.
- Follow Laravel conventions for controllers, requests, and validation.
- Keep UI feedback immediate (beep/vibrate/overlay) and non-blocking.
- Use web routes with session auth + CSRF for scan intent endpoints.

## Testing / Verification
- If tests exist for the area you touch, run them.
- Otherwise, add a brief manual verification note.
