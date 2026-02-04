<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import type { Claim, ClaimStatus } from '$lib/claims/types';
  import type { Venue } from '$lib/venues/types';
  import { updateClaimStatus, deleteClaim } from '$lib/claims/repository';

  type Profile = {
    id: string;
    email?: string | null;
    referral_code: string | null;
  };

  type VenueStats = {
    id: string;
    name: string;
    count: number;
    totalAmount: number;
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

  let venueQuery = '';
  let userQuery = '';
  let statusFilter: 'all' | ClaimStatus = 'all';
  let page = 1;
  const pageSize = 50;
  let lastFilterKey = '';

  let selectedUserId: string | null = null;
  let selectedVenueId: string | null = null;
  let invoiceRunStatus: 'idle' | 'running' | 'error' | 'success' = 'idle';
  let invoiceRunError = '';
  let invoiceRunResult: {
    week_start?: string;
    week_end?: string;
    range_start?: string;
    range_end?: string;
    totals?: { venue_id: string; total: number }[];
    results?: {
      venue_id: string;
      ok: boolean;
      error?: string;
      subtotal?: number;
      total?: number;
      amount_due?: number;
      invoice_id?: string;
      line_items?: { amount: number; description: string | null }[];
    }[];
  } | null = null;
  let invoiceRunRaw = '';
  let invoiceBulkStatus: 'idle' | 'running' | 'error' | 'success' = 'idle';
  let invoiceBulkError = '';
  let invoiceBulkResults:
    | {
        venue_id: string;
        ok: boolean;
        error?: string;
        subtotal?: number;
        total?: number;
        amount_due?: number;
        invoice_id?: string;
        invoice_url?: string | null;
        line_items?: { amount: number; description: string | null }[];
        sent?: boolean;
      }[]
    | null = null;
  let invoiceBulkRaw = '';

  const venueById = new Map<string, Venue>();
  const profileById = new Map<string, Profile>();
  let selectedClaimIds = new Set<string>();
  let bulkApplying = false;

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
      .select('*')
      .order('purchased_at', { ascending: false })
      .limit(1000);

    if (error) throw error;
    claims = data ?? [];
  }

  async function fetchVenues() {
    const { data, error } = await supabase
      .from('venues')
      .select('id,name,logo_url,kickback_guest,kickback_referrer,payment_methods,square_public,active,created_by')
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
      .select('id,referral_code')
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
    const refCode = submitter?.referral_code?.toLowerCase() ?? '';
    const claimRefCode = (claim.submitter_referral_code ?? '').toLowerCase();
    const submitterId = claim.submitter_id?.toLowerCase() ?? '';
    return refCode.includes(query) || claimRefCode.includes(query) || submitterId.includes(query);
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

  function formatYmdLocal(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getClaimStatus(claim: Claim): ClaimStatus {
    return claim.status ?? 'approved';
  }

  function getStatusClass(status: ClaimStatus) {
    if (status === 'approved') return 'border-green-500/30 bg-green-500/10 text-green-300';
    if (status === 'paid') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
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

  function toggleSelect(id: string | null | undefined) {
    if (!id) return;
    const next = new Set(selectedClaimIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedClaimIds = next;
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

  function canDeleteClaim(claim: Claim): boolean {
    return getClaimStatus(claim) !== 'paid';
  }

  async function handleDeleteClaim(claim: Claim) {
    if (!claim.id) return;
    if (!canDeleteClaim(claim)) return;
    const confirmed = window.confirm('Delete this claim? This cannot be undone.');
    if (!confirmed) return;
    try {
      await deleteClaim(claim.id);
      claims = claims.filter((c) => c.id !== claim.id);
      if (claim.id) {
        const next = new Set(selectedClaimIds);
        next.delete(claim.id);
        selectedClaimIds = next;
      }
      buildMaps();
    } catch (error) {
      console.error('Error deleting claim:', error);
      alert('Failed to delete claim');
    }
  }
  async function runWeeklyInvoices() {
    invoiceRunStatus = 'running';
    invoiceRunError = '';
    invoiceRunResult = null;
    invoiceRunRaw = '';
    try {
      const response = await fetch('/api/stripe/weekly-invoices', { method: 'POST' });
      const payload = await response.json().catch(() => null);
      invoiceRunRaw = payload ? JSON.stringify(payload, null, 2) : '';
      if (!response.ok) {
        invoiceRunStatus = 'error';
        invoiceRunError = payload?.error ?? 'Invoice run failed.';
        return;
      }
      invoiceRunStatus = 'success';
      invoiceRunResult = payload;
    } catch (error) {
      invoiceRunStatus = 'error';
      invoiceRunError = error instanceof Error ? error.message : 'Invoice run failed.';
    }
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

  async function deleteSelectedUser() {
    if (!selectedUserId) return;
    const confirmed = window.confirm('Delete this user? This cannot be undone.');
    if (!confirmed) return;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) {
        alert('Session expired. Please sign in again.');
        return;
      }
      const response = await fetch('/api/ops/delete/user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`
        },
        body: JSON.stringify({ user_id: selectedUserId })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        alert(payload?.error ?? 'Failed to delete user');
        return;
      }
      selectedUserId = null;
      await loadAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete user');
    }
  }

  async function deleteSelectedVenue() {
    if (!selectedVenueId) return;
    const confirmed = window.confirm('Delete this venue? This cannot be undone.');
    if (!confirmed) return;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) {
        alert('Session expired. Please sign in again.');
        return;
      }
      const response = await fetch('/api/ops/delete/venue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`
        },
        body: JSON.stringify({ venue_id: selectedVenueId })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        alert(payload?.error ?? 'Failed to delete venue');
        return;
      }
      selectedVenueId = null;
      await loadAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete venue');
    }
  }

  function getWeekStart(date: Date): Date {
    const start = new Date(date);
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function formatWeekLabel(weekStart: Date): string {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const startLabel = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endLabel = weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${startLabel} - ${endLabel}`;
  }

  function groupClaimsByWeek(claimList: Claim[]): { weekStart: Date; label: string; claims: Claim[] }[] {
    const groups = new Map<string, { weekStart: Date; label: string; claims: Claim[] }>();
    for (const claim of claimList) {
      const purchasedAt = new Date(claim.purchased_at);
      if (Number.isNaN(purchasedAt.getTime())) continue;
      const weekStart = getWeekStart(purchasedAt);
      const key = weekStart.toISOString().slice(0, 10);
      const existing = groups.get(key);
      if (existing) {
        existing.claims.push(claim);
      } else {
        groups.set(key, { weekStart, label: formatWeekLabel(weekStart), claims: [claim] });
      }
    }
    return Array.from(groups.values()).sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());
  }

  function getWeekSelectableIds(weekClaims: Claim[]): string[] {
    return weekClaims.map((claim) => claim.id).filter(Boolean) as string[];
  }

  function isWeekSelected(weekClaims: Claim[], selectedIds: Set<string>): boolean {
    const ids = getWeekSelectableIds(weekClaims);
    return ids.length > 0 && ids.every((id) => selectedIds.has(id));
  }

  function toggleWeekSelection(weekClaims: Claim[]) {
    const ids = getWeekSelectableIds(weekClaims);
    if (ids.length === 0) return;
    const allSelected = ids.every((id) => selectedClaimIds.has(id));
    const next = new Set(selectedClaimIds);
    for (const id of ids) {
      if (allSelected) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }
    selectedClaimIds = next;
  }

  function getSelectableClaimIds(): string[] {
    return pagedClaims.map((claim) => claim.id).filter(Boolean) as string[];
  }

  function toggleSelectAllClaims() {
    const ids = getSelectableClaimIds();
    if (ids.length === 0) return;
    const allSelected = ids.every((id) => selectedClaimIds.has(id));
    const next = new Set(selectedClaimIds);
    for (const id of ids) {
      if (allSelected) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }
    selectedClaimIds = next;
  }

  function getSelectedWeekRange(): { start: string; end: string } | null {
    const groups = groupClaimsByWeek(filteredClaims);
    const fullySelectedGroups = groups.filter((group) => {
      const ids = group.claims.map((c) => c.id).filter(Boolean) as string[];
      if (ids.length === 0) return false;
      const allInGroupSelected = ids.every((id) => selectedClaimIds.has(id));
      const onlyGroupSelected = Array.from(selectedClaimIds).every((id) => ids.includes(id));
      return allInGroupSelected && onlyGroupSelected;
    });
    if (fullySelectedGroups.length !== 1) return null;
    const { weekStart } = fullySelectedGroups[0];
    const start = formatYmdLocal(weekStart);
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);
    const end = formatYmdLocal(endDate);
    return { start, end };
  }

  async function applyBulkStatus(status: ClaimStatus) {
    if (selectedClaimIds.size === 0) return;
    bulkApplying = true;
    try {
      const ids = Array.from(selectedClaimIds);
      for (const id of ids) {
        await updateClaimStatus(id, status);
        claims = claims.map((claim) => (claim.id === id ? { ...claim, status } : claim));
      }
      selectedClaimIds = new Set();
    } catch (error) {
    } finally {
      bulkApplying = false;
    }
  }

  async function deleteSelectedClaims() {
    if (selectedClaimIds.size === 0) return;
    bulkApplying = true;
    try {
      const ids = Array.from(selectedClaimIds);
      const deletableIds = ids.filter((id) => {
        const claim = claims.find((c) => c.id === id);
        return claim && canDeleteClaim(claim);
      });
      if (deletableIds.length === 0) {
        alert('No deletable claims selected');
        return;
      }
      const confirmed = window.confirm(
        `Delete ${deletableIds.length} selected claim(s)? This cannot be undone.`
      );
      if (!confirmed) return;
      for (const id of deletableIds) {
        await deleteClaim(id);
      }
      claims = claims.filter((c) => !deletableIds.includes(c.id ?? ''));
      selectedClaimIds = new Set();
      buildMaps();
    } catch (error) {
      alert('Failed to delete selected claims');
    } finally {
      bulkApplying = false;
    }
  }

  async function createBulkInvoices() {
    if (selectedClaimIds.size === 0) return;
    invoiceBulkStatus = 'running';
    invoiceBulkError = '';
    invoiceBulkResults = null;
    invoiceBulkRaw = '';
    try {
      const claimIds = Array.from(
        new Set(
          claims
            .filter((c) => c.id && selectedClaimIds.has(c.id))
            .map((c) => c.id as string)
        )
      );
      if (claimIds.length === 0) {
        invoiceBulkStatus = 'error';
        invoiceBulkError = 'No claims found for selection';
        return;
      }
      const selectedTimes = claims
        .filter((c) => c.id && selectedClaimIds.has(c.id))
        .map((c) => new Date(c.purchased_at))
        .filter((d) => !Number.isNaN(d.getTime()));
      const weekRange = getSelectedWeekRange();
      const rangeStart = weekRange?.start;
      const rangeEnd = weekRange?.end;
      if (!rangeStart || !rangeEnd) {
        invoiceBulkStatus = 'error';
        invoiceBulkError = 'Select exactly one full week to generate invoices';
        return;
      }
      const response = await fetch('/api/stripe/invoices/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_ids: claimIds, range_start: rangeStart, range_end: rangeEnd })
      });
      const payload = await response.json().catch(() => null);
      invoiceBulkRaw = payload ? JSON.stringify(payload, null, 2) : '';
      if (!response.ok) {
        invoiceBulkStatus = 'error';
        invoiceBulkError = payload?.error ?? 'Bulk invoice creation failed.';
        return;
      }
      invoiceBulkStatus = 'success';
      invoiceBulkResults = payload?.results ?? [];
    } catch (error) {
      invoiceBulkStatus = 'error';
      invoiceBulkError = error instanceof Error ? error.message : 'Bulk invoice creation failed.';
    }
  }

  async function sendInvoice(invoiceId: string | undefined) {
    if (!invoiceId) return;
    try {
      const response = await fetch('/api/stripe/invoices/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        alert(payload?.error ?? 'Failed to send invoice');
        return;
      }
      if (invoiceBulkResults) {
        invoiceBulkResults = invoiceBulkResults.map((r) =>
          r.invoice_id === invoiceId ? { ...r, sent: true } : r
        );
      }
    } catch {
      alert('Failed to send invoice');
    }
  }
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
          on:click={runWeeklyInvoices}
          class="bg-orange-500 text-black font-black px-4 py-2 rounded-xl uppercase tracking-tight text-xs"
          disabled={invoiceRunStatus === 'running'}
        >
          {invoiceRunStatus === 'running' ? 'Running...' : 'Run Weekly Invoices'}
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
        {#if invoiceRunError}
          <span class="text-xs font-bold uppercase tracking-widest text-red-400">{invoiceRunError}</span>
        {/if}
      </div>
      {#if invoiceRunResult}
        <div class="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-[10px] uppercase tracking-widest text-zinc-400">
          <div>
            Week: {invoiceRunResult.week_start ?? 'n/a'} - {invoiceRunResult.week_end ?? 'n/a'}
          </div>
          <div class="mt-2 text-zinc-500">
            Range: {invoiceRunResult.range_start ?? 'n/a'} → {invoiceRunResult.range_end ?? 'n/a'}
          </div>
          <div class="mt-2 text-zinc-500">
            Results: {invoiceRunResult.results?.length ?? 0}
          </div>
          {#if invoiceRunResult.totals && invoiceRunResult.totals.length > 0}
            <div class="mt-3 text-[10px] text-zinc-400 normal-case tracking-normal">
              <p class="uppercase tracking-widest text-zinc-500">Totals</p>
              {#each invoiceRunResult.totals as total}
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate">
                    {venueById.get(total.venue_id)?.name ?? total.venue_id}
                  </span>
                  <span>${total.total.toFixed(2)}</span>
                </div>
              {/each}
            </div>
          {/if}
          {#if invoiceRunResult.results && invoiceRunResult.results.length > 0}
            <div class="mt-3 space-y-1 text-[10px] text-zinc-300 normal-case tracking-normal">
              {#each invoiceRunResult.results as result}
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate">
                    {venueById.get(result.venue_id)?.name ?? result.venue_id}
                  </span>
                  <span class={result.ok ? 'text-green-400' : 'text-red-400'}>
                    {result.ok ? `sent ($${(result.amount_due ?? 0).toFixed(2)})` : result.error ?? 'skipped'}
                  </span>
                </div>
                {#if result.ok && result.line_items && result.line_items.length > 0}
                  <div class="ml-3 text-[10px] text-zinc-500">
                    {#each result.line_items as line}
                      <div class="flex items-center justify-between gap-2">
                        <span class="truncate">{line.description ?? 'Line item'}</span>
                        <span>${line.amount.toFixed(2)}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
          {#if invoiceRunRaw}
            <pre class="mt-4 whitespace-pre-wrap break-words text-[10px] text-zinc-500 normal-case tracking-normal">{invoiceRunRaw}</pre>
          {/if}
        </div>
      {/if}
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
              <tr>
                <td colspan="5" class="px-4 py-3">
                  <div class="flex items-center justify-between">
                    <div class="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Selected: {selectedClaimIds.size}
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        class="px-3 py-1 rounded-lg bg-zinc-700 text-white text-xs font-black uppercase tracking-widest"
                        on:click={toggleSelectAllClaims}
                      >
                        {getSelectableClaimIds().every((id) => selectedClaimIds.has(id)) ? 'Clear Page' : 'Select Page'}
                      </button>
                      {#if selectedClaimIds.size > 0}
                        <button
                          type="button"
                          class="px-3 py-1 rounded-lg bg-green-500 text-black text-xs font-black uppercase tracking-widest disabled:opacity-50"
                          on:click={() => applyBulkStatus('approved')}
                          disabled={bulkApplying}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          class="px-3 py-1 rounded-lg bg-zinc-700 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50"
                          on:click={() => applyBulkStatus('pending')}
                          disabled={bulkApplying}
                        >
                          Pending
                        </button>
                        <button
                          type="button"
                          class="px-3 py-1 rounded-lg bg-red-500 text-black text-xs font-black uppercase tracking-widest disabled:opacity-50"
                          on:click={() => applyBulkStatus('denied')}
                          disabled={bulkApplying}
                        >
                          Deny
                        </button>
                        {#if getSelectedWeekRange()}
                          <button
                            type="button"
                            class="px-3 py-1 rounded-lg bg-blue-500 text-black text-xs font-black uppercase tracking-widest disabled:opacity-50"
                            on:click={createBulkInvoices}
                            disabled={invoiceBulkStatus === 'running'}
                            title="Generate Stripe invoice drafts for selected week"
                          >
                            {invoiceBulkStatus === 'running' ? 'Generating...' : 'Generate Invoices'}
                          </button>
                        {/if}
                        <button
                          type="button"
                          class="px-3 py-1 rounded-lg border border-zinc-800 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                          on:click={deleteSelectedClaims}
                          disabled={bulkApplying}
                          title="Delete selected claims (paid claims are not deletable)"
                        >
                          Delete
                        </button>
                      {/if}
                    </div>
                  </div>
                </td>
              </tr>
              {#if loading}
                <tr>
                  <td colspan="5" class="px-4 py-6 text-sm text-zinc-500">Loading...</td>
                </tr>
              {:else if filteredClaims.length === 0}
                <tr>
                  <td colspan="5" class="px-4 py-6 text-sm text-zinc-500">No claims found.</td>
                </tr>
              {:else}
                {#each groupClaimsByWeek(pagedClaims) as weekGroup}
                  <tr class="bg-zinc-950/60 text-zinc-400 text-[10px] uppercase tracking-[0.3em]">
                    <td colspan="5" class="px-4 py-3 font-black">
                      <div class="flex items-center gap-3">
                        <input
                          type="checkbox"
                          aria-label={`Select week ${weekGroup.label}`}
                          checked={isWeekSelected(weekGroup.claims, selectedClaimIds)}
                          on:change={() => toggleWeekSelection(weekGroup.claims)}
                          class="h-3.5 w-3.5 accent-blue-500"
                        />
                        <span>{weekGroup.label}</span>
                      </div>
                    </td>
                  </tr>
                  {#each weekGroup.claims as claim}
                    <tr class="hover:bg-zinc-800/30 transition-colors">
                      <td class="px-4 py-3 text-sm text-zinc-300">
                        <div class="flex items-center gap-3">
                          <input
                            type="checkbox"
                            aria-label={`Select claim ${claim.id}`}
                            checked={selectedClaimIds.has(claim.id ?? '')}
                            on:change={() => toggleSelect(claim.id)}
                            class="h-3.5 w-3.5 accent-blue-500"
                          />
                          <span>{formatDate(claim.purchased_at)}</span>
                        </div>
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
                          {claim.submitter_referral_code ?? profileById.get(claim.submitter_id ?? '')?.referral_code ?? 'Unknown'}
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
              <button
                type="button"
                class="px-3 py-1 rounded-lg bg-red-500 text-black text-xs font-black uppercase tracking-widest"
                on:click={deleteSelectedUser}
              >
                Delete User
              </button>
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
        {#if invoiceBulkResults}
          <section class="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
            <p class="text-xs font-black uppercase tracking-widest text-zinc-500">Bulk Invoice Drafts</p>
            <div class="mt-3 space-y-1 text-[10px] text-zinc-300 normal-case tracking-normal">
              {#each invoiceBulkResults as result}
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate">
                    {venueById.get(result.venue_id)?.name ?? result.venue_id}
                  </span>
                  <span class={result.ok ? 'text-white' : 'text-red-400'}>
                    {#if result.ok}{`$${(result.amount_due ?? 0).toFixed(2)}`}{:else}{result.error ?? 'skipped'}{/if}
                  </span>
                </div>
                {#if result.ok && result.line_items && result.line_items.length > 0}
                  <div class="ml-3 text-[10px] text-zinc-500">
                    {#each result.line_items as line}
                      <div class="flex items-center justify-between gap-2">
                        <span class="truncate">{line.description ?? 'Line item'}</span>
                        <span>${line.amount.toFixed(2)}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
                {#if result.ok && !result.sent}
                  <div class="ml-3 mt-2">
                    <button
                      type="button"
                      class="px-3 py-1 rounded-lg bg-orange-500 text-black text-xs font-black uppercase tracking-widest"
                      on:click={() => sendInvoice(result.invoice_id)}
                    >
                      Send Invoice
                    </button>
                    {#if result.invoice_url}
                      <a
                        href={result.invoice_url}
                        target="_blank"
                        rel="noreferrer"
                        class="ml-3 text-orange-400 underline underline-offset-2"
                      >
                        View
                      </a>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
            {#if invoiceBulkError}
              <p class="mt-3 text-[10px] font-bold uppercase tracking-widest text-red-400">{invoiceBulkError}</p>
            {/if}
          </section>
        {/if}

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
            <div class="mt-4">
              <button
                type="button"
                class="px-3 py-1 rounded-lg bg-red-500 text-black text-xs font-black uppercase tracking-widest"
                on:click={deleteSelectedVenue}
              >
                Delete Venue
              </button>
            </div>
          {:else}
            <p class="text-sm text-zinc-500 mt-3">Select a venue to see details.</p>
          {/if}
        </section>

      </div>
    </section>
  </div>
</main>
