<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('scan_intents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('isbn', 20);
            $table->string('raw_barcode', 50);
            $table->string('format', 16)->default('UNKNOWN');
            $table->string('scan_source', 16)->default('camera');
            $table->timestamp('scanned_at')->useCurrent();
            $table->string('status', 32)->default('PENDING_LOOKUP');
            $table->unsignedInteger('try_count')->default(0);
            $table->timestamp('last_tried_at')->nullable();
            $table->text('notes')->nullable();
            $table->string('title')->nullable();
            $table->json('authors')->nullable();
            $table->string('metadata_source')->nullable();
            $table->boolean('manual_override')->default(false);
            $table->timestamps();

            $table->index(['user_id', 'isbn', 'scanned_at']);
            $table->index('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('scan_intents');
    }
};
