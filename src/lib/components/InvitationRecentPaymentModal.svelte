<script lang="ts">
  import { fade, fly } from 'svelte/transition';

  type RecentPaymentCandidate = {
    paymentId: string;
    amount: number;
    createdAt: string;
    venueId: string;
    venueName: string;
    referrerCode: string;
  };

  export let venueName = '';
  export let referrerCode = '';
  export let candidates: RecentPaymentCandidate[] = [];
  export let selectedPaymentId = '';
  export let enteredLast4 = '';
  export let confirming = false;
  export let success = false;
  export let errorMessage = '';
  export let onSelectPayment: (paymentId: string) => void = () => {};
  export let onLast4Input: (value: string) => void = () => {};
  export let onConfirm: () => void = () => {};
  export let onDismiss: () => void = () => {};

  function formatTransactionTime(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Unknown time';
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function handleLast4Input(event: Event) {
    const target = event.currentTarget as HTMLInputElement | null;
    const normalized = String(target?.value ?? '').replace(/\D/g, '').slice(0, 4);
    onLast4Input(normalized);
  }
</script>

<div class="fixed inset-0 z-[210] flex items-center justify-center p-6" transition:fade>
  <button
    type="button"
    class="absolute inset-0 bg-black/80 backdrop-blur-md"
    aria-label="Close recent payment confirmation"
    on:click={onDismiss}
    disabled={confirming}
  ></button>

  <div
    in:fly={{ y: 20, duration: 350 }}
    class="relative max-h-[calc(100vh-3rem)] w-full max-w-md overflow-y-auto rounded-[2rem] border border-zinc-800 bg-zinc-950 p-7 text-center shadow-2xl"
  >
    {#if success}
      <div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 text-green-400">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          class="h-8 w-8"
          fill="none"
          stroke="currentColor"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 class="text-2xl font-black uppercase tracking-tight text-white">Card linked</h2>
      <p class="mt-4 text-sm leading-relaxed text-zinc-300">
        Purchases with this card will be automatically tracked for the next 30 days.
      </p>
      <button
        type="button"
        on:click={onDismiss}
        class="mt-6 w-full rounded-2xl bg-orange-500 py-4 font-black uppercase tracking-tight text-black"
      >
        Done
      </button>
    {:else}
      <h2 class="text-2xl font-black uppercase tracking-tight text-white">
        Accepted <span class="text-orange-500">{venueName || 'venue'}</span> invitation from
        <span class="text-orange-500">{referrerCode || 'your mate'}</span>
      </h2>
      <p class="mt-3 text-sm leading-relaxed text-zinc-400">
        Pick a purchase from the last 10 minutes, then enter the card&apos;s last 4 digits to
        confirm it was you
      </p>

      <div class="mt-6 max-h-72 space-y-3 overflow-y-auto pr-1 text-left">
        {#each candidates as candidate (candidate.paymentId)}
          <button
            type="button"
            class={`w-full rounded-[1.5rem] border p-4 transition-colors ${
              selectedPaymentId === candidate.paymentId
                ? 'border-orange-500 bg-orange-500/10'
                : 'border-zinc-800 bg-black hover:border-zinc-700'
            }`}
            class:px-5={true}
            class:py-4={true}
            on:click={() => onSelectPayment(candidate.paymentId)}
            disabled={confirming}
            aria-pressed={selectedPaymentId === candidate.paymentId}
          >
            <div class="flex items-center justify-between gap-4">
              <div class="flex flex-col items-start text-left">
                <p class="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Amount</p>
                <p class="mt-2 text-2xl font-black tracking-tight text-white">
                  ${candidate.amount.toFixed(2)}
                </p>
              </div>
              <div class="flex flex-col items-end text-right">
                <p class="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                  Time
                </p>
                <p class="mt-2 text-base font-black uppercase tracking-[0.16em] text-white">
                  {formatTransactionTime(candidate.createdAt)}
                </p>
              </div>
            </div>
          </button>
        {/each}
      </div>

      <div class="mt-5 text-left">
        <label for="recent-payment-last4" class="block text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
          Last 4 digits
        </label>
        <input
          id="recent-payment-last4"
          type="text"
          inputmode="numeric"
          autocomplete="cc-number"
          pattern="[0-9]*"
          maxlength="4"
          value={enteredLast4}
          on:input={handleLast4Input}
          disabled={confirming}
          class="mt-2 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-lg font-black tracking-[0.35em] text-white placeholder-zinc-600 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
          placeholder="1234"
        />
      </div>

      {#if errorMessage}
        <p class="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-red-400">{errorMessage}</p>
      {/if}

      <button
        type="button"
        on:click={onConfirm}
        disabled={confirming || !selectedPaymentId}
        class="mt-6 w-full rounded-2xl bg-orange-500 py-4 font-black uppercase tracking-tight text-black disabled:opacity-60"
      >
        {#if confirming}Linking...{:else}Confirm{/if}
      </button>

      <button
        type="button"
        on:click={onDismiss}
        disabled={confirming}
        class="mt-3 w-full rounded-2xl border border-zinc-800 py-4 font-black uppercase tracking-tight text-zinc-300"
      >
        Not now
      </button>
    {/if}
  </div>
</div>
