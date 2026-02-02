<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import QRCode from 'qrcode';
  import { isReferralCodeValid, normalizeReferralCode } from '$lib/referrals/code';

  export let userRefCode = 'member';
  export let referralEditLocked = false;
  export let referralOriginalCode: string | null = null;
  export let venues: { id: string; name: string; short_code?: string | null; logo_url?: string | null }[] = [];
  export let initialVenueId: string | null = null;
  export let initialVenueName: string | null = null;
  export let onClose: () => void = () => {};
  export let onUpdateReferralCode: (code: string) => Promise<{ ok: boolean; message?: string; code?: string }> =
    async () => ({ ok: false, message: 'Code update unavailable.' });

  let referralVenueId = '';
  let referralVenueName = '';
  let referralVenueCode = '';
  let qrDataUrl = '';
  let touchStart = 0;
  let currentYOffset = 0;
  let referralInput = '';
  let referralDirty = false;
  let referralSaving = false;
  let referralError = '';
  let referralMessage = '';
  let referralEditing = false;
  let showCodeChangeInfo = false;
  let hasAppliedDefault = false;
  let referralInputEl: HTMLInputElement | null = null;
  let referralInputFocused = false;
  let shareButtonEl: HTMLButtonElement | null = null;
  let venueSearch = '';
  let venueOpen = false;
  let venueDirty = false;
  let venueWrap: HTMLDivElement | null = null;
  let venueInputFocused = false;
  let venueClearKeepsOpen = false;
  let initialVenueApplied = false;
  let codeChangeInfoButton: HTMLButtonElement | null = null;
  let codeChangeInfoTooltip: HTMLDivElement | null = null;
  let referralEditButton: HTMLButtonElement | null = null;

  const lastSelectedVenueKey = 'kickback:last-selected-venue-id';
  $: referralVenueName = venues.find((venue) => venue.id === referralVenueId)?.name ?? '';
  $: referralVenueCode = venues.find((venue) => venue.id === referralVenueId)?.short_code ?? '';
  $: referralLink = buildReferralLink(userRefCode, referralVenueCode, referralVenueName);
  $: if (!referralDirty) referralInput = userRefCode;
  $: if (!venueDirty) venueSearch = referralVenueName;
  $: filteredVenues = venues.filter((venue) =>
    venue.name.toLowerCase().includes(venueSearch.trim().toLowerCase())
  );

  $: if (referralLink) {
    QRCode.toDataURL(referralLink, { margin: 2, scale: 8, color: { dark: '#000000', light: '#ffffff' } })
      .then((url: string) => {
        qrDataUrl = url;
      })
      .catch((err: Error) => {
        console.error(err);
      });
  }

  function buildReferralLink(code: string, venueCode: string, venueName: string): string {
    const params = new URLSearchParams();
    if (venueCode) {
      params.set('venue', venueCode);
    } else if (venueName) {
      params.set('venue', venueName);
    }
    params.set('ref', code);
    return `https://kkbk.app/?${params.toString()}`;
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(referralLink);
    if (navigator.vibrate) navigator.vibrate(50);
  }

  async function shareLink() {
    const shareData = {
      title: 'Kickback Pilot',
      text: `Join me at ${referralVenueName || 'Kickback'} and get 5% back on your bill!`,
      url: referralLink
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(referralLink);
      }
    } catch (err) {
      console.error('Share failed:', err);
    }
  }

  async function saveReferralCode() {
    referralError = '';
    referralMessage = '';
    const normalized = normalizeReferralCode(referralInput);
    if (normalized === userRefCode) {
      referralDirty = false;
      referralEditing = false;
      referralInput = userRefCode;
      return;
    }
    if (!isReferralCodeValid(normalized)) {
      referralError = 'Use 4-8 letters or numbers.';
      return;
    }
    referralSaving = true;
    try {
      const result = await onUpdateReferralCode(normalized);
      if (result.ok) {
        referralDirty = false;
        referralEditing = false;
        referralInput = result.code ?? normalized;
      } else {
        referralError = result.message ?? 'Failed to update code.';
      }
    } finally {
      referralSaving = false;
    }
  }

  async function startReferralEdit() {
    if (referralEditLocked) return;
    referralError = '';
    referralMessage = '';
    referralEditing = true;
    referralInput = userRefCode;
    referralDirty = false;
    await tick();
    try {
      referralInputEl?.focus({ preventScroll: true });
    } catch {
      referralInputEl?.focus();
    }
    setTimeout(() => {
      scrollReferralInputIntoView();
    }, 120);
  }

  function cancelReferralEdit() {
    referralEditing = false;
    referralDirty = false;
    referralError = '';
    referralMessage = '';
    referralInput = userRefCode;
  }

  function handleVenueFocus() {
    venueOpen = true;
  }

  function handleVenueInput() {
    venueOpen = true;
    venueDirty = true;
  }

  function selectVenue(venueId: string, name: string) {
    referralVenueId = venueId;
    venueSearch = name;
    venueDirty = true;
    venueOpen = false;
  }

  function clearVenueSelection(keepOpen?: boolean) {
    referralVenueId = '';
    venueSearch = '';
    venueDirty = true;
    const shouldKeepOpen = keepOpen ?? venueInputFocused;
    venueOpen = shouldKeepOpen;
    if (shouldKeepOpen && typeof document !== 'undefined') {
      const input = document.getElementById('ref-venue') as HTMLInputElement | null;
      input?.focus();
      setTimeout(() => {
        venueOpen = true;
      }, 0);
    }
  }

  function scrollReferralInputIntoView() {
    if (!referralInputEl) return;
    referralInputEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  function handleTouchStart(e: TouchEvent) {
    touchStart = e.targetTouches[0].clientY;
  }

  function handleTouchMove(e: TouchEvent) {
    const currentTouchY = e.targetTouches[0].clientY;
    const dragDistance = currentTouchY - touchStart;

    if (dragDistance > 0) {
      currentYOffset = dragDistance;
    }
  }

  function handleTouchEnd() {
    if (currentYOffset > 120) {
      onClose();
    }
    currentYOffset = 0;
  }

  function resolveInitialVenue(): { id: string; name: string } | null {
    if (initialVenueId) {
      const match = venues.find((venue) => venue.id === initialVenueId);
      if (match) return { id: match.id, name: match.name };
    }
    const rawName = initialVenueName?.trim() ?? '';
    if (!rawName) return null;
    const codeMatch = venues.find(
      (venue) => (venue.short_code ?? '').toUpperCase() === rawName.toUpperCase()
    );
    if (codeMatch) return { id: codeMatch.id, name: codeMatch.name };
    const nameMatch = venues.find(
      (venue) => venue.name.trim().toLowerCase() === rawName.toLowerCase()
    );
    if (nameMatch) return { id: nameMatch.id, name: nameMatch.name };
    return { id: '', name: rawName };
  }

  onMount(() => {
    if (typeof document === 'undefined') return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const viewport = window.visualViewport;
    const handleClick = (event: MouseEvent) => {
      if (!venueWrap) return;
      const target = event.target as Node;
      if (!venueWrap.contains(target)) {
        venueOpen = false;
      }
    };
    const handleCodeInfoClick = (event: MouseEvent) => {
      if (!showCodeChangeInfo) return;
      const target = event.target as Node;
      if (codeChangeInfoButton?.contains(target)) return;
      if (referralEditButton?.contains(target)) return;
      if (codeChangeInfoTooltip?.contains(target)) return;
      showCodeChangeInfo = false;
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('click', handleCodeInfoClick);
    return () => {
      document.body.style.overflow = original || 'auto';
      void viewport;
      document.removeEventListener('click', handleClick);
      document.removeEventListener('click', handleCodeInfoClick);
    };
  });

  $: if (!initialVenueApplied && venues.length > 0 && (initialVenueId || initialVenueName)) {
    const resolved = resolveInitialVenue();
    if (resolved) {
      referralVenueId = resolved.id;
      venueSearch = resolved.name;
      venueDirty = true;
      venueOpen = false;
      hasAppliedDefault = true;
    }
    initialVenueApplied = true;
  }

  $: if (!hasAppliedDefault && !referralVenueId && venues.length > 0) {
    const storedId =
      typeof localStorage !== 'undefined' ? localStorage.getItem(lastSelectedVenueKey) : null;
    if (storedId === '') {
      referralVenueId = '';
    } else if (storedId && venues.some((venue) => venue.id === storedId)) {
      referralVenueId = storedId;
    }
    hasAppliedDefault = true;
  }

  $: if (typeof localStorage !== 'undefined') {
    localStorage.setItem(lastSelectedVenueKey, referralVenueId);
  }

</script>

<div class="fixed inset-0 bg-black/90 backdrop-blur-md z-[300] flex items-end justify-center" transition:fade>
  <button on:click={onClose} class="absolute inset-0 w-full h-full cursor-default" aria-label="Close"></button>

  <div 
    class="bg-zinc-900 w-full max-w-md rounded-t-[2.5rem] relative pb-12 transition-transform overflow-hidden overscroll-contain"
    style={`transform: translateY(${Math.max(0, currentYOffset)}px); transition: ${currentYOffset === 0 ? 'transform 0.3s ease-out' : 'none'}; max-height: calc(100vh - 64px); margin-top: 4px; padding-top: 4px; padding-bottom: ${referralInputFocused ? '55vh' : '32px'};`}
    in:fly={{ y: 600, duration: 500, opacity: 1 }} 
    out:fly={{ y: 600, duration: 400, opacity: 1 }}
    on:touchstart={handleTouchStart}
    on:touchmove={handleTouchMove}
    on:touchend={handleTouchEnd}
  >
    <div class="pt-6 pb-4 flex justify-center w-full">
      <div class="w-12 h-1.5 bg-zinc-800 rounded-full opacity-50"></div>
    </div>

    <div class="px-8">
      <header class="text-center mb-6">
        <h2 class="text-2xl font-black uppercase tracking-tighter text-white">
          Share the <span class="kickback-wordmark"><span class="text-white">Kick</span><span class="text-orange-500">back</span></span>
        </h2>
      </header>

      <div class="mb-4">
        <label for="ref-venue" class="block text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-4 px-1 text-center">Which venue?</label>
        <div class="relative" bind:this={venueWrap}>
          <input
            id="ref-venue"
            type="text"
            bind:value={venueSearch}
            placeholder="General invite"
            autocomplete="off"
            spellcheck="false"
            on:focus={handleVenueFocus}
            on:focus={() => (venueInputFocused = true)}
            on:blur={() => (venueInputFocused = false)}
            on:input={handleVenueInput}
            class="w-full bg-black border border-zinc-800 text-white p-4 rounded-2xl text-xl font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-orange-500 transition-all text-center"
          />
          {#if venueSearch.trim().length > 0}
            <button
              type="button"
              on:mousedown|preventDefault={() => {
                venueClearKeepsOpen =
                  venueInputFocused ||
                  (typeof document !== 'undefined' && document.activeElement?.id === 'ref-venue');
              }}
              on:click={() => {
                clearVenueSelection(venueClearKeepsOpen);
                if (venueClearKeepsOpen) {
                  venueOpen = true;
                  venueInputFocused = true;
                }
              }}
              class="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
              aria-label="Clear venue search"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6l12 12" />
                <path d="M18 6l-12 12" />
              </svg>
            </button>
          {/if}
          {#if venueOpen}
            <div class="absolute z-20 mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-xl shadow-xl max-h-56 overflow-auto">
              <button
                type="button"
                on:click={() => clearVenueSelection(false)}
                class="w-full text-left px-4 py-3 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:bg-zinc-800/60 transition-colors"
              >
                General Invite
              </button>
              {#if filteredVenues.length === 0}
                <div class="px-4 py-3 text-xs font-bold uppercase tracking-widest text-zinc-500">No matches</div>
              {:else}
                {#each filteredVenues as venue}
                  <button
                    type="button"
                    on:click={() => selectVenue(venue.id, venue.name)}
                    class="w-full text-left px-4 py-3 text-sm font-bold uppercase tracking-wide text-zinc-200 hover:bg-zinc-800/60 transition-colors"
                  >
                    {venue.name}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
</div>  
</div>


      <div class="bg-white p-4 rounded-[2.5rem] w-48 h-48 mx-auto mb-4 flex items-center justify-center shadow-xl shadow-white/5">
        {#if qrDataUrl}
          <img src={qrDataUrl} alt="Referral QR Code" class="w-full h-full" />
        {/if}
      </div>

      <div class="space-y-4">
        <div>
          <div class="relative flex items-center justify-center gap-2 mb-4 w-full">
            <p class="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-1 text-center">Your Code</p>
            <button
              type="button"
              on:click={() => (showCodeChangeInfo = !showCodeChangeInfo)}
              class="text-zinc-500 hover:text-white transition-colors"
              aria-label="Referral code change info"
              aria-expanded={showCodeChangeInfo}
              bind:this={codeChangeInfoButton}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </button>
            {#if showCodeChangeInfo}
              <div
                bind:this={codeChangeInfoTooltip}
                class="absolute bottom-full mb-2 w-64 rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400 shadow-xl shadow-black/30 z-30 flex gap-2"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 text-red-400 shrink-0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3.2l9 15.6c.4.7-.1 1.6-.9 1.6H3.9c-.8 0-1.3-.9-.9-1.6L12 3.2z" />
                  <path d="M12 10.2v4.6" />
                  <circle cx="12" cy="16.8" r="0.7" fill="currentColor" stroke="none" />
                </svg>
                <div>
                  {#if referralEditLocked}
                    <span>Code updates are limited to one change.</span>
                    <span class="block mt-1">Old links still work.</span>
                  {:else}
                    <span>You can change your code once.</span>
                    <span class="block mt-1">Old links will still work.</span>
                  {/if}
</div>  
</div>

            {/if}
          </div>
          <div class="bg-black rounded-2xl p-4 flex items-center border border-zinc-800 gap-4">
          <div class="flex-1 min-w-0 pl-1">
            <div class="flex items-center gap-2">
              {#if referralEditing}
                <input
                  type="text"
                  bind:value={referralInput}
                  bind:this={referralInputEl}
                  maxlength="8"
                  placeholder="Set your code"
                  on:input={() => (referralDirty = true)}
                  style="scroll-margin-bottom: 40vh;"
                  on:focus={() => {
                    referralInputFocused = true;
                    scrollReferralInputIntoView();
                  }}
                  on:blur={() => {
                    referralInputFocused = false;
                  }}
                  class="bg-black border border-zinc-800 text-white h-9 w-36 px-3 rounded-xl text-xl font-black uppercase tracking-widest leading-none outline-none focus:ring-2 focus:ring-orange-500"
                />
                <button
                  type="button"
                  on:click={saveReferralCode}
                  disabled={referralSaving}
                  class="bg-orange-500 text-black p-2 rounded-xl disabled:opacity-50"
                  aria-label="Confirm referral code"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  on:click={cancelReferralEdit}
                  disabled={referralSaving}
                  class="bg-zinc-800 text-white p-2 rounded-xl disabled:opacity-50"
                  aria-label="Cancel referral code edit"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter">
                    <path d="M6 6l12 12" />
                    <path d="M18 6l-12 12" />
                  </svg>
                </button>
              {:else}
                <span class="inline-flex items-center h-9 text-xl font-black text-white uppercase tracking-widest leading-none">{userRefCode}</span>
                {#if !referralEditLocked}
                  <button
                    type="button"
                    bind:this={referralEditButton}
                    on:click|stopPropagation={() => {
                      showCodeChangeInfo = true;
                      startReferralEdit();
                    }}
                    class="bg-zinc-800 text-zinc-300 p-2 rounded-xl hover:text-white transition-colors"
                    aria-label="Edit referral code"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter">
                      <path d="M3 17.25V21h3.75L19 8.75l-3.75-3.75L3 17.25z" />
                      <path d="M14.75 5l3.75 3.75" />
                    </svg>
                  </button>
                {/if}
              {/if}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0 mr-1">
            <button on:click={copyToClipboard} class="bg-zinc-800 text-white text-[10px] font-black px-4 py-2 rounded-xl uppercase hover:bg-zinc-700">Copy</button>
          </div>
          </div>
        </div>
        {#if referralError}
          <p class="text-[10px] font-bold uppercase tracking-widest text-red-400">{referralError}</p>
        {/if}

        <button 
          bind:this={shareButtonEl}
          on:click={shareLink}
          class="w-full bg-orange-500 text-black font-black py-5 rounded-[2rem] text-xl uppercase tracking-tight active:scale-95 transition-all"
        >
          Share My Link
        </button>
      </div>
    </div>
  </div>  
</div>
