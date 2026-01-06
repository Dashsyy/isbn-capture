import './bootstrap';

const dedupeWindowMs = 8000;
const jobIntervalMs = 5000;
const jobBatchSize = 3;
const maxRetries = 5;
const baseBackoffMs = 15000;

const dbName = 'isbn-scans';
const dbVersion = 1;
const storeName = 'scans';

const state = {
    scanning: false,
    scanFrameId: null,
    stream: null,
    detector: null,
    permissionStatus: 'unknown',
    lastSeenIsbn: new Map(),
    scansCache: [],
    processingQueue: false,
    filter: 'all',
    search: '',
    inFlightLookups: new Map(),
};

let beepContext;

const ui = {};

document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    bindUi();
    openDatabase().then(refreshHistory);
    initPermissions();
    maybeInitDetector();
    startJobLoop();
});

function cacheDom() {
    ui.video = document.getElementById('scanner-video');
    ui.startButton = document.getElementById('start-scan');
    ui.stopButton = document.getElementById('stop-scan');
    ui.scanStatus = document.getElementById('scan-status');
    ui.feedback = document.getElementById('feedback');
    ui.manualForm = document.getElementById('manual-form');
    ui.manualInput = document.getElementById('manual-input');
    ui.historyList = document.getElementById('history-list');
    ui.pendingBadge = document.getElementById('pending-count');
    ui.queueBadge = document.getElementById('queue-indicator');
    ui.filterSelect = document.getElementById('filter-status');
    ui.searchInput = document.getElementById('search-term');
    ui.scannerOverlay = document.getElementById('scanner-overlay');
    ui.permissionNotice = document.getElementById('permission-notice');
    ui.permissionAction = document.getElementById('permission-action');
}

function bindUi() {
    ui.startButton?.addEventListener('click', startScanning);
    ui.stopButton?.addEventListener('click', stopScanning);
    ui.permissionAction?.addEventListener('click', requestCameraPermission);

    ui.manualForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = ui.manualInput.value.trim();
        if (!value) {
            setFeedback('Enter an ISBN to add it manually.', 'warning');
            return;
        }
        handleDetection(value, 'manual');
        ui.manualInput.value = '';
    });

    ui.filterSelect?.addEventListener('change', () => {
        state.filter = ui.filterSelect.value;
        renderHistory(state.scansCache);
    });

    ui.searchInput?.addEventListener('input', () => {
        state.search = ui.searchInput.value.trim().toLowerCase();
        renderHistory(state.scansCache);
    });

    window.addEventListener('online', processQueue);
}

function initPermissions() {
    if (!navigator.permissions?.query) {
        updatePermissionNotice('Click "Start" and allow camera access when prompted.');
        return;
    }
    navigator.permissions
        .query({ name: 'camera' })
        .then((status) => {
            state.permissionStatus = status.state;
            renderPermissionState();
            status.onchange = () => {
                state.permissionStatus = status.state;
                renderPermissionState();
            };
        })
        .catch(() => {
            updatePermissionNotice('Click "Start" and allow camera access when prompted.');
        });
}

function renderPermissionState() {
    if (state.permissionStatus === 'granted') {
        updatePermissionNotice('Camera ready. Start scanning when you are ready.', false);
        return;
    }
    if (state.permissionStatus === 'denied') {
        updatePermissionNotice('Camera is blocked. Please enable camera access in your browser settings.', true);
        return;
    }
    updatePermissionNotice('Allow camera access to scan barcodes. Your scans stay local until lookup.', true);
}

function updatePermissionNotice(message, showAction = false) {
    if (ui.permissionNotice) {
        ui.permissionNotice.textContent = message;
    }
    if (ui.permissionAction) {
        ui.permissionAction.classList.toggle('hidden', !showAction);
    }
}

async function requestCameraPermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
        setFeedback('Camera API not available in this browser. Use manual entry.', 'error');
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        stream.getTracks().forEach((track) => track.stop());
        state.permissionStatus = 'granted';
        renderPermissionState();
        setFeedback('Camera permission granted. You can start scanning.', 'success');
    } catch (error) {
        state.permissionStatus = 'denied';
        renderPermissionState();
        setFeedback('Camera permission denied. Enable it to scan barcodes.', 'error');
    }
}

async function maybeInitDetector() {
    if ('BarcodeDetector' in window) {
        try {
            state.detector = new BarcodeDetector({ formats: ['ean_13'] });
            setFeedback('Barcode Detector available. Start scanning when ready.', 'info');
            return;
        } catch (error) {
            console.error('BarcodeDetector init failed', error);
        }
    }
    setFeedback('Barcode Detector not available. Use manual entry or a supported browser.', 'warning');
}

async function startScanning() {
    if (!state.detector) {
        setFeedback('Cannot start scanning: BarcodeDetector not available.', 'error');
        return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
        setFeedback('Camera API not available in this browser. Use manual entry.', 'error');
        return;
    }

    if (state.permissionStatus === 'denied') {
        setFeedback('Camera is blocked. Enable permission to scan.', 'error');
        renderPermissionState();
        return;
    }

    if (state.scanning) {
        return;
    }

    try {
        state.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' },
            },
        });
        ui.video.srcObject = state.stream;
        await ui.video.play();
        state.scanning = true;
        ui.scanStatus.textContent = 'Camera active. Looking for ISBN-13 (EAN) barcodes...';
        scanLoop();
    } catch (error) {
        console.error('Unable to start camera', error);
        setFeedback('Camera access failed. Check permissions or use manual entry.', 'error');
    }
}

function stopScanning() {
    state.scanning = false;
    ui.scanStatus.textContent = 'Scanner stopped.';
    if (state.scanFrameId) {
        cancelAnimationFrame(state.scanFrameId);
    }
    if (state.stream) {
        state.stream.getTracks().forEach((track) => track.stop());
        state.stream = null;
    }
}

function scanLoop() {
    if (!state.scanning) {
        return;
    }

    state.scanFrameId = requestAnimationFrame(scanLoop);
    if (!state.detector || ui.video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
        return;
    }

    state.detector
        .detect(ui.video)
        .then((codes) => {
            if (!state.scanning || !codes?.length) {
                return;
            }
            const primary = codes[0];
            if (primary?.rawValue) {
                handleDetection(primary.rawValue, 'camera');
                flashOverlay();
            }
        })
        .catch((error) => {
            console.error('Detection error', error);
        });
}

function flashOverlay() {
    if (!ui.scannerOverlay) return;
    ui.scannerOverlay.classList.add('opacity-100');
    setTimeout(() => ui.scannerOverlay.classList.remove('opacity-100'), 120);
}

function normalizeIsbn(value) {
    return value.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function checksumIsbn13(isbn) {
    const digits = isbn.split('').map((char) => Number(char));
    const sum = digits
        .slice(0, 12)
        .reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
    const mod = sum % 10;
    const check = (10 - mod) % 10;
    return check === digits[12];
}

function checksumIsbn10(isbn) {
    const chars = isbn.split('');
    const sum = chars.slice(0, 9).reduce((acc, digit, idx) => acc + Number(digit) * (10 - idx), 0);
    const checksumChar = chars[9];
    const checksumValue = checksumChar === 'X' ? 10 : Number(checksumChar);
    const total = sum + checksumValue;
    return total % 11 === 0;
}

function isbn10To13(isbn10) {
    const core = isbn10.slice(0, 9);
    const prefixed = `978${core}`;
    const digits = prefixed.split('').map((d) => Number(d));
    const sum = digits.reduce((acc, digit, idx) => acc + digit * (idx % 2 === 0 ? 1 : 3), 0);
    const check = (10 - (sum % 10)) % 10;
    return `${prefixed}${check}`;
}

function classifyIsbn(rawValue) {
    const normalized = normalizeIsbn(rawValue);
    if (!normalized) {
        return { status: 'INVALID', reason: 'Empty scan', normalized };
    }

    if (normalized.length === 13) {
        if (!/^[0-9]{13}$/.test(normalized)) {
            return { status: 'INVALID', reason: 'ISBN-13 must be digits only', normalized, format: 'ISBN-13' };
        }
        if (!normalized.startsWith('978') && !normalized.startsWith('979')) {
            return { status: 'INVALID', reason: 'Non-book EAN prefix', normalized, format: 'EAN-13' };
        }
        if (!checksumIsbn13(normalized)) {
            return { status: 'INVALID', reason: 'Invalid ISBN-13 checksum', normalized, format: 'ISBN-13' };
        }
        return { status: 'PENDING_LOOKUP', normalized, format: 'ISBN-13' };
    }

    if (normalized.length === 10) {
        if (!/^[0-9]{9}[0-9X]$/.test(normalized)) {
            return { status: 'INVALID', reason: 'Invalid ISBN-10 characters', normalized, format: 'ISBN-10' };
        }
        if (!checksumIsbn10(normalized)) {
            return { status: 'INVALID', reason: 'Invalid ISBN-10 checksum', normalized, format: 'ISBN-10' };
        }
        return {
            status: 'PENDING_LOOKUP',
            normalized: isbn10To13(normalized),
            format: 'ISBN-10',
        };
    }

    return { status: 'INVALID', reason: 'Unsupported barcode length', normalized };
}

async function handleDetection(rawValue, scanSource) {
    const now = Date.now();
    const result = classifyIsbn(rawValue);
    const isbnKey = result.normalized || rawValue;

    state.lastSeenIsbn.forEach((timestamp, isbn) => {
        if (now - timestamp > dedupeWindowMs * 4) {
            state.lastSeenIsbn.delete(isbn);
        }
    });

    if (state.lastSeenIsbn.has(isbnKey)) {
        const lastSeen = state.lastSeenIsbn.get(isbnKey);
        if (now - lastSeen < dedupeWindowMs) {
            setFeedback(`Duplicate ignored (${isbnKey})`, 'warning');
            return;
        }
    }
    state.lastSeenIsbn.set(isbnKey, now);

    const scan = {
        id: crypto.randomUUID(),
        isbn: isbnKey,
        format: result.format || 'UNKNOWN',
        rawBarcode: rawValue,
        scanSource,
        scannedAt: now,
        status: result.status,
        lastTriedAt: undefined,
        tryCount: 0,
        metadata: null,
        notes: result.reason,
    };

    await upsertScan(scan);
    await refreshHistory();

    if (scan.status === 'PENDING_LOOKUP') {
        feedbackSuccess(isbnKey);
        processQueue();
    } else {
        setFeedback(result.reason || 'Stored invalid barcode', 'warning');
    }
}

function feedbackSuccess(isbn) {
    setFeedback(`Captured ${isbn} and queued for lookup.`, 'success');
    if (navigator.vibrate) {
        navigator.vibrate(120);
    }
    playBeep();
}

function playBeep() {
    try {
        beepContext = beepContext || new AudioContext();
        const duration = 0.12;
        const oscillator = beepContext.createOscillator();
        const gain = beepContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, beepContext.currentTime);
        oscillator.connect(gain);
        gain.connect(beepContext.destination);
        oscillator.start();
        oscillator.stop(beepContext.currentTime + duration);
    } catch (error) {
        console.debug('Beep not available', error);
    }
}

function setFeedback(message, level = 'info') {
    if (!ui.feedback) return;
    ui.feedback.textContent = message;
    ui.feedback.dataset.level = level;
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(storeName)) {
                const store = db.createObjectStore(storeName, { keyPath: 'id' });
                store.createIndex('isbn', 'isbn', { unique: false });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('scannedAt', 'scannedAt', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getDb() {
    if (!state.dbPromise) {
        state.dbPromise = openDatabase();
    }
    return state.dbPromise;
}

async function upsertScan(scan) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(storeName).put(scan);
    });
}

async function listScans() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const scans = [];
        tx.oncomplete = () => resolve(scans);
        tx.onerror = () => reject(tx.error);
        const cursor = tx.objectStore(storeName).index('scannedAt').openCursor(null, 'prev');
        cursor.onsuccess = (event) => {
            const row = event.target.result;
            if (row) {
                scans.push(row.value);
                row.continue();
            }
        };
    });
}

async function refreshHistory() {
    state.scansCache = await listScans();
    renderHistory(state.scansCache);
}

function renderHistory(scans) {
    if (!ui.historyList) return;
    ui.historyList.innerHTML = '';

    const filtered = scans.filter((scan) => {
        const matchesStatus = state.filter === 'all' || scan.status === state.filter;
        const term = state.search;
        const matchesSearch =
            !term ||
            scan.isbn.toLowerCase().includes(term) ||
            scan.metadata?.title?.toLowerCase().includes(term) ||
            scan.notes?.toLowerCase().includes(term);
        return matchesStatus && matchesSearch;
    });

    filtered.forEach((scan) => {
        const item = document.createElement('div');
        item.className =
            'rounded-lg border border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between';
        item.innerHTML = `
            <div class="space-y-1">
                <div class="flex items-center gap-2">
                    ${statusBadge(scan.status)}
                    <span class="font-mono text-lg">${scan.isbn}</span>
                    <span class="text-xs text-slate-400">${scan.format || ''}</span>
                </div>
                <div class="text-sm text-slate-300">
                    ${scan.metadata?.title || 'Awaiting metadata'}${scan.metadata?.authors ? ` • ${scan.metadata.authors.join(', ')}` : ''}
                </div>
                <div class="text-xs text-slate-500">
                    ${new Date(scan.scannedAt).toLocaleString()} • Source: ${scan.scanSource}
                </div>
                ${scan.notes ? `<div class="text-xs text-amber-300">Note: ${scan.notes}</div>` : ''}
            </div>
            <div class="flex flex-wrap gap-2">
                ${renderActions(scan)}
            </div>
        `;
        const retryButton = item.querySelector(`[data-retry="${scan.id}"]`);
        if (retryButton) {
            retryButton.addEventListener('click', () => manualRetry(scan.id));
        }
        const manualButton = item.querySelector(`[data-manual="${scan.id}"]`);
        if (manualButton) {
            manualButton.addEventListener('click', () => promptManualTitle(scan.id));
        }
        ui.historyList.appendChild(item);
    });

    ui.pendingBadge.textContent = scans.filter((s) => s.status === 'PENDING_LOOKUP').length;
}

function statusBadge(status) {
    const styles = {
        PENDING_LOOKUP: 'bg-amber-500/20 text-amber-200 border border-amber-500/40',
        FOUND: 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40',
        INVALID: 'bg-rose-500/20 text-rose-200 border border-rose-500/40',
        NOT_FOUND: 'bg-sky-500/20 text-sky-200 border border-sky-500/40',
        ERROR: 'bg-orange-500/20 text-orange-200 border border-orange-500/40',
    };
    const label =
        status === 'PENDING_LOOKUP'
            ? 'Pending'
            : status === 'NOT_FOUND'
              ? 'Not Found'
              : status;
    return `<span class="px-2 py-1 text-xs rounded-md ${styles[status] || 'bg-slate-600/30 text-slate-200'}">${label}</span>`;
}

function renderActions(scan) {
    const retryable = ['ERROR', 'NOT_FOUND', 'INVALID'].includes(scan.status);
    const retryBtn = retryable
        ? `<button data-retry="${scan.id}" class="px-3 py-1 text-xs rounded-md border border-slate-700 bg-slate-800 hover:border-amber-400">Retry</button>`
        : '';
    const manualBtn =
        scan.status !== 'FOUND'
            ? `<button data-manual="${scan.id}" class="px-3 py-1 text-xs rounded-md border border-slate-700 bg-slate-800 hover:border-emerald-400">Add title</button>`
            : '';

    return `${retryBtn}${manualBtn}`;
}

async function manualRetry(id) {
    const scan = state.scansCache.find((item) => item.id === id);
    if (!scan) return;
    await upsertScan({
        ...scan,
        status: 'PENDING_LOOKUP',
        notes: scan.notes,
        lastTriedAt: undefined,
        tryCount: scan.tryCount || 0,
    });
    await refreshHistory();
    processQueue();
}

async function promptManualTitle(id) {
    const scan = state.scansCache.find((item) => item.id === id);
    if (!scan) return;
    const title = prompt('Add a manual title for this ISBN:', scan.metadata?.title || '');
    if (title === null) {
        return;
    }
    const metadata = {
        ...(scan.metadata || {}),
        title: title || 'Untitled entry',
        manualOverride: true,
    };
    await upsertScan({
        ...scan,
        metadata,
        status: scan.status === 'FOUND' ? 'FOUND' : 'NOT_FOUND',
        notes: scan.notes,
    });
    await refreshHistory();
}

function startJobLoop() {
    processQueue();
    setInterval(processQueue, jobIntervalMs);
}

async function processQueue() {
    if (state.processingQueue) return;
    state.processingQueue = true;
    updateQueueBadge('Processing');
    try {
        const pending = state.scansCache.filter(isEligibleForLookup).slice(0, jobBatchSize);
        for (const scan of pending) {
            await handleLookup(scan);
        }
    } finally {
        state.processingQueue = false;
        updateQueueBadge('Idle');
        await refreshHistory();
    }
}

function updateQueueBadge(text) {
    if (ui.queueBadge) {
        ui.queueBadge.textContent = text;
    }
}

function isEligibleForLookup(scan) {
    if (scan.status === 'PENDING_LOOKUP') {
        return true;
    }
    if (scan.status === 'ERROR' && scan.tryCount < maxRetries) {
        const delay = Math.min(baseBackoffMs * 2 ** scan.tryCount, 30 * 60 * 1000);
        const nextAllowed = (scan.lastTriedAt || 0) + delay;
        return Date.now() >= nextAllowed;
    }
    return false;
}

async function handleLookup(scan) {
    const now = Date.now();
    const validation = classifyIsbn(scan.isbn);
    if (validation.status === 'INVALID') {
        await upsertScan({
            ...scan,
            status: 'INVALID',
            notes: validation.reason,
            lastTriedAt: now,
            tryCount: scan.tryCount + 1,
        });
        return;
    }

    const result = await lookupIsbn(validation.normalized);
    if (result.status === 'FOUND') {
        await upsertScan({
            ...scan,
            status: 'FOUND',
            metadata: result.metadata,
            lastTriedAt: now,
            tryCount: scan.tryCount + 1,
            notes: undefined,
        });
        return;
    }

    if (result.status === 'NOT_FOUND') {
        await upsertScan({
            ...scan,
            status: 'NOT_FOUND',
            metadata: null,
            lastTriedAt: now,
            tryCount: scan.tryCount + 1,
            notes: 'No metadata found via lookup.',
        });
        return;
    }

    await upsertScan({
        ...scan,
        status: 'ERROR',
        lastTriedAt: now,
        tryCount: scan.tryCount + 1,
        notes: result.message || 'Lookup failed',
    });
}

async function lookupIsbn(isbn) {
    if (state.inFlightLookups.has(isbn)) {
        return state.inFlightLookups.get(isbn);
    }
    const promise = performLookup(isbn).finally(() => state.inFlightLookups.delete(isbn));
    state.inFlightLookups.set(isbn, promise);
    return promise;
}

async function performLookup(isbn) {
    const openLibrary = await queryOpenLibrary(isbn);
    if (openLibrary.status === 'FOUND') {
        return openLibrary;
    }
    if (openLibrary.status === 'ERROR' && openLibrary.retryable) {
        return openLibrary;
    }

    const google = await queryGoogleBooks(isbn);
    if (google.status === 'FOUND') {
        return google;
    }
    if (google.status === 'ERROR' && google.retryable) {
        return google;
    }

    if (openLibrary.status === 'NOT_FOUND' && google.status === 'NOT_FOUND') {
        return { status: 'NOT_FOUND' };
    }

    return { status: 'ERROR', message: openLibrary.message || google.message, retryable: true };
}

async function queryOpenLibrary(isbn) {
    try {
        const response = await fetchWithTimeout(`https://openlibrary.org/isbn/${isbn}.json`, { timeout: 7000 });
        if (response.status === 404) {
            return { status: 'NOT_FOUND' };
        }
        if (!response.ok) {
            return { status: 'ERROR', message: 'Open Library error', retryable: response.status >= 500 };
        }
        const data = await response.json();
        const authors = Array.isArray(data.authors)
            ? data.authors.map((author) => author.name || author.key).filter(Boolean)
            : [];
        return {
            status: 'FOUND',
            metadata: {
                title: data.title,
                authors,
                source: 'Open Library',
            },
        };
    } catch (error) {
        return { status: 'ERROR', message: error.message, retryable: true };
    }
}

async function queryGoogleBooks(isbn) {
    try {
        const response = await fetchWithTimeout(
            `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`,
            { timeout: 7000 }
        );
        if (!response.ok) {
            return { status: 'ERROR', message: 'Google Books error', retryable: response.status >= 500 };
        }
        const data = await response.json();
        if (!data.totalItems) {
            return { status: 'NOT_FOUND' };
        }
        const item = data.items[0]?.volumeInfo;
        return {
            status: 'FOUND',
            metadata: {
                title: item?.title || 'Unknown title',
                authors: item?.authors || [],
                source: 'Google Books',
            },
        };
    } catch (error) {
        return { status: 'ERROR', message: error.message, retryable: true };
    }
}

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000, ...rest } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, { ...rest, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(id);
    }
}
