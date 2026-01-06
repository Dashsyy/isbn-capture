<?php

namespace App\Services;

class IsbnLookupService
{
    public function lookup(string $isbn): array
    {
        $lastDigit = intval(substr($isbn, -1));

        if ($lastDigit % 2 === 0) {
            return [
                'status' => 'FOUND',
                'title' => "Sample Book {$isbn}",
                'authors' => ['Demo Author'],
                'source' => 'Dummy Service',
            ];
        }

        return [
            'status' => 'NOT_FOUND',
        ];
    }
}
