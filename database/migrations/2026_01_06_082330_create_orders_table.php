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
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('scan_intent_id')->constrained('scan_intents')->cascadeOnDelete();
            $table->string('isbn', 20);
            $table->string('status', 32)->default('new');
            $table->string('title')->nullable();
            $table->json('authors')->nullable();
            $table->string('metadata_source')->nullable();
            $table->timestamps();

            $table->unique('scan_intent_id');
            $table->index(['user_id', 'status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
