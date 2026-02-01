<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import type { Claim, ClaimStatus } from '$lib/claims/types';
  import type { Venue } from '$lib/venues/types';

  type Profile = {
    id: string;
    email: string | null;
    referral_code: string | null;
  };

  type VenueStats = {
    id: string;
    name: string;
    count: number;
    totalAmount: number;
  };

  type ZeptoAgreement = {
    uid: string;
    venue_id: string | null;
    state: string | null;
    last_event_type: string | null;
    updated_at: string | null;
  };

  type UserStats = {
    id: string;
    email: string | null;
    referralCode: string | null;
  };

  let loading = true;
  let loadError = '';

  let claims: Claim[] = [];
  let venues: Venue[] = [];
  let profiles: Profile[] = [];
  let squareConnections = new Map<string, string>();
  let zeptoAgreements: ZeptoAgreement[] = [];

  let venueQuery = '';
  let userQuery = '';
  let statusFilter: 'all' | ClaimStatus = 'all';
  let page = 1;
  const pageSize = 50;
  let lastFilterKey = '';

  let selectedUserId: string | null = null;
  let selectedVenueId: string | null = null;

  const venueById = new Map<string, Venue>();
  const profileById = new Map<string, Profile>();

  function buildMaps() {
    venueById.clear();
    for (const venue of venues) {
      venueById.set(venue.id, venue);
    }
    profileById.clear();
    for (const profile of profiles) {
      profileById.set(profile.id, profile);
    }
  }

  async function fetchClaims() {
    const { data, error } = await supabase
      .from('claims')
      .select(
        'id,venue,venue_id,referrer,referrer_id,amount,kickback_guest_rate,kickback_referrer_rate,status,purchased_at,created_at,last_4,submitter_id'
      )
      .order('purchased_at', { ascending: false })
      .limit(1000);

    if (error) throw error;
    claims = data ?? [];
  }

  async function fetchVenues() {
    const { data, error } = await supabase
      .from('venues')
      .select('id,name,logo_url,kickback_guest,kickback_referrer,payment_methods,active,created_by')
      .order('name', { ascending: true });
    if (error) throw error;
    venues = data ?? [];
  }

  async function fetchProfiles() {
    const ids = Array.from(
      new Set(
        claims
          .flatMap((claim) => [claim.submitter_id, claim.referrer_id])
          .filter((id): id is string => Boolean(id))
      )
    );
    if (ids.length === 0) {
      profiles = [];
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,referral_code')
      .in('id', ids);
    if (error) throw error;
    profiles = data ?? [];
  }

  async function fetchSquareConnections() {
    const { data, error } = await supabase
      .from('square_connections')
      .select('venue_id,merchant_id');
    if (error) throw error;
    squareConnections = new Map((data ?? []).map((row) => [row.venue_id, row.merchant_id ?? '']));
  }

  async function fetchZeptoAgreements() {
    const { data, error } = await supabase
      .from('zepto_payto_agreements')
      .select('uid,venue_id,state,last_event_type,updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    zeptoAgreements = data ?? [];
  }

  async function loadAll() {
    loading = true;
    loadError = '';
    const errors: string[] = [];
    try {
      try {
        await fetchClaims();
      } catch (error) {
        console.error('Claims fetch failed:', error);
        errors.push(error instanceof Error ? error.message : 'Claims fetch failed.');
      }
      try {
        await fetchVenues();
      } catch (error) {
        console.error('Venues fetch failed:', error);
        errors.push(error instanceof Error ? error.message : 'Venues fetch failed.');
      }
      try {
        await fetchProfiles();
      } catch (error) {
        console.error('Profiles fetch failed:', error);
        errors.push(error instanceof Error ? error.message : 'Profiles fetch failed.');
      }
      try {
        await fetchSquareConnections();
      } catch (error) {
        console.error('Square connection fetch failed:', error);
        squareConnections = new Map();
      }
      try {
        await fetchZeptoAgreements();
      } catch (error) {
        console.error('Zepto agreements fetch failed:', error);
        zeptoAgreements = [];
      }
      buildMaps();
      if (errors.length > 0) {
        loadError = errors.join(' | ');
      }
    } finally {
      loading = false;
    }
  }

  function matchesVenue(claim: Claim): boolean {
    if (!venueQuery.trim()) return true;
    const query = venueQuery.trim().toLowerCase();
    const venueName = claim.venue?.toLowerCase() ?? '';
    const venueId = claim.venue_id ?? '';
    return venueName.includes(query) || venueId.toLowerCase().includes(query);
  }

  function matchesUser(claim: Claim): boolean {
    if (!userQuery.trim()) return true;
    const query = userQuery.trim().toLowerCase();
    const submitter = claim.submitter_id ? profileById.get(claim.submitter_id) : null;
    const email = submitter?.email?.toLowerCase() ?? '';
    const refCode = submitter?.referral_code?.toLowerCase() ?? '';
    const submitterId = claim.submitter_id?.toLowerCase() ?? '';
    return email.includes(query) || refCode.includes(query) || submitterId.includes(query);
  }

  function matchesStatus(claim: Claim): boolean {
    if (statusFilter === 'all') return true;
    return (claim.status ?? 'approved') === statusFilter;
  }

  function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  function getClaimStatus(claim: Claim): ClaimStatus {
    return claim.status ?? 'approved';
  }

  function getStatusClass(status: ClaimStatus) {
    if (status === 'approved') return 'border-green-500/30 bg-green-500/10 text-green-300';
    if (status === 'denied') return 'border-red-500/30 bg-red-500/10 text-red-300';
    return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300';
  }

  function selectUser(userId: string | null) {
    selectedUserId = userId;
  }

  function selectVenue(venueId: string | null, venueName?: string | null) {
    if (venueId) {
      selectedVenueId = venueId;
      return;
    }
    if (venueName) {
      const normalized = venueName.trim().toLowerCase();
      const match = venues.find((venue) => venue.name.trim().toLowerCase() === normalized);
      selectedVenueId = match?.id ?? null;
      return;
    }
    selectedVenueId = null;
  }

  function exportClaimsCsv() {
    const headers = ['purchased_at', 'venue', 'venue_id', 'user_email', 'user_id', 'amount', 'status', 'last_4'];
    const rows = filteredClaims.map((claim) => {
      const profile = claim.submitter_id ? profileById.get(claim.submitter_id) : null;
      return [
        claim.purchased_at,
        claim.venue,
        claim.venue_id ?? '',
        profile?.email ?? '',
        claim.submitter_id ?? '',
        Number(claim.amount ?? 0).toFixed(2),
        getClaimStatus(claim),
        claim.last_4 ?? ''
      ];
    });
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kickback-claims-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function buildVenueStats(list: Claim[]): VenueStats[] {
    const totals = new Map<string, VenueStats>();
    for (const claim of list) {
      const id = claim.venue_id ?? claim.venue ?? 'unknown';
      const name = claim.venue_id ? venueById.get(claim.venue_id)?.name ?? claim.venue : claim.venue;
      const entry = totals.get(id) ?? { id, name, count: 0, totalAmount: 0 };
      entry.count += 1;
      entry.totalAmount += Number(claim.amount ?? 0);
      totals.set(id, entry);
    }
    return Array.from(totals.values()).sort((a, b) => b.count - a.count);
  }

  function buildUserStats(list: Claim[]): UserStats | null {
    if (!selectedUserId) return null;
    const profile = profileById.get(selectedUserId);
    return {
      id: selectedUserId,
      email: profile?.email ?? null,
      referralCode: profile?.referral_code ?? null
    };
  }

  $: filteredClaims = claims.filter((claim) =>
    matchesVenue(claim) && matchesUser(claim) && matchesStatus(claim)
  );
  $: totalPages = Math.max(1, Math.ceil(filteredClaims.length / pageSize));
  $: if (page > totalPages) page = totalPages;
  $: pagedClaims = filteredClaims.slice((page - 1) * pageSize, page * pageSize);
  $: {
    const nextKey = `${venueQuery.trim()}|${userQuery.trim()}|${statusFilter}`;
    if (nextKey !== lastFilterKey) {
      lastFilterKey = nextKey;
      page = 1;
    }
  }

  $: selectedUserClaims = selectedUserId
    ? claims.filter((claim) => claim.submitter_id === selectedUserId)
    : [];
  $: selectedUserReferralClaims = selectedUserId
    ? claims.filter((claim) => claim.referrer_id === selectedUserId)
    : [];
  $: selectedVenueClaims = selectedVenueId
    ? claims.filter((claim) => claim.venue_id === selectedVenueId)
    : [];

  $: selectedUserStats = buildUserStats(selectedUserClaims);
  $: selectedUserVenues = buildVenueStats(selectedUserClaims);
  $: selectedUserRefVenues = buildVenueStats(selectedUserReferralClaims);

  $: selectedVenue = selectedVenueId ? venueById.get(selectedVenueId) ?? null : null;

  onMount(loadAll);
</script>

<main class="min-h-screen bg-zinc-950 text-white p-6 md:p-10">
  <div class="max-w-6xl mx-auto space-y-6">
    <header class="flex flex-col gap-2">
      <p class="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-black">Ops Console</p>
      <h1 class="text-3xl md:text-4xl font-black uppercase tracking-tight">All Claims</h1>
    </header>

    <section class="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 md:p-6">
      <div class="grid gap-4 md:grid-cols-3">
        <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
          Venue Filter
          <input
            type="text"
            bind:value={venueQuery}
            placeholder="Venue name or id"
            class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
          />
        </label>
        <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
          User Filter
          <input
            type="text"
            bind:value={userQuery}
            placeholder="Email, referral, or user id"
            class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
          />
        </label>
        <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
          Status
          <select
            bind:value={statusFilter}
            class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
          >
            <option value="all">all</option>
            <option value="approved">approved</option>
            <option value="pending">pending</option>
            <option value="denied">denied</option>
          </select>
        </label>
      </div>
      <div class="mt-4 flex items-center gap-3">
        <button
          type="button"
          on:click={loadAll}
          class="bg-white text-black font-black px-4 py-2 rounded-xl uppercase tracking-tight text-xs"
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button
          type="button"
          on:click={exportClaimsCsv}
          class="bg-zinc-800 text-white font-black px-4 py-2 rounded-xl uppercase tracking-tight text-xs"
        >
          Export CSV
        </button>
        {#if loadError}
          <span class="text-xs font-bold uppercase tracking-widest text-red-400">{loadError}</span>
        {/if}
      </div>
    </section>

    <section class="grid gap-6 lg:grid-cols-[2.2fr_1fr]">
      <div class="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
        <div class="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <p class="text-xs font-black uppercase tracking-widest text-zinc-500">
            {filteredClaims.length} claims
          </p>
          <div class="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">
            <button
              type="button"
              on:click={() => (page = Math.max(1, page - 1))}
              disabled={page === 1}
              class="px-2 py-1 rounded-lg border border-zinc-800 disabled:opacity-40"
            >
              Prev
            </button>
            <span>Page {page} / {totalPages}</span>
            <button
              type="button"
              on:click={() => (page = Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              class="px-2 py-1 rounded-lg border border-zinc-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-[760px] w-full text-left border-collapse">
            <thead>
              <tr class="bg-zinc-900/80 text-zinc-400 text-xs uppercase">
                <th class="px-4 py-3 font-semibold">Date</th>
                <th class="px-4 py-3 font-semibold">Venue</th>
                <th class="px-4 py-3 font-semibold">User</th>
                <th class="px-4 py-3 font-semibold text-right">Amount</th>
                <th class="px-4 py-3 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-800">
              {#if loading}
                <tr>
                  <td colspan="5" class="px-4 py-6 text-sm text-zinc-500">Loading...</td>
                </tr>
              {:else if filteredClaims.length === 0}
                <tr>
                  <td colspan="5" class="px-4 py-6 text-sm text-zinc-500">No claims found.</td>
                </tr>
              {:else}
                {#each pagedClaims as claim}
                  <tr class="hover:bg-zinc-800/30 transition-colors">
                    <td class="px-4 py-3 text-sm text-zinc-300">
                      {formatDate(claim.purchased_at)}
                    </td>
                    <td class="px-4 py-3 text-sm text-zinc-200">
                      <button
                        type="button"
                        on:click={() => selectVenue(claim.venue_id ?? null, claim.venue)}
                        class="hover:text-white transition-colors"
                      >
                        {claim.venue}
                      </button>
                    </td>
                    <td class="px-4 py-3 text-sm text-zinc-200">
                      <button
                        type="button"
                        on:click={() => selectUser(claim.submitter_id)}
                        class="hover:text-white transition-colors"
                      >
                        {profileById.get(claim.submitter_id ?? '')?.referral_code ?? 'Unknown'}
                      </button>
                    </td>
                    <td class="px-4 py-3 text-sm text-right font-mono text-orange-300">
                      ${Number(claim.amount ?? 0).toFixed(2)}
                    </td>
                    <td class="px-4 py-3 text-right">
                      <span class={`inline-flex items-center border rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${getStatusClass(getClaimStatus(claim))}`}>
                        {getClaimStatus(claim)}
                      </span>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      </div>

      <div class="space-y-6">
        <section class="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
          <p class="text-xs font-black uppercase tracking-widest text-zinc-500">User Detail</p>
          {#if selectedUserStats}
            <div class="mt-4 space-y-2 text-sm text-zinc-300">
              <div>Email: <span class="text-white">{selectedUserStats.email ?? 'Unknown'}</span></div>
              <div>Referral Code: <span class="text-white">{selectedUserStats.referralCode ?? 'None'}</span></div>
              <div>User ID: <span class="text-white">{selectedUserStats.id}</span></div>
            </div>
            <div class="mt-4">
              <p class="text-[10px] font-black uppercase tracking-widest text-zinc-500">Claims by Venue</p>
              <div class="mt-2 space-y-1 text-xs text-zinc-300">
                {#each selectedUserVenues as item}
                  <div class="flex justify-between">
                    <span class="truncate">{item.name}</span>
                    <span>{item.count} (${item.totalAmount.toFixed(2)})</span>
                  </div>
                {/each}
                {#if selectedUserVenues.length === 0}
                  <p class="text-zinc-500">No claims.</p>
                {/if}
              </div>
            </div>
            <div class="mt-4">
              <p class="text-[10px] font-black uppercase tracking-widest text-zinc-500">Referred Claims</p>
              <div class="mt-2 space-y-1 text-xs text-zinc-300">
                {#each selectedUserRefVenues as item}
                  <div class="flex justify-between">
                    <span class="truncate">{item.name}</span>
                    <span>{item.count} (${item.totalAmount.toFixed(2)})</span>
                  </div>
                {/each}
                {#if selectedUserRefVenues.length === 0}
                  <p class="text-zinc-500">No referred claims.</p>
                {/if}
              </div>
            </div>
          {:else}
            <p class="text-sm text-zinc-500 mt-3">Select a user to see details.</p>
          {/if}
        </section>

        <section class="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
          <p class="text-xs font-black uppercase tracking-widest text-zinc-500">Venue Detail</p>
          {#if selectedVenue}
            <div class="mt-4 flex items-center gap-3">
              {#if selectedVenue.logo_url}
                <img src={selectedVenue.logo_url} alt={selectedVenue.name} class="w-12 h-12 rounded-xl object-cover" />
              {/if}
              <div>
                <p class="text-lg font-bold text-white">{selectedVenue.name}</p>
                <p class="text-xs text-zinc-400">{selectedVenue.id}</p>
              </div>
            </div>
            <div class="mt-4 space-y-2 text-sm text-zinc-300">
              <div>
                Rates: <span class="text-white">{selectedVenue.kickback_guest ?? 0}% guest</span> /{' '}
                <span class="text-white">{selectedVenue.kickback_referrer ?? 0}% referrer</span>
              </div>
              <div>
                Payment Methods:{' '}
                <span class="text-white">{selectedVenue.payment_methods?.join(', ') || 'None'}</span>
              </div>
              <div>
                Square Connection:{' '}
                <span class="text-white">
                  {squareConnections.has(selectedVenue.id) ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <div>
                Claims:{' '}
                <span class="text-white">
                  {selectedVenueClaims.length} (${selectedVenueClaims.reduce((sum, claim) => sum + Number(claim.amount ?? 0), 0).toFixed(2)})
                </span>
              </div>
            </div>
          {:else}
            <p class="text-sm text-zinc-500 mt-3">Select a venue to see details.</p>
          {/if}
        </section>

        <section class="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
          <p class="text-xs font-black uppercase tracking-widest text-zinc-500">Recent Zepto Agreements</p>
          <div class="mt-3 space-y-3 text-xs text-zinc-300">
            {#if zeptoAgreements.length === 0}
              <p class="text-zinc-500">No agreements loaded.</p>
            {:else}
              {#each zeptoAgreements as agreement}
                <div class="border border-zinc-800 rounded-xl p-3 bg-zinc-950/60">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-zinc-400">{agreement.uid}</span>
                    <span class="uppercase tracking-widest text-[10px]">{agreement.state ?? 'unknown'}</span>
                  </div>
                  <div class="mt-2 text-[10px] uppercase tracking-widest text-zinc-500">
                    {venueById.get(agreement.venue_id ?? '')?.name ?? agreement.venue_id ?? 'Unknown venue'}
                  </div>
                  <div class="mt-1 text-[10px] text-zinc-600">
                    {agreement.last_event_type ?? 'No webhook yet'} · {agreement.updated_at ? formatDate(agreement.updated_at) : '—'}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </section>
      </div>
    </section>
  </div>
</main>
