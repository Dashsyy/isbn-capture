<?php

namespace App\Support;

class IsbnValidator
{
    public static function normalize(string $value): string
    {
        return strtoupper(preg_replace('/[^0-9Xx]/', '', $value) ?? '');
    }

    public static function classify(string $rawValue): array
    {
        $normalized = self::normalize($rawValue);

        if ($normalized === '') {
            return [
                'status' => 'INVALID',
                'reason' => 'Empty scan',
                'normalized' => '',
            ];
        }

        if (strlen($normalized) === 13) {
            if (!preg_match('/^[0-9]{13}$/', $normalized)) {
                return [
                    'status' => 'INVALID',
                    'reason' => 'ISBN-13 must be digits only',
                    'normalized' => $normalized,
                    'format' => 'ISBN-13',
                ];
            }
            if (!str_starts_with($normalized, '978') && !str_starts_with($normalized, '979')) {
                return [
                    'status' => 'INVALID',
                    'reason' => 'Non-book EAN prefix',
                    'normalized' => $normalized,
                    'format' => 'EAN-13',
                ];
            }
            if (!self::checksumIsbn13($normalized)) {
                return [
                    'status' => 'INVALID',
                    'reason' => 'Invalid ISBN-13 checksum',
                    'normalized' => $normalized,
                    'format' => 'ISBN-13',
                ];
            }

            return [
                'status' => 'PENDING_LOOKUP',
                'normalized' => $normalized,
                'format' => 'ISBN-13',
            ];
        }

        if (strlen($normalized) === 10) {
            if (!preg_match('/^[0-9]{9}[0-9X]$/', $normalized)) {
                return [
                    'status' => 'INVALID',
                    'reason' => 'Invalid ISBN-10 characters',
                    'normalized' => $normalized,
                    'format' => 'ISBN-10',
                ];
            }
            if (!self::checksumIsbn10($normalized)) {
                return [
                    'status' => 'INVALID',
                    'reason' => 'Invalid ISBN-10 checksum',
                    'normalized' => $normalized,
                    'format' => 'ISBN-10',
                ];
            }

            return [
                'status' => 'PENDING_LOOKUP',
                'normalized' => self::isbn10To13($normalized),
                'format' => 'ISBN-10',
            ];
        }

        return [
            'status' => 'INVALID',
            'reason' => 'Unsupported barcode length',
            'normalized' => $normalized,
        ];
    }

    private static function checksumIsbn13(string $isbn): bool
    {
        $digits = array_map('intval', str_split($isbn));
        $sum = 0;
        foreach (array_slice($digits, 0, 12) as $index => $digit) {
            $sum += $digit * ($index % 2 === 0 ? 1 : 3);
        }
        $check = (10 - ($sum % 10)) % 10;
        return $check === $digits[12];
    }

    private static function checksumIsbn10(string $isbn): bool
    {
        $chars = str_split($isbn);
        $sum = 0;
        foreach (array_slice($chars, 0, 9) as $index => $digit) {
            $sum += intval($digit) * (10 - $index);
        }
        $checksumChar = $chars[9];
        $checksumValue = $checksumChar === 'X' ? 10 : intval($checksumChar);
        $total = $sum + $checksumValue;
        return $total % 11 === 0;
    }

    private static function isbn10To13(string $isbn10): string
    {
        $core = substr($isbn10, 0, 9);
        $prefixed = "978{$core}";
        $digits = array_map('intval', str_split($prefixed));
        $sum = 0;
        foreach ($digits as $index => $digit) {
            $sum += $digit * ($index % 2 === 0 ? 1 : 3);
        }
        $check = (10 - ($sum % 10)) % 10;
        return "{$prefixed}{$check}";
    }
}
