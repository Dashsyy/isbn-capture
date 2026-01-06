<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class ScanIntent extends Model
{
    public const STATUS_PENDING = 'PENDING_LOOKUP';
    public const STATUS_FOUND = 'FOUND';
    public const STATUS_NOT_FOUND = 'NOT_FOUND';
    public const STATUS_INVALID = 'INVALID';
    public const STATUS_ERROR = 'ERROR';

    protected $fillable = [
        'user_id',
        'isbn',
        'raw_barcode',
        'format',
        'scan_source',
        'scanned_at',
        'status',
        'try_count',
        'last_tried_at',
        'notes',
        'title',
        'authors',
        'metadata_source',
        'manual_override',
    ];

    protected $casts = [
        'scanned_at' => 'datetime',
        'last_tried_at' => 'datetime',
        'authors' => 'array',
        'manual_override' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function order(): HasOne
    {
        return $this->hasOne(Order::class);
    }
}
