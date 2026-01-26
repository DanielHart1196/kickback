<script lang="ts">
  import { fade, fly, slide } from 'svelte/transition';
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { GOAL_DAYS, KICKBACK_RATE } from '$lib/claims/constants';
  import { calculateKickbackWithRate, getDaysAtVenue, isClaimDenied } from '$lib/claims/utils';
  import type { Claim } from '$lib/claims/types';
  import type { Venue } from '$lib/venues/types';

  export let claims: Claim[] = [];
  export let totalPending = 0;
  export let venues: Venue[] = [];
  export let userEmail = '';
  export let userId = '';
  export let claimantCodes: Record<string, string> = {};
  export let highlightClaimKey: string | null = null;
  export let onNewClaim: () => void = () => {};
  export let onDeleteClaim: (claim: Claim) => void = () => {};
  export let onLogout: () => void = () => {};
  export let onOpenRefer: () => void = () => {};

  let lastHighlightKey: string | null = null;
  let filterStatus: Set<'pending' | 'approved' | 'denied'> = new Set();
  let filterReferred: Set<'referred' | 'direct'> = new Set();
  let showFilterMenu = false;
  let listContainer: HTMLDivElement | null = null;

  async function scrollToHighlightedClaim(key: string) {
    if (typeof document === 'undefined') return;
    await tick();
    requestAnimationFrame(() => {
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(key)
          : key.replace(/"/g, '\\"');
      const el = document.querySelector(`[data-claim-key="${escaped}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  $: if (highlightClaimKey && highlightClaimKey !== lastHighlightKey) {
    lastHighlightKey = highlightClaimKey;
    scrollToHighlightedClaim(highlightClaimKey);
  }

  function getVenueRate(claim: Claim): number {
    if (claim.venue_id) {
      const venue = venues.find((v) => v.id === claim.venue_id);
      const rate = venue?.kickback_referrer ?? KICKBACK_RATE * 100;
      return Number(rate) / 100;
    }
    const normalizedName = claim.venue.trim().toLowerCase();
    const venue = venues.find((v) => v.name.trim().toLowerCase() === normalizedName);
    const rate = venue?.kickback_referrer ?? KICKBACK_RATE * 100;
    return Number(rate) / 100;
  }

  function getClaimRate(claim: Claim): number {
    const storedRate = claim.kickback_referrer_rate ?? null;
    if (storedRate != null) return Number(storedRate) / 100;
    return getVenueRate(claim);
  }

  function getKickbackForClaim(claim: Claim): number {
    return calculateKickbackWithRate(claim.amount, getClaimRate(claim));
  }

  function getTotalKickbackAtVenue(venueName: string): number {
    return claims.reduce((sum, claim) => {
      if (isClaimDenied(claim)) return sum;
      if (claim.venue.trim().toLowerCase() !== venueName.trim().toLowerCase()) return sum;
      const claimRate = getClaimRate(claim) * 100;
      return sum + calculateKickbackWithRate(Number(claim.amount || 0), Number(claimRate) / 100);
    }, 0);
  }

  function getClaimStatus(claim: Claim): 'pending' | 'approved' | 'denied' {
    return claim.status ?? 'approved';
  }

  function getStatusTotal(status: 'pending' | 'approved'): number {
    return claims.reduce((sum, claim) => {
      if (getClaimStatus(claim) !== status) return sum;
      return sum + getKickbackForClaim(claim);
    }, 0);
  }

  $: pendingTotal = getStatusTotal('pending');
  $: approvedTotal = getStatusTotal('approved');
  $: availableTotal = 0;
  $: filteredClaims = claims.filter((claim) => {
    const status = getClaimStatus(claim);
    const isReferred = Boolean(claim.referrer_id && claim.referrer_id === userId);
    const statusOk = filterStatus.size === 0 || filterStatus.has(status);
    const referredOk =
      filterReferred.size === 0 ||
      (filterReferred.has('referred') && isReferred) ||
      (filterReferred.has('direct') && !isReferred);
    return statusOk && referredOk;
  });


  function getStatusBadgeClass(status: 'pending' | 'approved' | 'denied'): string {
    if (status === 'approved') return 'border-green-500/30 bg-green-500/10 text-green-400';
    if (status === 'denied') return 'border-red-500/30 bg-red-500/10 text-red-400';
    return 'border-zinc-700 bg-zinc-800 text-zinc-300';
  }
</script>

<div class="w-full max-w-sm space-y-10" in:fade>
  <header class="text-center pt-2">
    <h1 class="text-4xl font-black tracking-tighter italic uppercase">
      <span class="text-white">Kick</span><span class="text-orange-500">back</span>
    </h1>
    <p class="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2">Member Dashboard</p>
  </header>

  <div class="bg-zinc-900 border border-zinc-800 p-8 rounded-[2.5rem] text-center shadow-2xl">
    <p class="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2">
      <span class="relative inline-block group">
        Balance
        <span
          class="absolute left-full top-1/2 -translate-y-1/2 ml-2 grid place-items-center text-center w-4 h-4 rounded-full border border-zinc-600 text-[9px] leading-none font-black text-zinc-600 normal-case tracking-normal"
          aria-hidden="true"
        >
          i
        </span>
        <span
          class="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <span class="block">Pending - ${pendingTotal.toFixed(2)}</span>
          <span class="block mt-1">Approved - ${approvedTotal.toFixed(2)}</span>
          <span class="block mt-1">Available - ${availableTotal.toFixed(2)}</span>
        </span>
      </span>
    </p>
    <div class="flex items-center justify-center gap-3">
      <h2 class="text-6xl font-black text-orange-500">${totalPending.toFixed(2)}</h2>
    </div>
  </div>

  <button 
    on:click={onNewClaim}
    class="w-full bg-white text-black font-black py-5 rounded-[2rem] text-xl uppercase tracking-tight shadow-xl shadow-white/5 active:scale-95 transition-all"
  >
    + New Claim
  </button>

  <div class="space-y-4 mt-12" bind:this={listContainer}>
    <div class="flex justify-between items-end border-b border-zinc-900 pb-4 relative">
      <h3 class="text-base font-black uppercase tracking-[0.18em] text-zinc-400">History</h3>
      <button
        type="button"
        on:click={() => (showFilterMenu = !showFilterMenu)}
        class="text-sm font-bold text-zinc-500 uppercase flex items-center gap-2 hover:text-white transition-colors"
        aria-haspopup="true"
        aria-expanded={showFilterMenu}
      >
        {filteredClaims.length} Claims
        <svg viewBox="0 0 24 24" aria-hidden="true" class={`h-4 w-4 transition-transform ${showFilterMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {#if showFilterMenu}
        <div class="absolute right-0 top-full mt-2 w-56 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-3 space-y-3 z-10">
          <div>
            <p class="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500 mb-2">Status</p>
            <div class="flex flex-col gap-2">
              {#each ['approved','pending','denied'] as status}
                {#if status === 'approved'}
                  <button
                    type="button"
                    class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${filterStatus.has(status as any) ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                    on:click={() => {
                      const next = new Set(filterStatus);
                      if (next.has(status as any)) {
                        next.delete(status as any);
                      } else {
                        next.add(status as any);
                      }
                      filterStatus = next;
                    }}
                  >
                    APPROVED
                  </button>
                {:else if status === 'pending'}
                  <button
                    type="button"
                    class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${filterStatus.has(status as any) ? 'border-zinc-700 bg-zinc-800 text-zinc-200' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                    on:click={() => {
                      const next = new Set(filterStatus);
                      if (next.has(status as any)) {
                        next.delete(status as any);
                      } else {
                        next.add(status as any);
                      }
                      filterStatus = next;
                    }}
                  >
                    PENDING
                  </button>
                {:else}
                  <button
                    type="button"
                    class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${filterStatus.has(status as any) ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                    on:click={() => {
                      const next = new Set(filterStatus);
                      if (next.has(status as any)) {
                        next.delete(status as any);
                      } else {
                        next.add(status as any);
                      }
                      filterStatus = next;
                    }}
                  >
                    DENIED
                  </button>
                {/if}
              {/each}
            </div>
          </div>
          <div>
            <p class="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500 mb-2">Referral</p>
            <div class="flex gap-2">
              {#each ['referred','direct'] as kind}
                <button
                  type="button"
                  class={`px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border flex-1 ${filterReferred.has(kind as any) ? 'bg-orange-500 text-black border-orange-400' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'}`}
                  on:click={() => {
                    const next = new Set(filterReferred);
                    if (next.has(kind as any)) {
                      next.delete(kind as any);
                    } else {
                      next.add(kind as any);
                    }
                    filterReferred = next;
                  }}
                >
                  {kind}
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>

    {#if filteredClaims.length === 0}
      <div class="py-12 text-center border-2 border-dashed border-zinc-900 rounded-[2rem]" transition:fade|local={{ duration: 180 }}>
        <p class="text-zinc-600 text-xs font-bold uppercase tracking-widest">No activity yet</p>
      </div>
    {/if}
    {#each filteredClaims as claim (claim.id ?? claim.created_at)}
      <div transition:slide|local={{ duration: 220 }}>
        <details
          class={`group bg-zinc-900/20 border border-zinc-900 rounded-2xl overflow-hidden mb-4 ${
            (claim.id ?? claim.created_at) === highlightClaimKey
              ? 'ring-2 ring-orange-500/60 shadow-lg shadow-orange-500/20'
              : ''
          }`}
          data-claim-key={claim.id ?? claim.created_at}
        >
        <summary class="list-none p-5 flex items-center justify-between gap-4 cursor-pointer active:bg-zinc-900/50">
            <div class="flex items-center justify-between flex-1 gap-4">
              <div class="flex flex-col justify-center">
              <p class={`text-xl font-black ${isClaimDenied(claim) ? 'text-zinc-500' : 'text-green-500'}`}>
                +${calculateKickbackWithRate(claim.amount, getClaimRate(claim)).toFixed(2)}
              </p>
              {#if claim.referrer_id && claim.referrer_id === userId}
                <p class="text-zinc-300 uppercase tracking-tight text-sm font-bold">
                  {claimantCodes[claim.submitter_id ?? ''] || claim.referrer || 'Referral'}
                </p>
              {:else}
                <p class="text-zinc-300 uppercase tracking-tight text-sm font-bold">{claim.venue}</p>
              {/if}
              </div>
            <div class="flex flex-col items-end gap-1">
            <div class="flex items-center gap-2">
              <p class="text-zinc-500 text-sm font-bold">
                {new Date(claim.purchased_at).toLocaleDateString()} {new Date(claim.purchased_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <div class="flex items-center gap-2">
              {#if claim.referrer_id && claim.referrer_id === userId}
                <span class="border border-orange-400/60 bg-orange-500/15 text-orange-300 text-[10px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-full">
                  Referred
                </span>
              {/if}
              <span class={`border rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${getStatusBadgeClass(getClaimStatus(claim))}`}>
                {getClaimStatus(claim).toUpperCase()}
              </span>
            </div>
            </div>
          </div>
          <div class="text-zinc-600 group-open:rotate-180 transition-transform">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </summary>

        <div class="px-5 pb-6 pt-2 space-y-6">
          
          <div class="space-y-3">
            <div class="flex flex-col gap-1 text-sm font-black uppercase text-zinc-400 tracking-widest md:flex-row md:items-center md:justify-between">
              {#if claim.referrer_id && claim.referrer_id === userId}
                <p>Total kickback at {claim.venue} from {claimantCodes[claim.submitter_id ?? ''] || claim.referrer || 'Referral'}</p>
              {:else}
                <p>Total kickback at {claim.venue}</p>
              {/if}
              <p class="text-base font-black text-orange-500">
                ${getTotalKickbackAtVenue(claim.venue).toFixed(2)}
              </p>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-sm font-black uppercase text-zinc-400 tracking-widest">30-day progress</p>
              <p class="text-sm font-black text-white">
                {GOAL_DAYS - getDaysAtVenue(claims, claim.venue)} DAYS LEFT
              </p>
            </div>
            <div class="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-orange-500 transition-all duration-1000"
                style="width: {(getDaysAtVenue(claims, claim.venue) / GOAL_DAYS) * 100}%"
              ></div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-800/50">
            <div>
              <p class="text-xs font-black text-zinc-400 uppercase mb-1">Total Bill</p>
              <p class="text-sm font-bold text-white">${claim.amount.toFixed(2)}</p>
            </div>
            <div>
              <p class="text-xs font-black text-zinc-400 uppercase mb-1">
                {claim.referrer_id && claim.referrer_id === userId ? 'Guest Code' : 'Referrer'}
              </p>
              <p class="text-sm font-bold uppercase">
                <span class="text-white">{claim.referrer_id && claim.referrer_id === userId ? (claimantCodes[claim.submitter_id ?? ''] || 'Guest') : (claim.referrer || 'Direct')}</span>
                <span class={isClaimDenied(claim) ? 'text-zinc-500' : 'text-green-500'}>
                  +${calculateKickbackWithRate(claim.amount, getClaimRate(claim)).toFixed(2)}
                </span>
              </p>
            </div>
            {#if !(claim.referrer_id && claim.referrer_id === userId)}
              <div>
                <p class="text-xs font-black text-zinc-400 uppercase mb-1">Card Last 4</p>
                <p class="text-sm font-bold text-white">**** {claim.last_4}</p>
              </div>
            {/if}
            <div class="flex items-end justify-end">
              {#if claim.id && claim.submitter_id === userId}
                <button
                  type="button"
                  on:click={() => onDeleteClaim(claim)}
                  class="text-xs font-black uppercase tracking-widest text-red-500 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              {/if}
            </div>
          </div>
        </div>
      </details>
      </div>
    {/each}
    
    <div class="mt-12 text-center">
      <button 
        on:click={onLogout}
        class="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] hover:text-white transition-colors"
      >
        LOGOUT: {userEmail}
      </button>
    </div>

    <div class="h-32 w-full"></div>
  </div>
</div>

<div class="fixed bottom-8 left-0 right-0 px-6 z-50 flex justify-center" in:fly={{ y: 100 }}>
  <button 
    on:click={onOpenRefer}
    class="w-full max-w-sm bg-zinc-900/80 backdrop-blur-xl border border-zinc-700 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 shadow-2xl active:scale-95 transition-all uppercase text-xs tracking-[0.2em]">
    Refer a Friend
  </button>
</div>

