<x-app-layout>
    <x-slot name="header">
        <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold text-gray-800">
                Scan Detail
            </h2>
            <a href="/" class="text-sm text-slate-600 hover:text-slate-900">Back to scanner</a>
        </div>
    </x-slot>

    <div class="py-8">
        <div class="max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">
            @if (session('status'))
                <div class="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    {{ session('status') }}
                </div>
            @endif

            <div class="rounded-lg bg-white p-6 shadow-sm border border-slate-200">
                <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p class="text-sm text-slate-500">ISBN</p>
                        <p class="font-mono text-2xl">{{ $scanIntent->isbn }}</p>
                        <p class="text-sm text-slate-500 mt-1">Status: <span class="font-semibold">{{ $scanIntent->status }}</span></p>
                    </div>
                    <div class="text-sm text-slate-500">
                        <div>Scanned: {{ $scanIntent->scanned_at?->format('Y-m-d H:i') }}</div>
                        <div>Source: {{ $scanIntent->scan_source }}</div>
                        <div>Format: {{ $scanIntent->format }}</div>
                    </div>
                </div>

                <div class="mt-4 space-y-2 text-sm text-slate-700">
                    <div><span class="text-slate-500">Title:</span> {{ $scanIntent->title ?? 'Awaiting metadata' }}</div>
                    <div>
                        <span class="text-slate-500">Authors:</span>
                        {{ $scanIntent->authors ? implode(', ', $scanIntent->authors) : 'Unknown' }}
                    </div>
                    <div><span class="text-slate-500">Metadata source:</span> {{ $scanIntent->metadata_source ?? 'Pending' }}</div>
                    @if ($scanIntent->notes)
                        <div class="text-amber-600"><span class="text-slate-500">Notes:</span> {{ $scanIntent->notes }}</div>
                    @endif
                </div>
            </div>

            <div class="rounded-lg bg-white p-6 shadow-sm border border-slate-200">
                <h3 class="text-lg font-semibold text-slate-800">Wishlist Status</h3>
                @if ($scanIntent->order)
                    <form class="mt-4 space-y-3" method="POST" action="{{ route('scan-intents.order-status', $scanIntent) }}">
                        @csrf
                        @method('PATCH')
                        <div>
                            <label for="status" class="block text-sm text-slate-600">Status</label>
                            <select id="status" name="status" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2">
                                @foreach ($orderStatuses as $status)
                                    <option value="{{ $status }}" @selected($scanIntent->order->status === $status)>
                                        {{ ucfirst($status) }}
                                    </option>
                                @endforeach
                            </select>
                            @error('status')
                                <p class="text-sm text-rose-600 mt-1">{{ $message }}</p>
                            @enderror
                        </div>
                        <button type="submit" class="px-4 py-2 rounded-md bg-emerald-500 text-white font-semibold hover:bg-emerald-400">
                            Update status
                        </button>
                    </form>
                @else
                    <p class="text-sm text-slate-600 mt-2">Order is created only after a valid lookup.</p>
                @endif
            </div>
        </div>
    </div>
</x-app-layout>
