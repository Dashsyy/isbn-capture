<?php

namespace App\Jobs;

use App\Models\Order;
use App\Models\ScanIntent;
use App\Services\IsbnLookupService;
use App\Support\IsbnValidator;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Bus\Queueable;
use Illuminate\Queue\SerializesModels;

class ProcessScanIntent implements ShouldQueue
{
    use Dispatchable, Queueable, SerializesModels;

    public function __construct(public int $scanIntentId)
    {
    }

    public function handle(IsbnLookupService $lookupService): void
    {
        $scanIntent = ScanIntent::find($this->scanIntentId);
        if (!$scanIntent) {
            return;
        }

        if ($scanIntent->status !== ScanIntent::STATUS_PENDING) {
            return;
        }

        $validation = IsbnValidator::classify($scanIntent->isbn);
        $now = now();

        if ($validation['status'] === ScanIntent::STATUS_INVALID) {
            $scanIntent->update([
                'status' => ScanIntent::STATUS_INVALID,
                'notes' => $validation['reason'] ?? 'Invalid ISBN',
                'last_tried_at' => $now,
                'try_count' => $scanIntent->try_count + 1,
            ]);
            return;
        }

        $result = $lookupService->lookup($validation['normalized']);

        if ($result['status'] === ScanIntent::STATUS_FOUND) {
            $scanIntent->update([
                'status' => ScanIntent::STATUS_FOUND,
                'title' => $result['title'] ?? null,
                'authors' => $result['authors'] ?? null,
                'metadata_source' => $result['source'] ?? null,
                'notes' => null,
                'last_tried_at' => $now,
                'try_count' => $scanIntent->try_count + 1,
            ]);

            Order::firstOrCreate(
                ['scan_intent_id' => $scanIntent->id],
                [
                    'user_id' => $scanIntent->user_id,
                    'isbn' => $scanIntent->isbn,
                    'status' => Order::STATUS_NEW,
                    'title' => $scanIntent->title,
                    'authors' => $scanIntent->authors,
                    'metadata_source' => $scanIntent->metadata_source,
                ]
            );

            return;
        }

        if ($result['status'] === ScanIntent::STATUS_NOT_FOUND) {
            $scanIntent->update([
                'status' => ScanIntent::STATUS_NOT_FOUND,
                'notes' => 'No metadata found via lookup.',
                'last_tried_at' => $now,
                'try_count' => $scanIntent->try_count + 1,
            ]);
            return;
        }

        $scanIntent->update([
            'status' => ScanIntent::STATUS_ERROR,
            'notes' => $result['message'] ?? 'Lookup failed',
            'last_tried_at' => $now,
            'try_count' => $scanIntent->try_count + 1,
        ]);
    }
}
