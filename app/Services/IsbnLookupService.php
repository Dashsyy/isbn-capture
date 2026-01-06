<?php

namespace App\Services;

use App\Models\ScanIntent;
use Illuminate\Support\Facades\Http;

class IsbnLookupService
{
    public function lookup(string $isbn): array
    {
        try {
            $response = Http::withHeaders([
                'User-Agent' => 'BookScanner/1.0 (sunhour012@gmail.com)',
                'Accept' => 'application/json',
            ])
                ->timeout(5)
                ->get('https://openlibrary.org/api/books', [
                    'bibkeys' => "ISBN:$isbn",
                    'format'  => 'json',
                    'jscmd'   => 'data',
                ]);

            if (!$response->ok()) {
                return [
                    'status' => ScanIntent::STATUS_ERROR,
                    'message' => 'OpenLibrary HTTP error',
                ];
            }

            $payload = $response->json();
            $book = $payload["ISBN:$isbn"] ?? null;

            if (!$book) {
                return [
                    'status' => ScanIntent::STATUS_NOT_FOUND,
                ];
            }

            return [
                'status'  => ScanIntent::STATUS_FOUND,
                'title'   => $book['title'] ?? null,
                'authors' => collect($book['authors'] ?? [])
                    ->pluck('name')
                    ->all(),
                'source'  => 'open_library',
            ];
        } catch (\Throwable $e) {
            return [
                'status' => ScanIntent::STATUS_ERROR,
                'message' => $e->getMessage(),
            ];
        }
    }
}
