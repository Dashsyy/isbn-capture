<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Order extends Model
{
    public const STATUS_NEW = 'new';
    public const STATUS_READING = 'reading';
    public const STATUS_READ = 'read';
    public const STATUS_DONATE = 'donate';

    protected $fillable = [
        'user_id',
        'scan_intent_id',
        'isbn',
        'status',
        'title',
        'authors',
        'metadata_source',
    ];

    protected $casts = [
        'authors' => 'array',
    ];

    public function scanIntent(): BelongsTo
    {
        return $this->belongsTo(ScanIntent::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
