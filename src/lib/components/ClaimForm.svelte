<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { fade, fly, slide } from 'svelte/transition';
  import type { Session } from '@supabase/supabase-js';
  import type { Venue } from '$lib/venues/types';
  import { isReferralCodeValid, normalizeReferralCode } from '$lib/referrals/code';
  import type { ClaimDraft } from '$lib/claims/types';
  import { saveDraftToStorage } from '$lib/claims/draft';

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
  export let venues: Venue[] = [];
  export let referrer = '';
  export let referrerLookupStatus: 'idle' | 'checking' | 'valid' | 'invalid' = 'idle';
  export let isSelfReferral = false;
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
  let isFirefox = false;
  let showLast4Info = false;
  let last4InfoButton: HTMLButtonElement | null = null;
  let last4TooltipEl: HTMLDivElement | null = null;
  let last4TooltipStyle = '';
  let logoLoaded = false;
  let keyboardPad = false;
  let referrerEditing = false;
  let referrerBannerInput: HTMLInputElement | null = null;

  onMount(() => {
    isFirefox =
      typeof navigator !== 'undefined' &&
      /firefox/i.test(navigator.userAgent) &&
      !/seamonkey/i.test(navigator.userAgent);

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

    const handleTooltipOutsideClick = (event: MouseEvent) => {
      if (!showLast4Info) return;
      const target = event.target as Node;
      if (last4InfoButton?.contains(target)) return;
      if (last4TooltipEl?.contains(target)) return;
      showLast4Info = false;
    };

    const handleTooltipReposition = () => {
      if (showLast4Info) updateLast4TooltipPosition();
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('click', handleTooltipOutsideClick);
    window.addEventListener('resize', handleTooltipReposition);
    window.addEventListener('scroll', handleTooltipReposition, true);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('click', handleTooltipOutsideClick);
      window.removeEventListener('resize', handleTooltipReposition);
      window.removeEventListener('scroll', handleTooltipReposition, true);
    };
  });

  function updateLast4TooltipPosition() {
    if (!last4InfoButton || typeof window === 'undefined') return;
    const rect = last4InfoButton.getBoundingClientRect();
    const top = rect.bottom + 8;
    last4TooltipStyle = `top: ${Math.round(top)}px; left: 50%; transform: translateX(-50%);`;
  }

  function toggleLast4Info() {
    showLast4Info = !showLast4Info;
    if (showLast4Info) {
      updateLast4TooltipPosition();
    }
  }

  $: filteredVenues =
    venues.filter((venueOption) =>
      venueOption.name.toLowerCase().includes((venue || '').trim().toLowerCase())
    );
  $: safeReferrer = typeof referrer === 'string' ? referrer : '';
  $: referrerValid = safeReferrer.trim().length > 0 && isReferralCodeValid(safeReferrer);
  $: if (selectedVenue?.logo_url) {
    logoLoaded = false;
  }

  function handleReferrerInput(event: Event & { currentTarget: HTMLInputElement }) {
    const raw = event.currentTarget.value;
    const alphanumeric = raw.replace(/[^a-z0-9]/gi, '');
    const normalized = normalizeReferralCode(alphanumeric).slice(0, 8);
    event.currentTarget.value = normalized;
    referrer = normalized;
    referrerDirty = true;
  }
  function clearReferrer() {
    isReferrerLocked = false;
    referrer = '';
    referrerDirty = false;
  }
  $: selectedVenue =
    venue.trim().length > 0
      ? venues.find((venueOption) => venueOption.name.trim().toLowerCase() === venue.trim().toLowerCase())
      : undefined;

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

  function clearVenueSelection() {
    isVenueLocked = false;
    venue = '';
    venueDirty = false;
    venueOpen = true;
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

<div
  class="w-full max-w-sm space-y-8"
  style={keyboardPad ? 'padding-bottom: 40vh;' : ''}
  in:fly={{ y: 20 }}
>
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
      <h1 class="kickback-wordmark text-4xl font-black uppercase">
        <span class="text-white">Kick</span><span class="text-orange-500">back</span>
      </h1>
      <p class="text-zinc-500 text-sm mt-2">
        {selectedVenue?.square_public
          ? `${selectedVenue?.name ?? 'This venue'} supports auto claims after the initial handshake`
          : 'Claim Portal'}
      </p>
    </div>

    {#if selectedVenue?.logo_url}
      <div class="flex items-center justify-center relative">
        <img
          src={selectedVenue.logo_url}
          alt={selectedVenue.name}
          on:load={() => (logoLoaded = true)}
          class="h-48 w-auto max-w-full object-contain rounded-2xl border-2 transition-opacity duration-200 {logoLoaded ? 'border-orange-500/80 opacity-100' : 'border-transparent opacity-0'}"
          loading="lazy"
        />
        <button
          type="button"
          on:click={clearVenueSelection}
          class="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-black flex items-center justify-center hover:text-white transition-colors"
          aria-label="Change venue"
        >
          X
        </button>
      </div>
    {/if}

    {#if !selectedVenue?.logo_url}
      <div>
        <label for="venue" class="block text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-4 px-1 text-center">Which venue?</label>
        <div class="relative" bind:this={venueWrap}>
          <input 
            id="venue"
            type="text" 
            bind:value={venue} 
            readonly={isVenueLocked}
            placeholder="Bar Name"
            autocomplete="off"
            spellcheck="false"
            on:blur={() => (venueDirty = true)}
            on:focus={handleVenueFocus}
            on:input={handleVenueInput}
            class="w-full bg-black border border-zinc-800 text-white p-4 rounded-2xl text-xl font-black uppercase tracking-widest outline-none ring-2 ring-orange-500 transition-all text-center {isVenueLocked ? 'opacity-50 cursor-not-allowed' : ''}"
          />
          {#if !isVenueLocked && venue.trim().length > 0}
            <button
              type="button"
              on:click={() => {
                venue = '';
                venueDirty = true;
                venueOpen = true;
              }}
              class="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
              aria-label="Clear venue"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6l12 12" />
                <path d="M18 6l-12 12" />
              </svg>
            </button>
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
    {/if}

    <div class="relative flex items-center justify-center gap-2 text-lg font-black uppercase tracking-[0.6em] text-white">
      <span>CODE:</span>
      <span class="inline-block w-[14ch] text-center whitespace-nowrap">
        {#if !isReferrerLocked && referrerEditing}
          <input
            id="ref-banner"
            bind:this={referrerBannerInput}
            type="text"
            bind:value={referrer}
            autocapitalize="characters"
            spellcheck="false"
            on:input={handleReferrerInput}
            on:blur={() => (referrerDirty = true, referrerEditing = false)}
            maxlength="8"
            class="inline-block w-full bg-transparent border-b border-orange-500 text-orange-500 font-black uppercase outline-none px-0 text-lg tracking-[0.6em]"
          />
        {:else}
          <button
            type="button"
            on:click={() => {
              if (isReferrerLocked) {
                clearReferrer();
              }
              referrerEditing = true;
              setTimeout(() => referrerBannerInput?.focus(), 0);
            }}
            class="inline-block w-full min-h-[1.75rem] cursor-text text-orange-500 font-black text-lg tracking-[0.6em]"
            class:border-b={!referrer || !referrer.trim().length}
            class:border-orange-500={!referrer || !referrer.trim().length}
            aria-label="Edit referral code"
          >
            {referrer}
          </button>
        {/if}
      </span>
    </div>

    {#if referrerDirty && !referrer.trim()}
      <p class="mt-2 text-[11px] font-bold uppercase tracking-widest text-orange-500/70 text-center">Referrer required</p>
    {:else if referrerDirty && !referrerValid}
      <p class="mt-2 text-[11px] font-bold uppercase tracking-widest text-orange-500/70 text-center">Use 4-8 letters or numbers</p>
    {:else if referrerDirty && referrerValid && isSelfReferral}
      <p class="mt-2 text-[11px] font-bold uppercase tracking-widest text-orange-500/70 text-center">You cannot use your own code</p>
    {:else if referrerEditing && referrerDirty && referrerValid && !isSelfReferral && referrerLookupStatus === 'valid'}
      <p class="mt-2 text-[11px] font-bold uppercase tracking-widest text-green-500 text-center">{normalizeReferralCode(referrer)} will receive {kickbackRatePercent}%</p>
    {:else if referrerDirty && referrerValid && referrerLookupStatus === 'checking'}
      <p class="mt-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500 text-center">Checking code…</p>
    {:else if referrerDirty && referrerValid && referrerLookupStatus === 'invalid'}
      <p class="mt-2 text-[11px] font-bold uppercase tracking-widest text-orange-500/70 text-center">Unrecognized referral code</p>
    {/if}

    <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl">
      <div class="space-y-5">
        

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
            on:focus={() => (keyboardPad = true)}
            on:blur={() => (keyboardPad = false)}
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
              class="time-input w-full appearance-none bg-zinc-800 border-none p-4 {isFirefox ? 'pr-4 text-base' : 'pr-12 text-lg'} rounded-2xl focus:ring-2 focus:ring-white outline-none [color-scheme:dark]"
              class:time-input-native={isFirefox}
            />
            {#if !isFirefox}
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
            {/if}
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label for="last4" class="block text-xs font-bold uppercase tracking-widest text-zinc-500">Card Digits (Last 4)</label>
            <div class="flex items-center">
              <button
                type="button"
                bind:this={last4InfoButton}
                on:click={toggleLast4Info}
                aria-expanded={showLast4Info}
                aria-controls="last4-help"
                class="text-zinc-400 hover:text-white transition-colors flex items-center justify-center w-4 h-4"
              >
                <span class="sr-only">Why we need this</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              </button>
            </div>
          </div>
          {#if showLast4Info}
            <div
              id="last4-help"
              bind:this={last4TooltipEl}
              class="fixed w-72 rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300 shadow-xl shadow-black/30 z-[300] opacity-100"
              style={last4TooltipStyle}
            >
              <p class="font-semibold">Why we need this</p>
              <p class="mt-1 text-zinc-400">We use the last 4 digits to match your purchase with the venue. We never see the full card number and never charge your card.</p>
              <p class="mt-2 text-zinc-500">Apple Pay and Google Pay can show a different card number than the one on your physical card. Please enter the last 4 shown in your wallet app.</p>
            </div>
          {/if}
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
          <div transition:slide={{ duration: 300 }} class="flex justify-between items-center px-2 mb-4 text-sm font-bold uppercase">
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
              on:click={async () => {
                const draft: ClaimDraft = {
                  amount: amountInput || '',
                  venue: (selectedVenue?.name ?? venue) || '',
                  venueId: selectedVenue?.id ?? '',
                  venueCode: selectedVenue?.short_code ?? undefined,
                  ref: typeof referrer === 'string' ? referrer : '',
                  last4: typeof last4 === 'string' ? last4 : ''
                };
                try {
                  saveDraftToStorage(localStorage, draft);
                } catch {}
                await goto(loginUrl);
              }}
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
  .venue-input::-webkit-calendar-picker-indicator {
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

  .time-input-native {
    appearance: auto;
    -webkit-appearance: auto;
    -moz-appearance: auto;
  }
</style>
