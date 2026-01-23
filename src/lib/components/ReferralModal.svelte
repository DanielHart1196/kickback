<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import QRCode from 'qrcode';

  export let userRefCode = 'member';
  export let venues: { id: string; name: string }[] = [];
  export let onClose: () => void = () => {};

  let referralVenueId = '';
  let referralVenueName = '';
  let qrDataUrl = '';
  let touchStart = 0;
  let currentYOffset = 0;

  $: referralVenueName = venues.find((venue) => venue.id === referralVenueId)?.name ?? '';
  $: referralLink = buildReferralLink(userRefCode, referralVenueId, referralVenueName);

  $: if (referralLink) {
    QRCode.toDataURL(referralLink, { margin: 2, scale: 8, color: { dark: '#000000', light: '#ffffff' } })
      .then((url: string) => {
        qrDataUrl = url;
      })
      .catch((err: Error) => {
        console.error(err);
      });
  }

  function buildReferralLink(code: string, venueId: string, venueName: string): string {
    const params = new URLSearchParams();
    params.set('ref', code);
    if (venueId) params.set('venue_id', venueId);
    if (venueName) params.set('venue', venueName);
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
        <h2 class="text-2xl font-black italic uppercase tracking-tighter text-white">Share the Kickback</h2>
      </header>

      <div class="mb-8">
        <label for="ref-venue" class="block text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-3 px-1 text-center">Refer to a specific bar?</label>
        <select 
          id="ref-venue"
          bind:value={referralVenueId}
          class="w-full bg-black border border-zinc-800 text-white p-4 rounded-2xl text-xs font-bold uppercase tracking-widest outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none text-center"
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
        <div class="bg-black rounded-2xl p-4 flex justify-between items-center border border-zinc-800">
          <div>
            <p class="text-[8px] font-black text-zinc-600 uppercase mb-0.5">Your Code</p>
            <p class="text-sm font-black text-white uppercase tracking-widest">{userRefCode}</p>
          </div>
          <button on:click={copyToClipboard} class="bg-zinc-800 text-white text-[10px] font-black px-4 py-2 rounded-xl uppercase hover:bg-zinc-700">Copy</button>
        </div>

        <button 
          on:click={shareLink}
          class="w-full bg-orange-500 text-black font-black py-5 rounded-[2rem] text-sm uppercase tracking-widest active:scale-95 transition-all shadow-xl shadow-orange-500/20"
        >
          Share My {referralVenueName ? referralVenueName : ''} Link
        </button>
      </div>
    </div>
  </div>  
</div>

