<script lang="ts">
  import { fade, fly, slide } from 'svelte/transition';
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { GOAL_DAYS, KICKBACK_RATE } from '$lib/claims/constants';
  import { calculateKickbackWithRate, getDaysAtVenue, isClaimDenied } from '$lib/claims/utils';
  import { supabase } from '$lib/supabase';
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
  export let onRequestInstall: () => void = () => {};

  let lastHighlightKey: string | null = null;
  let pendingTotal = 0;
  let approvedTotal = 0;
  let availableTotal = 0;
  let filterStatus: Set<'pending' | 'approved' | 'denied'> = new Set();
  let filterReferred: Set<'referred' | 'direct'> = new Set();
  let showFilterMenu = false;
  let listContainer: HTMLDivElement | null = null;
  let filterMenuEl: HTMLDivElement | null = null;
  let filterButtonEl: HTMLButtonElement | null = null;
  let showSettings = false;
  let showDeleteWarning = false;
  let deleteStatus: 'idle' | 'loading' | 'error' = 'idle';
  let deleteError = '';
  let payoutPayId = '';
  let payoutFullName = '';
  let payoutDob = '';
  let payoutAddress = '';
  let payoutStatus: 'idle' | 'loading' | 'saving' | 'error' | 'success' = 'idle';
  let payoutError = '';
  let payoutMessage = '';

  onMount(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!showFilterMenu) return;
      const target = event.target as Node;
      if (filterMenuEl?.contains(target)) return;
      if (filterButtonEl?.contains(target)) return;
      showFilterMenu = false;
    };
    document.addEventListener('click', handleOutsideClick);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  });

  function openSettings() {
    showSettings = true;
    void loadPayoutProfile();
  }

  function closeSettings() {
    showSettings = false;
  }

  async function loadPayoutProfile() {
    if (!userId) return;
    payoutStatus = 'loading';
    payoutError = '';
    payoutMessage = '';
    try {
      const { data, error } = await supabase
        .from('payout_profiles')
        .select('pay_id, full_name, dob, address')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      payoutPayId = data?.pay_id ?? '';
      payoutFullName = data?.full_name ?? '';
      payoutDob = data?.dob ?? '';
      payoutAddress = data?.address ?? '';
      payoutStatus = 'idle';
    } catch (error) {
      payoutStatus = 'error';
      payoutError = error instanceof Error ? error.message : 'Failed to load payout details.';
    }
  }

  async function savePayoutProfile() {
    if (!userId) return;
    payoutStatus = 'saving';
    payoutError = '';
    payoutMessage = '';
    try {
      const payload = {
        user_id: userId,
        pay_id: payoutPayId.trim() || null,
        full_name: payoutFullName.trim() || null,
        dob: payoutDob || null,
        address: payoutAddress.trim() || null,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('payout_profiles').upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      payoutStatus = 'success';
      payoutMessage = 'Payout details saved.';
      setTimeout(() => {
        if (payoutStatus === 'success') payoutStatus = 'idle';
      }, 2000);
    } catch (error) {
      payoutStatus = 'error';
      payoutError = error instanceof Error ? error.message : 'Failed to save payout details.';
    }
  }

  function openDeleteWarning() {
    deleteStatus = 'idle';
    deleteError = '';
    showDeleteWarning = true;
  }

  function closeDeleteWarning() {
    showDeleteWarning = false;
  }

  async function confirmDeleteAccount() {
    deleteStatus = 'loading';
    deleteError = '';
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) {
        deleteStatus = 'error';
        deleteError = 'Session expired. Please sign in again.';
        return;
      }
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`
        }
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        deleteStatus = 'error';
        deleteError = payload?.error ?? 'Failed to delete account.';
        return;
      }
      await supabase.auth.signOut();
      window.location.href = '/login';
    } catch (error) {
      deleteStatus = 'error';
      deleteError = error instanceof Error ? error.message : 'Failed to delete account.';
    }
  }

  

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

  $: {
    claims;
    venues;
    pendingTotal = getStatusTotal('pending');
    approvedTotal = getStatusTotal('approved');
    availableTotal = 0;
  }
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

<div class="w-full max-w-sm space-y-10 mx-auto" in:fade>
  <header class="relative text-center pt-2">
    <button
      type="button"
      class="text-4xl font-black tracking-tighter italic uppercase cursor-pointer select-none"
      on:click={onRequestInstall}
      title="Add Kickback to home"
      aria-label="Add Kickback to home"
    >
      <span class="text-white">Kick</span><span class="text-orange-500">back</span>
    </button>
    <button
      type="button"
      on:click={openSettings}
      class="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:text-white transition-colors"
      aria-label="Open user settings"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </button>
    <p class="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2">Member Dashboard</p>
  </header>

  <div class="bg-zinc-900 border border-zinc-800 p-8 rounded-[2.5rem] text-center shadow-2xl">
    <p class="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2">
      <span class="relative inline-block group">
        Balance
        <span
          class="absolute left-full top-1/2 -translate-y-1/2 ml-2 grid place-items-center text-center w-3.5 h-3.5 rounded-full border border-zinc-600 text-[9px] leading-none font-black text-zinc-600 normal-case tracking-normal"
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
        bind:this={filterButtonEl}
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
        <div bind:this={filterMenuEl} class="absolute right-0 top-full mt-2 w-56 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-3 space-y-3 z-10">
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
            <div class="flex flex-col gap-2">
              {#each ['referred','direct'] as kind}
                <button
                  type="button"
                  class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${
                    kind === 'referred'
                      ? filterReferred.has(kind as any)
                        ? 'border-orange-400/60 bg-orange-500/15 text-orange-300'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                      : filterReferred.has(kind as any)
                        ? 'border-zinc-600 bg-zinc-800 text-zinc-200'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                  }`}
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
                  {kind === 'referred' ? 'Referred' : 'Direct'}
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
                  <span class="ml-1 text-orange-400">
                    +${calculateKickbackWithRate(claim.amount, getClaimRate(claim)).toFixed(2)}
                  </span>
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
                {Math.max(GOAL_DAYS - getDaysAtVenue(claims, claim.venue) + 1, 0)} DAYS LEFT
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
                {claim.referrer_id && claim.referrer_id === userId ? 'Code' : 'Referrer'}
              </p>
              <p class="text-sm font-bold uppercase">
                {#if claim.referrer_id && claim.referrer_id === userId}
                  <span class="text-white">{claim.referrer || claimantCodes[claim.submitter_id ?? ''] || 'Code'}</span>
                {:else}
                  <span class="text-white">{claim.referrer || 'Direct'}</span>
                  <span class={isClaimDenied(claim) ? 'text-zinc-500' : 'text-green-500'}>
                    +${calculateKickbackWithRate(claim.amount, getClaimRate(claim)).toFixed(2)}
                  </span>
                {/if}
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

    {#if showFilterMenu}
      <div class="h-16 w-full"></div>
    {/if}
    <div class="h-20 w-full"></div>
  </div>
</div>

{#if showSettings}
  <div class="fixed inset-0 z-[240]">
    <button
      type="button"
      on:click={closeSettings}
      class="absolute inset-0 bg-black/60 backdrop-blur-sm"
      aria-label="Close user settings"
    ></button>
    <aside
      class="absolute right-0 top-0 h-full w-[320px] max-w-[88vw] bg-zinc-950 border-l border-zinc-800 p-6 shadow-2xl"
      transition:fly={{ x: 320, duration: 220 }}
    >
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-black uppercase tracking-[0.2em] text-white">User Settings</h2>
        <button
          type="button"
          on:click={closeSettings}
          class="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 hover:text-white transition-colors"
        >
          Close
        </button>
      </div>
      <div class="mt-6 space-y-4 text-sm text-zinc-300">
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Account</p>
          <p class="mt-3 text-white truncate">{userEmail || 'Signed in'}</p>
          <p class="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Signed in with Google
          </p>
        </div>
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Payouts</p>
          <div class="mt-4 space-y-3">
            <input
              type="text"
              bind:value={payoutPayId}
              placeholder="PayID (email or mobile)"
              class="w-full bg-black border border-zinc-800 text-white h-10 px-3 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-orange-500"
            />
            <input
              type="text"
              bind:value={payoutFullName}
              placeholder="Full name"
              class="w-full bg-black border border-zinc-800 text-white h-10 px-3 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-orange-500"
            />
            <input
              type="date"
              bind:value={payoutDob}
              class="w-full bg-black border border-zinc-800 text-white h-10 px-3 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-orange-500"
            />
            <textarea
              bind:value={payoutAddress}
              rows="3"
              placeholder="Address"
              class="w-full bg-black border border-zinc-800 text-white px-3 py-2 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-orange-500 resize-none"
            ></textarea>
            <button
              type="button"
              on:click={savePayoutProfile}
              disabled={payoutStatus === 'saving' || payoutStatus === 'loading'}
              class="w-full rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-zinc-200 transition-colors disabled:opacity-60"
            >
              {payoutStatus === 'saving' ? 'Saving...' : 'Save payout details'}
            </button>
            {#if payoutError}
              <p class="text-[10px] font-bold uppercase tracking-widest text-red-400">{payoutError}</p>
            {/if}
            {#if payoutMessage}
              <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{payoutMessage}</p>
            {/if}
          </div>
        </div>
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Actions</p>
          <button
            type="button"
            on:click={onLogout}
            class="mt-3 w-full rounded-xl border border-zinc-700 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            Log out
          </button>
          <button
            type="button"
            on:click={openDeleteWarning}
            class="mt-4 w-full text-center text-[10px] font-black uppercase tracking-[0.3em] text-red-400 hover:text-red-300 transition-colors"
          >
            Delete my account
          </button>
        </div>
      </div>
    </aside>
  </div>
{/if}

{#if showDeleteWarning}
  <div class="fixed inset-0 z-[260]">
    <button
      type="button"
      on:click={closeDeleteWarning}
      class="absolute inset-0 bg-black/70 backdrop-blur-sm"
      aria-label="Close delete account warning"
    ></button>
    <div class="absolute left-1/2 top-1/2 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
      <h3 class="text-sm font-black uppercase tracking-[0.2em] text-white">Delete account</h3>
      <p class="mt-4 text-sm text-zinc-300">
        This cannot be undone. All data associated with your account will be deleted, and any
        balance in your account will be lost.
      </p>
      {#if deleteError}
        <p class="mt-3 text-[10px] font-bold uppercase tracking-widest text-red-400">
          {deleteError}
        </p>
      {/if}
      <button
        type="button"
        on:click={confirmDeleteAccount}
        disabled={deleteStatus === 'loading'}
        class="mt-6 w-full rounded-xl bg-red-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-red-400 transition-colors disabled:opacity-60"
      >
        {deleteStatus === 'loading' ? 'Deleting...' : 'Delete account'}
      </button>
      <button
        type="button"
        on:click={closeDeleteWarning}
        class="mt-3 w-full rounded-xl border border-zinc-700 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-zinc-200 hover:border-zinc-500 transition-colors"
      >
        Cancel
      </button>
    </div>
  </div>
{/if}

<button 
  on:click={onOpenRefer}
  class="fixed bottom-8 -translate-x-1/2 w-[calc(100%-3rem)] max-w-sm z-50 bg-zinc-900/80 backdrop-blur-xl border border-zinc-700 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 shadow-2xl active:scale-95 transition-all uppercase text-xs tracking-[0.2em]"
  style="left: calc(50% - (var(--scrollbar-width) / 2));"
  in:fly={{ y: 100 }}
>
  Refer a Friend
</button>

