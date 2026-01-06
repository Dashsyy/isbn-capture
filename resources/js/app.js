import './bootstrap';

import Alpine from 'alpinejs';

window.Alpine = Alpine;

Alpine.start();

const dedupeWindowMs = 8000;
const themeStorageKey = 'isbn-theme';

const state = {
    scanning: false,
    scanFrameId: null,
    stream: null,
    detector: null,
    lastSeenIsbn: new Map(),
    scansCache: [],
    filter: 'all',
    search: '',
};

let beepContext;

const ui = {};

document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    bindUi();
    if (!ui.video || !ui.historyList) {
        return;
    }
    initTheme();
    refreshHistory();
    maybeInitDetector();
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
    ui.themeToggle = document.getElementById('theme-toggle');
}

function bindUi() {
    ui.startButton?.addEventListener('click', startScanning);
    ui.stopButton?.addEventListener('click', stopScanning);

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

    ui.themeToggle?.addEventListener('click', toggleTheme);

    window.addEventListener('online', refreshHistory);
}

function initTheme() {
    const saved = localStorage.getItem(themeStorageKey);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    if (ui.themeToggle) {
        ui.themeToggle.textContent = isDark ? 'Light mode' : 'Dark mode';
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    const next = isDark ? 'light' : 'dark';
    localStorage.setItem(themeStorageKey, next);
    applyTheme(next);
}

function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content;
}

async function apiRequest(path, options = {}) {
    const csrfToken = getCsrfToken();
    const response = await fetch(path, {
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {}),
            ...(options.headers || {}),
        },
        credentials: 'same-origin',
        ...options,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Request failed');
    }

    if (response.status === 204) {
        return null;
    }

    return response.json();
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

    try {
        const response = await createScanIntent(rawValue, scanSource);
        if (response?.duplicate) {
            setFeedback(`Duplicate ignored (${isbnKey})`, 'warning');
            return;
        }
        await refreshHistory();

        if (result.status === 'PENDING_LOOKUP') {
            feedbackSuccess(isbnKey);
        } else {
            setFeedback(result.reason || 'Stored invalid barcode', 'warning');
        }
    } catch (error) {
        console.error('Unable to save scan', error);
        setFeedback('Unable to save scan. Check connection and retry.', 'error');
    }
}

async function createScanIntent(rawBarcode, scanSource) {
    return apiRequest('/scan-intents', {
        method: 'POST',
        body: JSON.stringify({
            raw_barcode: rawBarcode,
            scan_source: scanSource,
        }),
    });
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

async function refreshHistory() {
    try {
        const response = await apiRequest('/scan-intents');
        state.scansCache = response?.data || [];
        renderHistory(state.scansCache);
    } catch (error) {
        console.error('Unable to refresh history', error);
        setFeedback('Unable to load scan history.', 'error');
    }
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
            'rounded-lg border border-slate-200 bg-white/80 p-4 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100 flex flex-col gap-2 md:flex-row md:items-center md:justify-between';
        item.innerHTML = `
            <div class="space-y-1">
                <div class="flex items-center gap-2">
                    ${statusBadge(scan.status)}
                    <span class="font-mono text-lg">${scan.isbn}</span>
                    <span class="text-xs text-slate-500 dark:text-slate-400">${scan.format || ''}</span>
                </div>
                <div class="text-sm text-slate-700 dark:text-slate-300">
                    ${scan.metadata?.title || 'Awaiting metadata'}${scan.metadata?.authors ? ` • ${scan.metadata.authors.join(', ')}` : ''}
                </div>
                ${scan.order ? `<div class="text-xs text-slate-500 dark:text-slate-400">Order status: ${scan.order.status}</div>` : ''}
                <div class="text-xs text-slate-500 dark:text-slate-500">
                    ${new Date(scan.scannedAt).toLocaleString()} • Source: ${scan.scanSource}
                </div>
                ${scan.notes ? `<div class="text-xs text-amber-600 dark:text-amber-300">Note: ${scan.notes}</div>` : ''}
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

    const pendingCount = scans.filter((s) => s.status === 'PENDING_LOOKUP').length;
    ui.pendingBadge.textContent = pendingCount;
    updateQueueBadge(pendingCount > 0 ? 'Queued' : 'Idle');
}

function statusBadge(status) {
    const styles = {
        PENDING_LOOKUP: 'bg-amber-500/20 text-amber-700 border border-amber-500/40 dark:text-amber-200',
        FOUND: 'bg-emerald-500/20 text-emerald-700 border border-emerald-500/40 dark:text-emerald-200',
        INVALID: 'bg-rose-500/20 text-rose-700 border border-rose-500/40 dark:text-rose-200',
        NOT_FOUND: 'bg-sky-500/20 text-sky-700 border border-sky-500/40 dark:text-sky-200',
        ERROR: 'bg-orange-500/20 text-orange-700 border border-orange-500/40 dark:text-orange-200',
    };
    const label =
        status === 'PENDING_LOOKUP'
            ? 'Pending'
            : status === 'NOT_FOUND'
              ? 'Not Found'
              : status;
    return `<span class="px-2 py-1 text-xs rounded-md ${styles[status] || 'bg-slate-200 text-slate-700 dark:bg-slate-600/30 dark:text-slate-200'}">${label}</span>`;
}

function renderActions(scan) {
    const retryable = ['ERROR', 'NOT_FOUND', 'INVALID'].includes(scan.status);
    const retryBtn = retryable
        ? `<button data-retry="${scan.id}" class="px-3 py-1 text-xs rounded-md border border-slate-300 bg-white hover:border-amber-400 dark:border-slate-700 dark:bg-slate-800">Retry</button>`
        : '';
    const manualBtn =
        scan.status !== 'FOUND'
            ? `<button data-manual="${scan.id}" class="px-3 py-1 text-xs rounded-md border border-slate-300 bg-white hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800">Add title</button>`
            : '';
    const detailLink = `<a href="/scan-intents/${scan.id}" class="px-3 py-1 text-xs rounded-md border border-slate-300 bg-white hover:border-slate-500 dark:border-slate-700 dark:bg-slate-800">Details</a>`;

    return `${detailLink}${retryBtn}${manualBtn}`;
}

async function manualRetry(id) {
    try {
        await apiRequest(`/scan-intents/${id}/retry`, { method: 'POST' });
        await refreshHistory();
    } catch (error) {
        console.error('Unable to retry scan', error);
        setFeedback('Unable to retry scan.', 'error');
    }
}

async function promptManualTitle(id) {
    const scan = state.scansCache.find((item) => item.id === id);
    if (!scan) return;
    const title = prompt('Add a manual title for this ISBN:', scan.metadata?.title || '');
    if (title === null) {
        return;
    }

    try {
        await apiRequest(`/scan-intents/${id}/manual-title`, {
            method: 'POST',
            body: JSON.stringify({ title }),
        });
        await refreshHistory();
    } catch (error) {
        console.error('Unable to save manual title', error);
        setFeedback('Unable to save manual title.', 'error');
    }
}

function updateQueueBadge(text) {
    if (ui.queueBadge) {
        ui.queueBadge.textContent = text;
    }
}
