<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { fetchClaimsForVenueId, updateClaimStatus } from '$lib/claims/repository';
  import { calculateTotalAmount } from '$lib/claims/utils';
  import type { Claim, ClaimStatus } from '$lib/claims/types';
  import type { Venue } from '$lib/venues/types';

  let claims: Claim[] = [];
  let loading = true;
  let venue: Venue | null = null;
  let venueName = '';
  let guestRate = '5';
  let referrerRate = '5';
  let savingVenue = false;
  let savingError = '';
  let logoUploading = false;
  let logoError = '';
  let logoInput: HTMLInputElement | null = null;
  let signingOut = false;
  let userEmail = '';
  let logoDeleting = false;
  let updatingClaimId: string | null = null;

  onMount(async () => {
    try {
      await fetchVenue();
      if (venue?.id) {
        claims = await fetchClaimsForVenueId(venue.id);
      } else {
        claims = [];
      }
    } catch (error) {
      console.error('Error fetching claims:', error);
    } finally {
      loading = false;
    }
  });

  $: totalAmount = calculateTotalAmount(claims);

  async function fetchVenue() {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    userEmail = user?.email ?? '';
    if (!user) return;

    const { data: directVenues, error: directError } = await supabase
      .from('venues')
      .select('id, name, logo_url, kickback_guest, kickback_referrer, active, created_by')
      .eq('created_by', user.id)
      .limit(1);

    if (directError) {
      console.error('Error fetching venue:', directError);
    }

    let venueRecord = directVenues?.[0] ?? null;

    if (!venueRecord) {
      const { data: ownerLinks, error: ownerError } = await supabase
        .from('venue_owners')
        .select('venue_id')
        .eq('owner_id', user.id);

      if (ownerError) {
        console.error('Error fetching owner venues:', ownerError);
      }

      const venueIds = (ownerLinks ?? []).map((link) => link.venue_id);
      if (venueIds.length > 0) {
        const { data: linkedVenues, error: linkedError } = await supabase
          .from('venues')
          .select('id, name, logo_url, kickback_guest, kickback_referrer, active')
          .in('id', venueIds)
          .limit(1);

        if (linkedError) {
          console.error('Error fetching linked venue:', linkedError);
        }
        venueRecord = linkedVenues?.[0] ?? null;
      }
    }

    venue = venueRecord;
    venueName = venue?.name ?? '';
    guestRate = venue?.kickback_guest != null ? String(venue.kickback_guest) : '5';
    referrerRate = venue?.kickback_referrer != null ? String(venue.kickback_referrer) : '5';
  }

  async function createVenue() {
    savingVenue = true;
    savingError = '';
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!user) return;

      const payload = {
        name: venueName.trim(),
        created_by: user.id,
        kickback_guest: Number(guestRate),
        kickback_referrer: Number(referrerRate)
      };

      const { data, error } = await supabase.from('venues').insert(payload).select().single();
      if (error) throw error;

      venue = data;
    } catch (error) {
      console.error('Error creating venue:', error);
      savingError = 'Failed to create venue.';
    } finally {
      savingVenue = false;
    }
  }

  async function saveVenue() {
    if (!venue) return;
    savingVenue = true;
    savingError = '';
    try {
      const payload = {
        name: venueName.trim(),
        kickback_guest: Number(guestRate),
        kickback_referrer: Number(referrerRate)
      };
      const { error } = await supabase.from('venues').update(payload).eq('id', venue.id);
      if (error) throw error;
      venue = { ...venue, ...payload };
    } catch (error) {
      console.error('Error saving venue:', error);
      savingError = 'Failed to save venue.';
    } finally {
      savingVenue = false;
    }
  }

  async function handleLogoUpload(file: File) {
    if (!venue) return;
    logoUploading = true;
    logoError = '';
    try {
      const fileExt = file.name.split('.').pop() || 'png';
      const filePath = `venues/${venue.id}/${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('venue-logos')
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: publicUrl } = supabase.storage.from('venue-logos').getPublicUrl(filePath);
      const { error: updateError } = await supabase
        .from('venues')
        .update({ logo_url: publicUrl.publicUrl })
        .eq('id', venue.id);
      if (updateError) throw updateError;

      venue = { ...venue, logo_url: publicUrl.publicUrl };
    } catch (error) {
      console.error('Error uploading logo:', error);
      logoError = 'Failed to upload logo.';
    } finally {
      logoUploading = false;
    }
  }

  function getStoragePathFromPublicUrl(url: string): string | null {
    const marker = '/storage/v1/object/public/venue-logos/';
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return url.slice(index + marker.length);
  }

  async function handleLogoDelete() {
    if (!venue?.logo_url) return;
    const confirmed = window.confirm('Remove venue logo?');
    if (!confirmed) return;
    logoDeleting = true;
    logoError = '';
    try {
      const path = getStoragePathFromPublicUrl(venue.logo_url);
      if (path) {
        const { error: removeError } = await supabase.storage
          .from('venue-logos')
          .remove([path]);
        if (removeError) throw removeError;
      }

      const { error: updateError } = await supabase
        .from('venues')
        .update({ logo_url: null })
        .eq('id', venue.id);
      if (updateError) throw updateError;

      venue = { ...venue, logo_url: null };
    } catch (error) {
      console.error('Error deleting logo:', error);
      logoError = 'Failed to remove logo.';
    } finally {
      logoDeleting = false;
    }
  }

  function triggerLogoUpload() {
    if (logoInput) logoInput.click();
  }

  function getClaimStatus(claim: Claim): ClaimStatus {
    return claim.status ?? 'approved';
  }

  function getStatusBadgeClass(status: ClaimStatus): string {
    if (status === 'approved') return 'border-green-500/30 bg-green-500/10 text-green-400';
    if (status === 'denied') return 'border-red-500/30 bg-red-500/10 text-red-400';
    return 'border-zinc-700 bg-zinc-800 text-zinc-300';
  }

  async function handleClaimStatus(claim: Claim, status: ClaimStatus) {
    if (!claim.id) return;
    updatingClaimId = claim.id;
    try {
      await updateClaimStatus(claim.id, status);
      claims = claims.map((item) => (item.id === claim.id ? { ...item, status } : item));
    } catch (error) {
      console.error('Error updating claim status:', error);
    } finally {
      updatingClaimId = null;
    }
  }

  async function handleSignOut() {
    signingOut = true;
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.href = '/admin/login';
    }
  }
</script>

<div class="p-4 md:p-10 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
  <div class="max-w-4xl mx-auto space-y-10">
    <section class="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div class="flex items-center gap-5">
          <div class="relative logo-wrap">
            <button
              type="button"
              on:click={triggerLogoUpload}
              class="w-20 h-20 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 text-xs font-black uppercase tracking-widest hover:text-white transition-colors text-center"
              class:overflow-hidden={Boolean(venue?.logo_url)}
              disabled={!venue || logoDeleting}
            >
              {#if venue?.logo_url}
                <img src={venue.logo_url} alt={venue.name} class="w-full h-full object-cover" />
              {:else if logoUploading}
                <span class="loading-dots" aria-label="Uploading">
                  <span class="dot" aria-hidden="true"></span>
                  <span class="dot" aria-hidden="true"></span>
                  <span class="dot" aria-hidden="true"></span>
                </span>
              {:else}
                <span class="flex flex-col items-center justify-center leading-tight -translate-y-0.5">
                  <span class="block text-lg">+</span>
                  <span class="block">Logo</span>
                </span>
              {/if}
            </button>
            {#if venue?.logo_url}
              <button
                type="button"
                on:click={handleLogoDelete}
                disabled={logoDeleting}
                class="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-black flex items-center justify-center hover:text-white transition-colors logo-delete"
                aria-label="Remove logo"
              >
                {logoDeleting ? '…' : 'X'}
              </button>
            {/if}
          </div>
          <div class="space-y-2">
            <p class="text-xs font-black uppercase tracking-widest text-zinc-500">Venue</p>
            <input
              type="text"
              bind:value={venueName}
              placeholder="Venue name"
              class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-lg font-bold text-white w-full md:w-72"
            />
          </div>
        </div>
        <div class="flex flex-col gap-3 w-full md:w-auto">
          <div class="flex flex-col md:flex-row gap-3">
            <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
              Guest Kickback %
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                bind:value={guestRate}
                class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-base font-bold text-white w-full md:w-40"
              />
            </label>
            <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
              Referrer Kickback %
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                bind:value={referrerRate}
                class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-base font-bold text-white w-full md:w-40"
              />
            </label>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            {#if venue}
              <button
                type="button"
                on:click={saveVenue}
                disabled={savingVenue || !venueName.trim()}
                class="bg-white text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight disabled:opacity-50"
              >
                {savingVenue ? 'Saving...' : 'Save Changes'}
              </button>
            {:else}
              <button
                type="button"
                on:click={createVenue}
                disabled={savingVenue || !venueName.trim()}
                class="bg-white text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight disabled:opacity-50"
              >
                {savingVenue ? 'Creating...' : 'Create Venue'}
              </button>
            {/if}
            {#if savingError}
              <span class="text-xs font-bold uppercase tracking-widest text-red-400">{savingError}</span>
            {/if}
            {#if logoError}
              <span class="text-xs font-bold uppercase tracking-widest text-red-400">{logoError}</span>
            {/if}
          </div>
        </div>
      </div>
      <input
        bind:this={logoInput}
        type="file"
        accept="image/*"
        class="hidden"
        on:change={(event) => {
          const target = event.currentTarget as HTMLInputElement;
          const file = target.files?.[0];
          if (file) handleLogoUpload(file);
          if (target) target.value = '';
        }}
      />
    </section>

    <section class="flex justify-between items-end">
      <div>
        <h1 class="text-zinc-500 uppercase tracking-tighter text-sm font-bold">
          <span class="text-white">Kick</span><span class="text-orange-500">back</span> Dashboard
        </h1>
        <div class="text-6xl font-black text-white mt-1">${totalAmount.toFixed(2)}</div>
      </div>
      <div class="text-right">
        <div class="text-zinc-500 text-sm uppercase font-bold">Total Claims</div>
        <div class="text-2xl font-bold">{claims.length}</div>
      </div>
    </section>

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-zinc-800/50 text-zinc-400 text-xs uppercase">
            <th class="p-4 font-semibold">Date/Time</th>
            <th class="p-4 font-semibold text-right">Amount</th>
            <th class="p-4 font-semibold text-center">Last 4</th>
            <th class="p-4 font-semibold text-center">Status</th>
            <th class="p-4 font-semibold text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-800">
          {#each claims as claim}
            <tr class="hover:bg-zinc-800/30 transition-colors">
              <td class="p-4 text-zinc-400 text-sm">
                {new Date(claim.purchased_at).toLocaleDateString()} 
                <span class="text-zinc-600 ml-1">{new Date(claim.purchased_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </td>
              <td class={`p-4 text-right font-mono font-bold ${getClaimStatus(claim) === 'denied' ? 'text-zinc-600' : 'text-orange-400'}`}>
                ${Number(claim.amount).toFixed(2)}
              </td>
              <td class="p-4 text-center">
                <span class="bg-zinc-800 px-2 py-1 rounded text-xs text-zinc-300">**** {claim.last_4}</span>
              </td>
              <td class="p-4 text-center">
                <span class={`inline-flex items-center border rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${getStatusBadgeClass(getClaimStatus(claim))}`}>
                  {getClaimStatus(claim).toUpperCase()}
                </span>
              </td>
              <td class="p-4 text-right">
                {#if claim.id}
                  <div class="flex justify-end gap-2">
                    {#if getClaimStatus(claim) !== 'approved'}
                      <button
                        type="button"
                        on:click={() => handleClaimStatus(claim, 'approved')}
                        disabled={updatingClaimId === claim.id}
                        class="text-xs font-black uppercase tracking-widest text-green-400 hover:text-green-300 transition-colors disabled:opacity-50"
                      >
                        Approve
                      </button>
                    {/if}
                    {#if getClaimStatus(claim) !== 'denied'}
                      <button
                        type="button"
                        on:click={() => handleClaimStatus(claim, 'denied')}
                        disabled={updatingClaimId === claim.id}
                        class="text-xs font-black uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                      >
                        Deny
                      </button>
                    {/if}
                  </div>
                {/if}
              </td>
            </tr>
          {:else}
            {#if !loading}
              <tr>
                <td colspan="5" class="p-10 text-center text-zinc-500 italic">No claims found yet. Go get some!</td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  </div>
  <div class="max-w-4xl mx-auto mt-12 text-center">
    <button
      type="button"
      on:click={handleSignOut}
      disabled={signingOut}
      class="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] hover:text-white transition-colors disabled:opacity-50"
    >
      {signingOut ? 'Signing out...' : `LOGOUT: ${userEmail || 'ADMIN'}`}
    </button>
  </div>
</div>

<style>
  .logo-delete {
    opacity: 1;
    pointer-events: auto;
    transition: opacity 150ms ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .logo-delete {
      opacity: 0;
      pointer-events: none;
    }

    .logo-wrap:hover .logo-delete,
    .logo-wrap:focus-within .logo-delete {
      opacity: 1;
      pointer-events: auto;
    }
  }

  .loading-dots {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
  }

  .loading-dots .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #71717a;
    animation: dotPulse 1s ease-in-out infinite;
  }

  .loading-dots .dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .loading-dots .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes dotPulse {
    0%,
    100% {
      background-color: #71717a;
      opacity: 0.4;
    }
    50% {
      background-color: #ffffff;
      opacity: 1;
    }
  }
</style>

