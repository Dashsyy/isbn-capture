# ISBN Capture & Enrichment Architecture

## Core Principle
- **Never lose a scan**: ISBN is captured, validated for format basics, and persisted immediately (offline-first). Enrichment is always asynchronous and retriable.
- **Event-driven flow**: `Scan → Persist (pending) → Dispatch job → Enrich/update status`.

## Feature 1: ISBN Capture (Highest Priority)
### Scanning UX Flow
1. **Camera permission + preview** (PWA-friendly, `getUserMedia`).
2. **Live barcode detection** (EAN-13, ISBN-13) using client-side decoding (e.g., `BarcodeDetector` API with polyfill such as ZXing for browsers without support).
3. **On detection**:
   - Validate pattern: EAN-13 with ISBN prefix `978`/`979`; optionally derive ISBN-10 when applicable.
   - **Persist immediately** to IndexedDB (see Feature 2) with `status: PENDING_LOOKUP`.
   - Provide **duplicate-scan suppression**: ignore repeats of the same ISBN within a cooling window (e.g., 5–10 seconds) via in-memory cache keyed by ISBN + timestamp.
   - **Feedback instantly**: play beep, vibrate (if available), and overlay bounding box + ISBN text chip.
4. **Non-ISBN barcode**: show inline warning chip “Barcode not recognized as book ISBN” without stopping the stream.

### Data Structure for Raw Scans
```ts
interface RawScan {
  id: string;              // uuid
  isbn: string;            // normalized (isbn-13 preferred)
  format: 'EAN-13' | 'ISBN-13' | 'ISBN-10';
  rawBarcode: string;      // raw text as read
  scanSource: 'camera' | 'manual';
  scannedAt: number;       // epoch ms
  status: ScanStatus;      // see Feature 3
  lastTriedAt?: number;    // for retry bookkeeping
  tryCount: number;        // number of dispatch attempts
  metadata?: BookMetadata; // nullable until resolved
  notes?: string;          // manual overrides or user notes
}

type ScanStatus = 'PENDING_LOOKUP' | 'FOUND' | 'NOT_FOUND' | 'INVALID' | 'ERROR';
```

### Error Handling for Non-Book Barcodes
- Decode step checks EAN prefix and checksum.
- If fails ISBN-specific validation, mark as `INVALID` but still store with reason.
- UI shows a non-blocking warning and keeps scanning.

## Feature 2: Immediate Persistence (Offline-first)
### IndexedDB Schema
- **DB name**: `isbn-scans`
- **Store**: `scans`
  - KeyPath: `id`
  - Indexes:
    - `isbn` (for dedupe/search)
    - `status` (for queueing/retries)
    - `scannedAt` (for history sorting)

Record shape: `RawScan` above.

### Write/Read Lifecycle
1. **Write**: on detection, transaction puts a `RawScan` with `status: PENDING_LOOKUP`, `tryCount: 0`.
2. **Read (history/search)**: queries via `status` index for pending jobs; `scannedAt` index for chronological listing; `isbn` index for exact lookup.
3. **Survivability**: IndexedDB persists across refreshes/PWA restarts; wrap access in idempotent init that upgrades schema safely.

### Retry-safe Insert Logic
- For each detection, check `isbn` index for recent entry within cooldown; if found, skip insert and surface “duplicate ignored”.
- Use `put` (idempotent by `id`) to avoid duplicate key errors; still log duplicates for analytics.

## Feature 3: Async Dispatch Job (ISBN Processing)
### Lifecycle State Diagram
```
Scan -> PENDING_LOOKUP -> FOUND
                   \-> NOT_FOUND
                   \-> INVALID
                   \-> ERROR -> retry -> PENDING_LOOKUP
```

### Job Flow
1. Triggered after successful local persist (or on background sync/visibility change).
2. Reads next `PENDING_LOOKUP` items in small batches (e.g., 3–5) to avoid UI contention.
3. For each item: validate checksum → fetch metadata → update status.

### Retry Strategy
- Exponential backoff: `delay = base * 2^tryCount` (e.g., base 15s, max 30m).
- Cap attempts (e.g., 5). After cap, mark `ERROR` with message; allow manual retry.
- Persist `lastTriedAt` and `tryCount` to compute next eligible window.

### Status Transitions
- `PENDING_LOOKUP` → `FOUND` on successful metadata fetch.
- `PENDING_LOOKUP` → `NOT_FOUND` when API returns valid ISBN but no title/author.
- `PENDING_LOOKUP` → `INVALID` when checksum/format fails before fetch.
- `PENDING_LOOKUP` → `ERROR` on network/server issues; eligible for retry with backoff.
- Manual retry: `ERROR`/`NOT_FOUND`/`INVALID` can be set back to `PENDING_LOOKUP`.

## Feature 4: ISBN Lookup & Validation
### Validation Rules
- **ISBN-13**: 13 digits; prefix `978`/`979`; checksum mod-10 with alternating weights 1/3.
- **ISBN-10**: 10 characters; allow trailing `X`; checksum mod-11 weights 1–10; convert to ISBN-13 when possible.
- Normalize input by stripping spaces/hyphens and uppercasing `X`.

### API Fallback Strategy
1. Primary: e.g., Open Library `/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data`.
2. Secondary: Google Books volumes API with ISBN query.
3. Tertiary/local cache: previously resolved metadata stored in IndexedDB/LocalStorage.
4. Short-circuit if validation fails (`INVALID`).

### Error Classification
- **INVALID**: checksum/prefix failure.
- **NOT_FOUND**: valid ISBN, APIs respond 404/empty.
- **ERROR**: transient network/server/timeouts or rate-limit (429/503); include retry-after hint.

## Feature 5: Invalid / Not Found Handling
### UX States
- List item badge + color per status (`PENDING`, `FOUND`, `INVALID`, `NOT_FOUND`, `ERROR`).
- Detail sheet shows ISBN, last attempt, error/reason, and action buttons.

### Data Model Changes
- Add `notes`/`manualTitle` (stored in `metadata.title` or separate field) and `manualOverride: boolean`.
- Keep all records; never auto-delete unresolved entries.

### Manual Override Flow
1. User taps unresolved entry → detail panel.
2. Option to **Keep as-is** or **Add manual title/author**.
3. Saving manual data sets `metadata` + `manualOverride: true`; status may remain `NOT_FOUND` but flagged as user-enriched.

## Feature 6: History & Audit Trail
### UI Wireframe (textual)
- **Screen**: “History”
  - Search bar (ISBN/title substring).
  - Status filters: `All | Pending | Found | Invalid | Error | Not found`.
  - List sorted by `scannedAt` desc:
    - Leading status badge
    - ISBN + optional title
    - Timestamp + source (camera/manual)

### Query Patterns
- Use `status` index for filtered views; fallback to client-side filter when combined with text search.
- For search by title/ISBN, maintain a simple lowercase keyword field in the record for quick matching.

### Indexing Strategy
- Indexes: `status`, `isbn`, `scannedAt`; optional `keywords` (multi-entry) for titles/authors if supported.
- Keep list virtualization for long histories.

## Feature 7: Background Retry & Sync
### Retry Policy
- Exponential backoff with jitter; max retries (e.g., 5). Respect `Retry-After` when provided.
- Resume retries when network recovers (`navigator.onLine` + periodic heartbeat).
- Batch size capped to prevent UI impact.

### State Transitions
- `ERROR` → backoff → `PENDING_LOOKUP` once delay passes.
- `NOT_FOUND` → manual retry sets back to `PENDING_LOOKUP`.

### UX Indicators
- Badge for queued retries (“Retrying in 2m”).
- Manual “Retry now” button per entry; greys out during in-flight.
- Global snackbars for recovery events (“Back online, resuming lookups”).

## Feature 8: Performance & UX Safety
### Concurrency Control
- Separate worker (Web Worker/Service Worker) for lookup queue to keep UI thread free.
- Limit concurrent fetches (e.g., 2 at a time) with a promise pool.

### Debounce Strategy
- Scan dedupe cache prevents repeated inserts; UI overlay debounced to avoid flicker.
- Throttle metadata requests per ISBN (single-flight: in-flight map keyed by ISBN to reuse promise results).

### Job Queue Design
- In-memory queue sourced from IndexedDB `PENDING_LOOKUP` entries; polled or event-driven via channel/message.
- Prioritize newest scans while respecting backoff schedules.
- Persist worker checkpoints (`lastTriedAt`, `tryCount`) to continue after refresh without replay storms.

## Additional Notes
- Implement as PWA for offline camera access and persistence; use Service Worker for background sync where supported.
- Ensure accessibility: visible focus states, haptic/audio feedback alternatives.
