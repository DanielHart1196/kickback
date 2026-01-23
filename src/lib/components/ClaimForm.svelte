<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import type { Session } from '@supabase/supabase-js';

  export let session: Session | null = null;
  export let showBack = false;
  export let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  export let errorMessage = '';
  export let successMessage = '';
  export let amount: number | null = null;
  export let canSubmit = false;
  export let amountInput = '';
  export let maxBill = 0;
  export let kickback = '0.00';
  export let purchaseTime = '';
  export let maxPurchaseTime = '';
  export let last4 = '';
  export let venue = '';
  export let referrer = '';
  export let isVenueLocked = false;
  export let isReferrerLocked = false;
  export let loginUrl = '/login';
  export let onBack: () => void = () => {};
  export let onLogout: () => void = () => {};
  export let onSubmit: () => void = () => {};
  export let onConfirmGuest: () => void = () => {};
  export let onAmountInput: (e: Event & { currentTarget: HTMLInputElement }) => void = () => {};
  export let onAmountHydrate: (value: string) => void = () => {};

  let amountField: HTMLInputElement | null = null;

  onMount(() => {
    if (amountField && amountField.value && !amountInput) {
      onAmountHydrate(amountField.value);
    }
  });
</script>

<div class="w-full max-w-sm space-y-8" in:fly={{ y: 20 }}>
  {#if showBack}
    <button on:click={onBack} class="text-zinc-600 font-bold text-xs uppercase tracking-widest flex items-center gap-2 mb-4">
      Back to Balance
    </button>
  {/if}

  <div class="fixed top-10 left-0 right-0 px-6 z-[100] pointer-events-none">
    {#if status === 'success'}
      <div 
        in:fly={{ y: -20, duration: 400 }} 
        out:fade={{ duration: 300 }}
        class="bg-orange-500 border border-orange-400 text-white p-4 rounded-2xl text-center text-sm font-black shadow-2xl shadow-orange-500/40 pointer-events-auto"
      >
        {successMessage || 'CLAIM SUBMITTED SUCCESSFULLY'}
      </div>
    {:else if status === 'error'}
      <div 
        in:fly={{ y: -20, duration: 400 }} 
        out:fade={{ duration: 300 }}
        class="bg-red-500 border border-red-400 text-white p-4 rounded-2xl text-center text-sm font-black shadow-2xl shadow-red-500/40 pointer-events-auto"
      >
        WARNING: {errorMessage.toUpperCase()}
      </div>
    {/if}
  </div>

  <div class="w-full max-w-sm space-y-8">
    <div class="text-center">
      <h1 class="text-4xl font-black tracking-tighter italic uppercase">Kickback</h1>
      <p class="text-zinc-500 text-sm mt-2">Pilot Program - Claim Portal</p>
    </div>

    <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl">
      <div class="space-y-5">
        <div>
          <label for="venue" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Venue</label>
          <input 
            id="venue"
            type="text" 
            bind:value={venue} 
            readonly={isVenueLocked}
            placeholder="Bar Name"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none {isVenueLocked ? 'opacity-50 cursor-not-allowed' : ''}"
          />
        </div>

        <div>
          <label for="referrer" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Referrer ID</label>
          <input 
            id="referrer"
            type="text" 
            bind:value={referrer} 
            readonly={isReferrerLocked}
            placeholder="Who sent you?"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none {isReferrerLocked ? 'opacity-50 cursor-not-allowed' : ''}"
          />
        </div>

        <div>
          <label for="amount" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Amount</label>
          <div class="relative">
          <span class="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 font-bold">$</span>
          <input 
            id="amount"
            type="number" 
            step="0.01"
            bind:value={amountInput}
            bind:this={amountField}
            on:input={onAmountInput}
            placeholder="0.00"
            inputmode="decimal"
            class="w-full bg-zinc-800 border-none p-4 pl-8 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none"
          />
          </div>
        </div>

        {#if (amount ?? 0) >= maxBill}
          <p transition:fade class="text-orange-500 text-[10px] font-bold mt-2 px-2">
            WARNING: MAXIMUM BILL AMOUNT REACHED (${maxBill})
          </p>
        {/if}

        <div>
          <label for="time" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Time of Purchase</label>
          <input 
            id="time"
            type="datetime-local" 
            bind:value={purchaseTime} 
            max={maxPurchaseTime || undefined}
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none [color-scheme:dark]"
          />
        </div>

        <div>
          <label for="last4" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Card Digits (Last 4)</label>
          <input 
            id="last4"
            type="text" 
            inputmode="numeric"
            pattern="[0-9]*"
            bind:value={last4} 
            placeholder="1234"
            maxlength="4"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-xl font-medium focus:ring-2 focus:ring-white transition-all outline-none"
          />
        </div>

        {#if amount && amount > 0}
          <div transition:slide={{ duration: 300 }} class="flex justify-between items-center px-2 mb-4 text-sm font-bold">
            <span class="text-zinc-500">REWARD (5%)</span>
            <span class="text-orange-500">+ ${kickback}</span>
          </div>
        {/if}

        <div class="space-y-4">
          {#if session}
            <button 
              on:click={onSubmit}
              disabled={status === 'loading' || !canSubmit}
              class="w-full bg-orange-500 text-black font-black py-4 rounded-2xl text-lg active:scale-95 transition-all disabled:opacity-50"
              class:opacity-50={!canSubmit || status === 'loading'}
              class:cursor-not-allowed={!canSubmit || status === 'loading'}
            >
              {status === 'loading' ? 'PROCESSING...' : `SUBMIT & CLAIM $${kickback}`}
            </button>
          {:else}
            <button 
              on:click={() => window.location.href = loginUrl}
              disabled={status === 'loading' || !canSubmit}
              class="w-full bg-white text-black font-black py-4 rounded-2xl text-lg active:scale-95 transition-all shadow-xl shadow-white/5"
              class:opacity-50={!canSubmit || status === 'loading'}
              class:cursor-not-allowed={!canSubmit || status === 'loading'}
            >
              SIGN UP & CLAIM ${kickback}
            </button>

            <button on:click={onConfirmGuest} type="button" class="w-full py-2 text-zinc-500 font-bold text-xs uppercase tracking-[0.2em]">
              Submit as Guest
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  {#if session}
    <div class="mt-12 text-center">
      <button 
        on:click={onLogout}
        class="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] hover:text-white transition-colors"
      >
        LOGOUT: {session.user.email}
      </button>
    </div>
  {/if}
</div>

