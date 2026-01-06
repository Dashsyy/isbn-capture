<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessScanIntent;
use App\Models\Order;
use App\Models\ScanIntent;
use App\Support\IsbnValidator;
use Illuminate\Http\Request;

class ScanIntentController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        $status = $request->query('status');
        $search = trim((string) $request->query('search', ''));

        $query = $user->scanIntents()->with('order')->orderByDesc('scanned_at');

        if ($status && $status !== 'all') {
            $query->where('status', $status);
        }

        if ($search !== '') {
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('isbn', 'like', "%{$search}%")
                    ->orWhere('title', 'like', "%{$search}%")
                    ->orWhere('notes', 'like', "%{$search}%");
            });
        }

        $scans = $query->limit(200)->get();

        return response()->json([
            'data' => $scans->map(fn (ScanIntent $scan) => $this->serializeScan($scan)),
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        $validated = $request->validate([
            'raw_barcode' => ['required', 'string', 'max:50'],
            'scan_source' => ['required', 'in:camera,manual'],
        ]);

        $result = IsbnValidator::classify($validated['raw_barcode']);
        $isbn = $result['normalized'] ?: $validated['raw_barcode'];

        $duplicate = $user->scanIntents()
            ->where('isbn', $isbn)
            ->where('scanned_at', '>=', now()->subSeconds(8))
            ->orderByDesc('scanned_at')
            ->first();

        if ($duplicate) {
            return response()->json([
                'data' => $this->serializeScan($duplicate),
                'duplicate' => true,
            ]);
        }

        $scanIntent = ScanIntent::create([
            'user_id' => $user->id,
            'isbn' => $isbn,
            'raw_barcode' => $validated['raw_barcode'],
            'format' => $result['format'] ?? 'UNKNOWN',
            'scan_source' => $validated['scan_source'],
            'scanned_at' => now(),
            'status' => $result['status'],
            'notes' => $result['reason'] ?? null,
        ]);

        if ($scanIntent->status === ScanIntent::STATUS_PENDING) {
            ProcessScanIntent::dispatch($scanIntent->id);
        }

        return response()->json([
            'data' => $this->serializeScan($scanIntent),
        ]);
    }

    public function retry(Request $request, ScanIntent $scanIntent)
    {
        $this->authorizeScanIntent($request, $scanIntent);
        $scanIntent->update([
            'status' => ScanIntent::STATUS_PENDING,
            'last_tried_at' => null,
            'notes' => $scanIntent->notes,
        ]);

        ProcessScanIntent::dispatch($scanIntent->id);

        return response()->json([
            'data' => $this->serializeScan($scanIntent->fresh()),
        ]);
    }

    public function manualTitle(Request $request, ScanIntent $scanIntent)
    {
        $this->authorizeScanIntent($request, $scanIntent);
        $validated = $request->validate([
            'title' => ['nullable', 'string', 'max:255'],
        ]);

        $title = $validated['title'] !== null && $validated['title'] !== ''
            ? $validated['title']
            : 'Untitled entry';

        $scanIntent->update([
            'title' => $title,
            'metadata_source' => 'Manual',
            'manual_override' => true,
            'status' => $scanIntent->status === ScanIntent::STATUS_FOUND ? ScanIntent::STATUS_FOUND : ScanIntent::STATUS_NOT_FOUND,
        ]);

        return response()->json([
            'data' => $this->serializeScan($scanIntent->fresh()),
        ]);
    }

    public function show(Request $request, ScanIntent $scanIntent)
    {
        $this->authorizeScanIntent($request, $scanIntent);

        return view('scan-intents.show', [
            'scanIntent' => $scanIntent->load('order'),
            'orderStatuses' => [
                Order::STATUS_NEW,
                Order::STATUS_READING,
                Order::STATUS_READ,
                Order::STATUS_DONATE,
            ],
        ]);
    }

    public function updateOrderStatus(Request $request, ScanIntent $scanIntent)
    {
        $this->authorizeScanIntent($request, $scanIntent);

        $validated = $request->validate([
            'status' => [
                'required',
                'string',
                'in:' . implode(',', [
                    Order::STATUS_NEW,
                    Order::STATUS_READING,
                    Order::STATUS_READ,
                    Order::STATUS_DONATE,
                ]),
            ],
        ]);

        $order = $scanIntent->order;
        if (!$order) {
            return redirect()
                ->back()
                ->withErrors(['status' => 'Order not created yet.']);
        }

        $order->update([
            'status' => $validated['status'],
        ]);

        return redirect()->back()->with('status', 'Order status updated.');
    }

    private function serializeScan(ScanIntent $scan): array
    {
        return [
            'id' => $scan->id,
            'isbn' => $scan->isbn,
            'format' => $scan->format,
            'rawBarcode' => $scan->raw_barcode,
            'scanSource' => $scan->scan_source,
            'scannedAt' => $scan->scanned_at?->valueOf(),
            'status' => $scan->status,
            'lastTriedAt' => $scan->last_tried_at?->valueOf(),
            'tryCount' => $scan->try_count,
            'metadata' => [
                'title' => $scan->title,
                'authors' => $scan->authors,
                'source' => $scan->metadata_source,
                'manualOverride' => $scan->manual_override,
            ],
            'notes' => $scan->notes,
            'order' => $scan->order
                ? [
                    'id' => $scan->order->id,
                    'status' => $scan->order->status,
                ]
                : null,
        ];
    }

    private function authorizeScanIntent(Request $request, ScanIntent $scanIntent): void
    {
        if ($scanIntent->user_id !== $request->user()->id) {
            abort(403);
        }
    }
}
