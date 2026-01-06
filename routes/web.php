<?php

use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ScanIntentController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
})->middleware('auth');

Route::get('/dashboard', function () {
    return view('dashboard');
})->middleware(['auth', 'verified'])->name('dashboard');

Route::middleware('auth')->group(function () {
    Route::get('/scan-intents', [ScanIntentController::class, 'index']);
    Route::post('/scan-intents', [ScanIntentController::class, 'store']);
    Route::post('/scan-intents/{scan_intent}/retry', [ScanIntentController::class, 'retry']);
    Route::post('/scan-intents/{scan_intent}/manual-title', [ScanIntentController::class, 'manualTitle']);
    Route::get('/scan-intents/{scan_intent}', [ScanIntentController::class, 'show'])->name('scan-intents.show');
    Route::patch('/scan-intents/{scan_intent}/order-status', [ScanIntentController::class, 'updateOrderStatus'])
        ->name('scan-intents.order-status');

    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');
});

require __DIR__.'/auth.php';
