<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <title>{{ config('app.name', 'ISBN Capture') }}</title>
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=instrument-sans:400,500,600" rel="stylesheet" />
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="bg-slate-950 text-slate-100">
    <div class="max-w-6xl mx-auto p-6 space-y-8">
        <header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <p class="text-sm uppercase tracking-wide text-amber-300">Offline-first</p>
                <h1 class="text-3xl font-semibold">ISBN Capture &amp; Enrichment</h1>
                <p class="text-slate-400">Capture first. Enrich later. Never lose a scan.</p>
            </div>
            <div class="flex gap-2">
                <span id="queue-indicator" class="text-xs px-3 py-1 rounded-full bg-slate-800 border border-slate-700">Idle</span>
                <span class="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/40">Pending <span id="pending-count">0</span></span>
            </div>
        </header>

        <section class="grid gap-6 lg:grid-cols-3">
            <div class="lg:col-span-2 space-y-4">
                <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <h2 class="text-lg font-semibold">Live Scanner</h2>
                            <p class="text-sm text-slate-400">EAN-13 / ISBN-13 detection with duplicate suppression.</p>
                        </div>
                        <div class="flex gap-2">
                            <button id="start-scan" class="px-4 py-2 rounded-md bg-emerald-500 text-slate-900 font-semibold hover:bg-emerald-400">Start</button>
                            <button id="stop-scan" class="px-4 py-2 rounded-md bg-slate-800 border border-slate-700 hover:border-slate-500">Stop</button>
                        </div>
                    </div>
                    <div class="relative mt-4 aspect-video overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                        <video id="scanner-video" class="w-full h-full object-cover" autoplay playsinline muted></video>
                        <div id="scanner-overlay" class="absolute inset-0 pointer-events-none border-4 border-emerald-400/70 rounded-xl opacity-0 transition-opacity duration-150"></div>
                        <div class="absolute bottom-3 left-3 text-sm px-3 py-2 rounded-md bg-black/60 backdrop-blur border border-slate-800" id="scan-status">
                            Camera idle. Start scanning to capture ISBNs.
                        </div>
                    </div>
                    <div id="feedback" class="mt-3 text-sm text-slate-200" data-level="info">Ready to capture.</div>
                </div>

                <form id="manual-form" class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 grid gap-3 md:grid-cols-[1fr_auto]">
                    <div class="space-y-1">
                        <label for="manual-input" class="text-sm text-slate-300">Manual ISBN entry (fallback)</label>
                        <input id="manual-input" name="manual" class="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none" placeholder="9780143127741" autocomplete="off" />
                    </div>
                    <div class="flex items-end">
                        <button type="submit" class="w-full rounded-md bg-amber-500 text-slate-950 font-semibold px-4 py-2 hover:bg-amber-400">Save ISBN</button>
                    </div>
                </form>
            </div>

            <div class="space-y-4">
                <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-2">
                    <h3 class="text-lg font-semibold">Guidelines</h3>
                    <ul class="text-sm text-slate-300 space-y-2 list-disc list-inside">
                        <li>Capture is immediate and stored offline (IndexedDB).</li>
                        <li>Duplicate scans ignored within a short window.</li>
                        <li>Lookup happens asynchronously; scanning stays responsive.</li>
                        <li>Invalid/non-book barcodes are kept and flagged.</li>
                    </ul>
                </div>
                <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
                    <h3 class="text-lg font-semibold">Filters</h3>
                    <div class="space-y-2">
                        <label class="text-sm text-slate-400">Status</label>
                        <select id="filter-status" class="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 focus:border-emerald-400 focus:outline-none">
                            <option value="all">All</option>
                            <option value="PENDING_LOOKUP">Pending</option>
                            <option value="FOUND">Found</option>
                            <option value="INVALID">Invalid</option>
                            <option value="NOT_FOUND">Not Found</option>
                            <option value="ERROR">Error</option>
                        </select>
                    </div>
                    <div class="space-y-2">
                        <label class="text-sm text-slate-400">Search</label>
                        <input id="search-term" class="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none" placeholder="ISBN or title" autocomplete="off" />
                    </div>
                </div>
            </div>
        </section>

        <section class="space-y-3">
            <div class="flex items-center justify-between">
                <h2 class="text-xl font-semibold">History &amp; Audit</h2>
                <p class="text-sm text-slate-400">Chronological log of all scans (camera + manual).</p>
            </div>
            <div id="history-list" class="space-y-3"></div>
        </section>
    </div>
</body>
</html>
