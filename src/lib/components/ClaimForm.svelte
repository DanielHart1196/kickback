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
  export let venues: { id: string; name: string }[] = [];
  export let referrer = '';
  export let kickbackRatePercent = '5';
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
  let venueWrap: HTMLDivElement | null = null;
  let venueDirty = false;
  let referrerDirty = false;
  let last4Dirty = false;
  let venueOpen = false;
  let timeInput: HTMLInputElement | null = null;

  onMount(() => {
    if (amountField && amountField.value && !amountInput) {
      onAmountHydrate(amountField.value);
    }

    const handleClick = (event: MouseEvent) => {
      if (!venueWrap) return;
      const target = event.target as Node;
      if (!venueWrap.contains(target)) {
        venueOpen = false;
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });

  $: filteredVenues =
    venues.filter((venueOption) =>
      venueOption.name.toLowerCase().includes(venue.trim().toLowerCase())
    );

  function handleVenueFocus() {
    if (!isVenueLocked) {
      venueOpen = true;
    }
  }

  function handleVenueInput() {
    if (!isVenueLocked) {
      venueOpen = true;
    }
  }

  function handleVenueSelect(name: string) {
    venue = name;
    venueDirty = true;
    venueOpen = false;
  }

  function getLocalNowInputValue(): string {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }

  function handleTimeReset() {
    const now = getLocalNowInputValue();
    purchaseTime = now;
    maxPurchaseTime = now;
  }

  function openTimePicker() {
    if (!timeInput) return;
    if (typeof timeInput.showPicker === 'function') {
      timeInput.showPicker();
      return;
    }
    timeInput.focus();
    timeInput.click();
  }
</script>

<div class="w-full max-w-sm space-y-8" in:fly={{ y: 20 }}>
  {#if showBack}
    <button on:click={onBack} class="text-zinc-600 font-bold text-xs uppercase tracking-widest flex items-center gap-2 mb-4">
      <span aria-hidden="true">←</span>
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
      <h1 class="text-4xl font-black tracking-tighter italic uppercase">
        <span class="text-white">Kick</span><span class="text-orange-500">back</span>
      </h1>
      <p class="text-zinc-500 text-sm mt-2">Pilot Program - Claim Portal</p>
    </div>

    <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl">
      <div class="space-y-5">
        <div>
          <label for="venue" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Venue</label>
          <div class="relative" bind:this={venueWrap}>
            <input 
              id="venue"
              type="text" 
              bind:value={venue} 
              readonly={isVenueLocked}
              placeholder="Bar Name"
              autocomplete="off"
              spellcheck="false"
              on:blur={() => venueDirty = true}
              on:focus={handleVenueFocus}
              on:input={handleVenueInput}
              class="venue-input w-full appearance-none bg-zinc-800 border-none p-4 pr-12 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none {isVenueLocked ? 'opacity-50 cursor-not-allowed' : ''}"
            />
            {#if !isVenueLocked}
              <span class="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">
                <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            {/if}
            {#if !isVenueLocked && venueOpen}
              <div class="absolute z-20 mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-xl shadow-xl max-h-56 overflow-auto">
                {#if filteredVenues.length === 0}
                  <div class="px-4 py-3 text-xs font-bold uppercase tracking-widest text-zinc-500">No matches</div>
                {:else}
                  {#each filteredVenues as venueOption}
                    <button
                      type="button"
                      on:click={() => handleVenueSelect(venueOption.name)}
                      class="w-full text-left px-4 py-3 text-sm font-bold uppercase tracking-wide text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                    >
                      {venueOption.name}
                    </button>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
          {#if venueDirty && !venue.trim()}
            <p class="mt-2 text-[11px] font-bold uppercase tracking-widest text-orange-500/70">Select a venue</p>
          {/if}
        </div>

        <div>
          <label for="referrer" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Referrer ID</label>
          <input 
            id="referrer"
            type="text" 
            bind:value={referrer} 
            readonly={isReferrerLocked}
            placeholder="Who sent you?"
            on:blur={() => referrerDirty = true}
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none {isReferrerLocked ? 'opacity-50 cursor-not-allowed' : ''}"
          />
          {#if referrerDirty && !referrer.trim()}
            <p class="mt-2 text-[11px] font-bold uppercase tracking-widest text-orange-500/70">Referrer required</p>
          {/if}
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
          <div class="flex items-center justify-between mb-2">
            <label for="time" class="block text-xs font-bold uppercase tracking-widest text-zinc-500">Time of Purchase</label>
            <button
              type="button"
              on:click={handleTimeReset}
              class="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 hover:text-white transition-colors"
            >
              Reset
            </button>
          </div>
          <div class="relative">
            <input 
              id="time"
              type="datetime-local" 
              bind:value={purchaseTime} 
              bind:this={timeInput}
              max={maxPurchaseTime || undefined}
              class="time-input w-full appearance-none bg-zinc-800 border-none p-4 pr-12 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none [color-scheme:dark]"
            />
            <button
              type="button"
              aria-label="Open time picker"
              on:click={openTimePicker}
              class="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v4l3 2" />
              </svg>
            </button>
          </div>
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
            on:blur={() => last4Dirty = true}
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-xl font-medium focus:ring-2 focus:ring-white transition-all outline-none"
          />
          {#if last4Dirty && last4 && last4.length < 4}
            <p class="mt-2 text-[11px] font-bold uppercase tracking-widest text-orange-500/70">Enter 4 digits</p>
          {/if}
        </div>

        {#if amount && amount > 0}
          <div transition:slide={{ duration: 300 }} class="flex justify-between items-center px-2 mb-4 text-sm font-bold">
            <span class="text-zinc-500">REWARD ({kickbackRatePercent}%)</span>
            <span class="text-green-500">+ ${kickback}</span>
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

            <button on:click={onConfirmGuest} type="button" class="w-full py-3 text-zinc-500 font-bold text-sm uppercase tracking-[0.2em]">
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

<style>
  .venue-input::-webkit-calendar-picker-indicator,
  .venue-input::-webkit-list-button {
    display: none;
  }

  .time-input::-webkit-calendar-picker-indicator {
    opacity: 0;
    width: 0;
    height: 0;
    margin: 0;
    padding: 0;
  }

  .time-input::-webkit-inner-spin-button,
  .time-input::-webkit-clear-button {
    display: none;
  }

  .time-input {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: textfield;
  }
</style>

