<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import QRCode from 'qrcode';
  import { isReferralCodeValid, normalizeReferralCode } from '$lib/referrals/code';

  export let userRefCode = 'member';
  export let venues: { id: string; name: string; short_code?: string | null }[] = [];
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
  $: referralVenueName = venues.find((venue) => venue.id === referralVenueId)?.name ?? '';
  $: referralVenueCode = venues.find((venue) => venue.id === referralVenueId)?.short_code ?? '';
  $: referralLink = buildReferralLink(userRefCode, referralVenueCode, referralVenueName);
  $: if (!referralDirty) referralInput = userRefCode;

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
    params.set('ref', code);
    if (venueCode) {
      params.set('venue_code', venueCode);
    } else if (venueName) {
      params.set('venue', venueName);
    }
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

  function startReferralEdit() {
    referralError = '';
    referralMessage = '';
    referralEditing = true;
    referralInput = userRefCode;
    referralDirty = false;
  }

  function cancelReferralEdit() {
    referralEditing = false;
    referralDirty = false;
    referralError = '';
    referralMessage = '';
    referralInput = userRefCode;
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

  onMount(() => {
    if (typeof document === 'undefined') return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original || 'auto';
    };
  });

</script>

<div class="fixed inset-0 bg-black/90 backdrop-blur-md z-[300] flex items-end justify-center" transition:fade>
  <button on:click={onClose} class="absolute inset-0 w-full h-full cursor-default" aria-label="Close"></button>

  <div 
    class="bg-zinc-900 w-full max-w-md rounded-t-[2.5rem] relative pb-12 transition-transform"
    style="transform: translateY({currentYOffset}px); transition: {currentYOffset === 0 ? 'transform 0.3s ease-out' : 'none'};"
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
        <h2 class="text-2xl font-black italic uppercase tracking-tighter text-white">
          Share the <span class="text-white">Kick</span><span class="text-orange-500">back</span>
        </h2>
      </header>

      <div class="mb-8">
        <label for="ref-venue" class="block text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-3 px-1 text-center">Which venue?</label>
        <select 
          id="ref-venue"
          bind:value={referralVenueId}
          class="w-full bg-black border border-zinc-800 text-white p-4 rounded-2xl text-xl font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none text-center"
        >
          <option value="">General Invite</option>
          {#each venues as venue}
            <option value={venue.id}>{venue.name}</option>
          {/each}
        </select>
      </div>

      <div class="bg-white p-4 rounded-[2.5rem] w-48 h-48 mx-auto mb-8 flex items-center justify-center shadow-xl shadow-white/5">
        {#if qrDataUrl}
          <img src={qrDataUrl} alt="Referral QR Code" class="w-full h-full" />
        {/if}
      </div>

      <div class="space-y-4">
        <div>
          <p class="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3 px-1 text-center">Your Code</p>
          <div class="bg-black rounded-2xl p-4 flex items-center border border-zinc-800 gap-4">
          <div class="flex-1 min-w-0 pl-1">
            <div class="flex items-center gap-2">
              {#if referralEditing}
                <input
                  type="text"
                  bind:value={referralInput}
                  maxlength="8"
                  placeholder="Set your code"
                  on:input={() => (referralDirty = true)}
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
                <button
                  type="button"
                  on:click={startReferralEdit}
                  class="bg-zinc-800 text-zinc-300 p-2 rounded-xl hover:text-white transition-colors"
                  aria-label="Edit referral code"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter">
                    <path d="M3 17.25V21h3.75L19 8.75l-3.75-3.75L3 17.25z" />
                    <path d="M14.75 5l3.75 3.75" />
                  </svg>
                </button>
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
          on:click={shareLink}
          class="w-full bg-orange-500 text-black font-black py-5 rounded-[2rem] text-xl uppercase tracking-tight active:scale-95 transition-all"
        >
          Share My {referralVenueName ? referralVenueName : ''} Link
        </button>
      </div>
    </div>
  </div>  
</div>
