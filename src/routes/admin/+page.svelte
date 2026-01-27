<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { slide } from 'svelte/transition';
  import { replaceState } from '$app/navigation';
  import { supabase } from '$lib/supabase';
  import { fetchClaimsForVenueId, updateClaimStatus, updateClaimWithSquareMatch } from '$lib/claims/repository';
  import { calculateKickbackWithRate, calculateTotalAmount } from '$lib/claims/utils';
  import type { Claim, ClaimStatus } from '$lib/claims/types';
  import type { Venue } from '$lib/venues/types';
  import { buildVenueBase, generateVenueCode } from '$lib/venues/code';
  import { dev } from '$app/environment';
  import { PUBLIC_SQUARE_APP_ID_PROD, PUBLIC_SQUARE_APP_ID_SANDBOX } from '$env/static/public';

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
  let showRatesTip = false;
  let ratesTipTimer: ReturnType<typeof setTimeout> | null = null;
  let csvFileName = '';
  let csvSourceText = '';
  let csvParsedCount = 0;
  let csvMatches: { claimId: string; transactionId: string; amount: number; last4: string; time: Date }[] = [];
  let csvUnmatchedCount = 0;
  let csvUnmatchedClaimIds: string[] = [];
  let csvError = '';
  let csvApproving = false;
  let csvDenying = false;
  let pendingMatchCount = 0;
  let pendingDenyCount = 0;
  let csvApprovedClaimIds: string[] = [];
  let csvDeniedClaimIds: string[] = [];
  let squareChecking = false;
  let squareMatches: {
    claimId: string;
    paymentId: string;
    fingerprint: string;
    amount: number;
    last4: string;
    time: Date;
    locationId?: string | null;
  }[] = [];
  let squareUnmatchedClaimIds: string[] = [];
  let squareError = '';
  let squareApproving = false;
  let squareDenying = false;
  let squareApprovedClaimIds: string[] = [];
  let squareDeniedClaimIds: string[] = [];
  let squarePendingMatchCount = 0;
  let squarePendingDenyCount = 0;
  let squareCheckedRange = '';
  let selectedClaimIds = new Set<string>();
  let bulkApplying = false;
  let claimsScrollEl: HTMLDivElement | null = null;
  let showClaimsScrollFade = false;
  let showClaimsScrollLeftFade = false;
  let squareBanner: { type: 'success' | 'error'; message: string } | null = null;
  let squareConnected = false;
  let squareMerchantId = '';
  let squareSyncing = false;
  let squareLocations: { id: string; name: string; status?: string }[] = [];
  let squareLocationIds = new Set<string>();
  let squareLocationsLoading = false;
  let squareLocationsSaving = false;
  let squareLocationsError = '';
  let squareLocationsLoaded = false;
  const SQUARE_SCOPES = 'ORDERS_READ PAYMENTS_READ MERCHANT_PROFILE_READ';
  const squareAppId = dev ? PUBLIC_SQUARE_APP_ID_SANDBOX : PUBLIC_SQUARE_APP_ID_PROD;
  const squareOauthBase = dev
    ? 'https://connect.squareupsandbox.com/oauth2/authorize'
    : 'https://connect.squareup.com/oauth2/authorize';

  function connectSquare() {
    if (typeof window === 'undefined') return;
    if (!venue?.id) return;
    if (!squareAppId) return;
    const state =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    const isHttps = window.location.protocol === 'https:';
    const sameSite = isHttps ? 'none' : 'lax';
    const secureFlag = isHttps ? '; secure' : '';
    document.cookie = `square_oauth_state=${state}; path=/; max-age=600; samesite=${sameSite}${secureFlag}`;
    document.cookie = `square_oauth_venue=${venue.id}; path=/; max-age=600; samesite=${sameSite}${secureFlag}`;
    const redirectUri = `${window.location.origin}/api/square/callback`;
    const scopeParam = encodeURIComponent(SQUARE_SCOPES);
    const redirectParam = encodeURIComponent(redirectUri);
    const sessionParam = dev ? '' : '&session=false';
    const target = `${squareOauthBase}?client_id=${squareAppId}&response_type=code&scope=${scopeParam}&state=${state}&redirect_uri=${redirectParam}${sessionParam}`;
    if (window.top) {
      window.top.location.href = target;
    } else {
      window.location.href = target;
    }
  }

  onMount(async () => {
    try {
      await fetchVenue();
      if (venue?.id) {
        claims = await fetchClaimsForVenueId(venue.id);
        await fetchSquareStatus();
        if (squareConnected) {
          await fetchSquareLocations();
        }
      } else {
        claims = [];
      }
    } catch (error) {
      console.error('Error fetching claims:', error);
    } finally {
      loading = false;
    }
  });

  onMount(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get('square');
    const reason = url.searchParams.get('reason');
    const merchant = url.searchParams.get('merchant');

    if (status === 'connected') {
      squareBanner = {
        type: 'success',
        message: merchant ? `Square connected (merchant ${merchant}).` : 'Square connected.'
      };
    } else if (status === 'error') {
      squareBanner = {
        type: 'error',
        message: reason ? `Square connection failed: ${decodeURIComponent(reason)}.` : 'Square connection failed.'
      };
    }

    if (status) {
      url.searchParams.delete('square');
      url.searchParams.delete('reason');
      url.searchParams.delete('merchant');
      replaceState(url.toString(), window.history.state ?? {});
    }
  });

  async function fetchSquareStatus() {
    if (!venue?.id) return;
    try {
      const response = await fetch(`/api/square/status?venue_id=${encodeURIComponent(venue.id)}`);
      if (!response.ok) return;
      const data = await response.json();
      squareConnected = Boolean(data?.connected);
      squareMerchantId = data?.merchant_id ?? '';
      if (!squareConnected) {
        squareLocations = [];
        squareLocationIds = new Set();
        squareLocationsLoaded = false;
      }
    } catch (error) {
      console.error('Error loading Square status:', error);
    }
  }

  async function fetchSquareLocations() {
    if (!venue?.id || !squareConnected) return;
    squareLocationsLoading = true;
    squareLocationsError = '';
    squareLocationsLoaded = false;
    try {
      const [locationsResponse, linksResponse] = await Promise.all([
        fetch(`/api/square/locations?venue_id=${encodeURIComponent(venue.id)}`),
        fetch(`/api/square/location-links?venue_id=${encodeURIComponent(venue.id)}`)
      ]);
      const locationsPayload = await locationsResponse.json().catch(() => null);
      const linksPayload = await linksResponse.json().catch(() => null);
      if (!locationsResponse.ok) {
        squareLocationsError = locationsPayload?.error ?? 'Failed to load Square locations.';
        return;
      }
      if (!linksResponse.ok) {
        squareLocationsError = linksPayload?.error ?? 'Failed to load Square location links.';
        return;
      }
      squareLocations = (locationsPayload?.locations ?? []) as {
        id: string;
        name: string;
        status?: string;
      }[];
      const linkedIds = new Set<string>(linksPayload?.location_ids ?? []);
      squareLocationIds = linkedIds;
    } catch (error) {
      console.error('Error loading Square locations:', error);
      squareLocationsError = 'Failed to load Square locations.';
    } finally {
      squareLocationsLoading = false;
      squareLocationsLoaded = true;
    }
  }

  function toggleSquareLocation(id: string) {
    const next = new Set(squareLocationIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    squareLocationIds = next;
  }

  async function saveSquareLocations() {
    if (!venue?.id || squareLocationsSaving) return;
    squareLocationsSaving = true;
    squareLocationsError = '';
    try {
      const response = await fetch('/api/square/location-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venue.id,
          location_ids: Array.from(squareLocationIds)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        squareLocationsError = payload?.error ?? 'Failed to save Square locations.';
      }
    } catch (error) {
      console.error('Error saving Square locations:', error);
      squareLocationsError = 'Failed to save Square locations.';
    } finally {
      squareLocationsSaving = false;
    }
  }

  async function disconnectSquare() {
    if (!venue?.id || squareSyncing) return;
    const confirmed = window.confirm('Disconnect Square for this venue?');
    if (!confirmed) return;
    squareSyncing = true;
    try {
      const response = await fetch('/api/square/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venue.id })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const reason =
          payload?.error ||
          (payload?.status ? `revoke_failed_${payload.status}` : null) ||
          'disconnect_failed';
        squareBanner = { type: 'error', message: `Square disconnect failed: ${reason}.` };
        return;
      }
      squareConnected = false;
      squareMerchantId = '';
      squareLocations = [];
      squareLocationIds = new Set();
      squareLocationsLoaded = false;
      squareBanner = { type: 'success', message: 'Square disconnected.' };
    } catch (error) {
      console.error('Error disconnecting Square:', error);
      squareBanner = { type: 'error', message: 'Square disconnect failed.' };
    } finally {
      squareSyncing = false;
    }
  }

  function updateClaimsScrollFade() {
    if (!claimsScrollEl) {
      showClaimsScrollFade = false;
      showClaimsScrollLeftFade = false;
      return;
    }
    const maxScrollLeft = claimsScrollEl.scrollWidth - claimsScrollEl.clientWidth;
    if (maxScrollLeft <= 1) {
      showClaimsScrollFade = false;
      showClaimsScrollLeftFade = false;
      return;
    }
    showClaimsScrollFade = claimsScrollEl.scrollLeft < maxScrollLeft - 1;
    showClaimsScrollLeftFade = claimsScrollEl.scrollLeft > 1;
  }

  onMount(() => {
    const handleResize = () => updateClaimsScrollFade();
    window.addEventListener('resize', handleResize);
    tick().then(updateClaimsScrollFade);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });

  $: selectedClaims = claims.filter((claim) => claim.id && selectedClaimIds.has(claim.id));
  $: totalAmount = calculateTotalAmount(selectedCount > 0 ? selectedClaims : claims);
  $: totalFee = calculateTotalFee(selectedCount > 0 ? selectedClaims : claims);
  $: totalClaimsCount = selectedCount > 0 ? selectedClaims.length : claims.length;
  $: isFullSelection = selectedCount > 0 && selectedCount === claims.length;
  $: selectedWeekLabel = getSelectedWeekLabel(weekGroups, selectedClaimIds, selectedCount);
  $: weekGroups = groupClaimsByWeek(claims);
  $: selectedCount = selectedClaimIds.size;
  $: allSelected =
    getSelectableClaimIds().length > 0 &&
    getSelectableClaimIds().every((id) => selectedClaimIds.has(id));
  $: if (selectedCount === 0 && csvFileName) {
    clearCsvState();
  }
  $: if (selectedCount === 0 && (squareMatches.length > 0 || squareUnmatchedClaimIds.length > 0)) {
    clearSquareState();
  }
  $: pendingMatchCount = csvMatches.filter((match) => {
    if (csvApprovedClaimIds.includes(match.claimId)) return false;
    const claim = claims.find((item) => item.id === match.claimId);
    return claim ? getClaimStatus(claim) === 'pending' : true;
  }).length;
  $: pendingDenyCount = csvUnmatchedClaimIds.filter((claimId) => {
    if (csvDeniedClaimIds.includes(claimId)) return false;
    const claim = claims.find((item) => item.id === claimId);
    return claim ? getClaimStatus(claim) === 'pending' : true;
  }).length;
  $: if (csvSourceText && !csvApproving && !csvDenying) {
    selectedClaimIds;
    claims;
    buildMatchesFromCsv(csvSourceText);
  }
  $: squarePendingMatchCount = squareMatches.filter((match) => {
    if (squareApprovedClaimIds.includes(match.claimId)) return false;
    const claim = claims.find((item) => item.id === match.claimId);
    return claim ? getClaimStatus(claim) === 'pending' : true;
  }).length;
  $: squarePendingDenyCount = squareUnmatchedClaimIds.filter((claimId) => {
    if (squareDeniedClaimIds.includes(claimId)) return false;
    const claim = claims.find((item) => item.id === claimId);
    return claim ? getClaimStatus(claim) === 'pending' : true;
  }).length;
  $: if (!loading) {
    tick().then(updateClaimsScrollFade);
  }

  async function fetchVenue() {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    userEmail = user?.email ?? '';
    if (!user) return;

    const { data: directVenues, error: directError } = await supabase
      .from('venues')
      .select('id, name, short_code, logo_url, kickback_guest, kickback_referrer, active, created_by')
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
        .select('id, name, short_code, logo_url, kickback_guest, kickback_referrer, active')
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

      const shortCode = await generateUniqueVenueCode(venueName.trim());
      const payload = {
        name: venueName.trim(),
        created_by: user.id,
        kickback_guest: Number(guestRate),
        kickback_referrer: Number(referrerRate),
        short_code: shortCode
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
      const trimmedName = venueName.trim();
      const nameChanged = trimmedName !== venue.name;
      const shortCode =
        nameChanged || !venue.short_code
          ? await generateUniqueVenueCode(trimmedName)
          : venue.short_code;
      const payload = {
        name: trimmedName,
        kickback_guest: Number(guestRate),
        kickback_referrer: Number(referrerRate),
        short_code: shortCode
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

  function calculateTotalFee(claimList: Claim[]): number {
    return claimList.reduce((sum, claim) => {
      if (getClaimStatus(claim) === 'denied') return sum;
      return sum + getFeeAmount(claim);
    }, 0);
  }

  function formatRate(value: number | null | undefined): string {
    return Number(value ?? 5).toFixed(1).replace('.0', '');
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

  function getSelectedWeekLabel(
    groups: { label: string; claims: Claim[] }[],
    selectedIds: Set<string>,
    count: number
  ): string | null {
    if (count === 0) return null;
    const matching = groups.filter((group) => {
      const ids = group.claims.map((claim) => claim.id).filter(Boolean) as string[];
      return ids.length > 0 && ids.every((id) => selectedIds.has(id));
    });
    if (matching.length !== 1) return null;
    const weekCount = matching[0].claims.filter((claim) => claim.id).length;
    return weekCount === count ? matching[0].label.toUpperCase() : null;
  }

  function getCombinedRate(claim: Claim): number {
    const guestRate = Number(claim.kickback_guest_rate ?? 5);
    const referrerRate = Number(claim.kickback_referrer_rate ?? 5);
    const platformRate = 1;
    return guestRate + referrerRate + platformRate;
  }

  function getFeeAmount(claim: Claim): number {
    const combinedRate = getCombinedRate(claim) / 100;
    return calculateKickbackWithRate(Number(claim.amount || 0), combinedRate);
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

  function isSelected(id: string | null | undefined): boolean {
    if (!id) return false;
    return selectedClaimIds.has(id);
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

  function clearSelection() {
    selectedClaimIds = new Set();
  }

  function getSelectableClaimIds(): string[] {
    return claims.map((claim) => claim.id).filter(Boolean) as string[];
  }

  function selectAllClaims() {
    const next = new Set<string>();
    for (const id of getSelectableClaimIds()) {
      next.add(id);
    }
    selectedClaimIds = next;
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
      console.error('Error applying bulk status:', error);
    } finally {
      bulkApplying = false;
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

  async function isVenueCodeAvailable(code: string, venueId?: string): Promise<boolean> {
    const { data, error } = await supabase.from('venues').select('id').eq('short_code', code);
    if (error) throw error;
    if (!data || data.length === 0) return true;
    if (venueId) return data.every((row) => row.id === venueId);
    return false;
  }

  async function generateUniqueVenueCode(name: string): Promise<string> {
    const base = buildVenueBase(name, 12);
    if (base.length >= 4 && (await isVenueCodeAvailable(base, venue?.id))) {
      return base;
    }
    for (let i = 0; i < 20; i += 1) {
      const code = generateVenueCode(name, 4, 12);
      if (await isVenueCodeAvailable(code, venue?.id)) return code;
    }
    return generateVenueCode(name, 4, 12);
  }

  function parseMoney(value: string): number | null {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  function buildMatchesFromCsv(csvText: string) {
    csvError = '';
    csvParsedCount = 0;
    csvMatches = [];
    csvUnmatchedCount = 0;
    csvUnmatchedClaimIds = [];

    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) {
      csvError = 'CSV file is empty or missing data rows.';
      return;
    }

    const headers = parseCsvLine(lines[0]).map((header) => header.trim());
    const headerIndex = (name: string) => headers.findIndex((header) => header === name);
    const dateIndex = headerIndex('Date');
    const timeIndex = headerIndex('Time');
    const amountIndex = headerIndex('Total Collected');
    const last4Index = headerIndex('PAN Suffix');
    const transactionIdIndex = headerIndex('Transaction ID');

    if ([dateIndex, timeIndex, amountIndex, last4Index].some((idx) => idx === -1)) {
      csvError = 'Missing required columns: Date, Time, Total Collected, PAN Suffix.';
      return;
    }

    const selectedIds = new Set(selectedClaimIds);
    const pendingClaims = claims.filter(
      (claim) => claim.id && selectedIds.has(claim.id) && getClaimStatus(claim) === 'pending'
    );
    const unmatchedClaims = new Set(pendingClaims.map((claim) => claim.id).filter(Boolean) as string[]);

    const parsedRows = lines.slice(1).map((line) => parseCsvLine(line));
    csvParsedCount = parsedRows.length;
    for (const row of parsedRows) {
      const date = row[dateIndex]?.trim();
      const time = row[timeIndex]?.trim();
      const amountValue = row[amountIndex]?.trim();
      const last4 = row[last4Index]?.trim();
      const transactionId = row[transactionIdIndex]?.trim() || 'unknown';

      if (!date || !time || !amountValue || !last4) {
        csvUnmatchedCount += 1;
        continue;
      }

      const amount = parseMoney(amountValue);
      if (amount == null) {
        csvUnmatchedCount += 1;
        continue;
      }

      const transactionTime = new Date(`${date}T${time}`);
      if (Number.isNaN(transactionTime.getTime())) {
        csvUnmatchedCount += 1;
        continue;
      }

      let bestClaim: Claim | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;

      for (const claim of pendingClaims) {
        if (!claim.id || !unmatchedClaims.has(claim.id)) continue;
        if (String(claim.last_4 || '').trim() !== last4) continue;
        if (Number(claim.amount || 0).toFixed(2) !== amount.toFixed(2)) continue;
        const claimTime = new Date(claim.purchased_at);
        const diffMs = Math.abs(claimTime.getTime() - transactionTime.getTime());
        if (diffMs <= 3 * 60 * 1000 && diffMs < bestDiff) {
          bestDiff = diffMs;
          bestClaim = claim;
        }
      }

      if (bestClaim?.id) {
        unmatchedClaims.delete(bestClaim.id);
        csvMatches = [
          ...csvMatches,
          { claimId: bestClaim.id, transactionId, amount, last4, time: transactionTime }
        ];
      } else {
        csvUnmatchedCount += 1;
      }
    }

    csvUnmatchedClaimIds = Array.from(unmatchedClaims);
    const matchedIds = new Set(csvMatches.map((match) => match.claimId));
    const unmatchedIds = new Set(csvUnmatchedClaimIds);
    csvApprovedClaimIds = csvApprovedClaimIds.filter((id) => matchedIds.has(id));
    csvDeniedClaimIds = csvDeniedClaimIds.filter((id) => unmatchedIds.has(id));
  }

  async function handleCsvUpload(file: File) {
    clearCsvState();
    csvFileName = file.name;

    try {
      const text = await file.text();
      csvSourceText = text;
      buildMatchesFromCsv(csvSourceText);
    } catch (error) {
      console.error('Error reading CSV:', error);
      csvError = 'Failed to read CSV file.';
    }
  }

  function clearCsvState() {
    csvFileName = '';
    csvSourceText = '';
    csvError = '';
    csvParsedCount = 0;
    csvMatches = [];
    csvUnmatchedCount = 0;
    csvUnmatchedClaimIds = [];
    csvApprovedClaimIds = [];
    csvDeniedClaimIds = [];
  }

  function clearSquareState() {
    squareMatches = [];
    squareUnmatchedClaimIds = [];
    squareError = '';
    squareApproving = false;
    squareDenying = false;
    squareApprovedClaimIds = [];
    squareDeniedClaimIds = [];
    squareCheckedRange = '';
  }

  function buildMatchesFromSquare(payments: SquarePayment[]) {
    squareError = '';
    squareMatches = [];
    squareUnmatchedClaimIds = [];

    const selectedIds = new Set(selectedClaimIds);
    const pendingClaims = claims.filter(
      (claim) => claim.id && selectedIds.has(claim.id) && getClaimStatus(claim) === 'pending'
    );
    const unmatchedClaims = new Set(pendingClaims.map((claim) => claim.id).filter(Boolean) as string[]);

    for (const payment of payments) {
      const last4 = payment.card_details?.card?.last_4;
      const fingerprint =
        payment.card_details?.card?.fingerprint ??
        payment.card_details?.card?.card_fingerprint ??
        null;
      const amount = payment.amount_money?.amount;
      const createdAt = payment.created_at;
      if (!last4 || !fingerprint || amount == null || !createdAt) continue;

      const transactionTime = new Date(createdAt);
      if (Number.isNaN(transactionTime.getTime())) continue;

      const amountDollars = amount / 100;
      let bestClaim: Claim | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;

      for (const claim of pendingClaims) {
        if (!claim.id || !unmatchedClaims.has(claim.id)) continue;
        if (String(claim.last_4 || '').trim() !== last4) continue;
        if (Number(claim.amount || 0).toFixed(2) !== amountDollars.toFixed(2)) continue;
        const claimTime = new Date(claim.purchased_at);
        const diffMs = Math.abs(claimTime.getTime() - transactionTime.getTime());
        if (diffMs <= 5 * 60 * 1000 && diffMs < bestDiff) {
          bestDiff = diffMs;
          bestClaim = claim;
        }
      }

      if (bestClaim?.id) {
        unmatchedClaims.delete(bestClaim.id);
        squareMatches = [
          ...squareMatches,
          {
            claimId: bestClaim.id,
            paymentId: payment.id,
            fingerprint,
            amount: amountDollars,
            last4,
            time: transactionTime,
            locationId: payment.location_id ?? null
          }
        ];
      }
    }

    squareUnmatchedClaimIds = Array.from(unmatchedClaims);
    const matchedIds = new Set(squareMatches.map((match) => match.claimId));
    const unmatchedIds = new Set(squareUnmatchedClaimIds);
    squareApprovedClaimIds = squareApprovedClaimIds.filter((id) => matchedIds.has(id));
    squareDeniedClaimIds = squareDeniedClaimIds.filter((id) => unmatchedIds.has(id));
  }

  async function autoCheckSquare() {
    if (!venue?.id || squareChecking) return;
    clearSquareState();
    squareChecking = true;

    try {
      const selectedIds = new Set(selectedClaimIds);
      const pendingClaims = claims.filter(
        (claim) => claim.id && selectedIds.has(claim.id) && getClaimStatus(claim) === 'pending'
      );
      if (pendingClaims.length === 0) {
        squareError = 'Select pending claims to check against Square.';
        return;
      }
      if (!squareConnected) {
        squareError = 'Square is not connected yet.';
        return;
      }

      const times = pendingClaims
        .map((claim) => new Date(claim.purchased_at))
        .filter((date) => !Number.isNaN(date.getTime()));
      if (times.length === 0) {
        squareError = 'Selected claims have invalid timestamps.';
        return;
      }

      const minTime = new Date(Math.min(...times.map((t) => t.getTime())) - 10 * 60 * 1000);
      const maxTime = new Date(Math.max(...times.map((t) => t.getTime())) + 10 * 60 * 1000);
      squareCheckedRange = `${minTime.toLocaleString()} - ${maxTime.toLocaleString()}`;

      const response = await fetch(
        `/api/square/payments?venue_id=${encodeURIComponent(venue.id)}&begin_time=${encodeURIComponent(
          minTime.toISOString()
        )}&end_time=${encodeURIComponent(maxTime.toISOString())}`
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        squareError = payload?.error ?? 'Failed to fetch Square payments.';
        return;
      }

      const payments = (payload?.payments ?? []) as SquarePayment[];
      buildMatchesFromSquare(payments);
      if (squareMatches.length === 0 && squareUnmatchedClaimIds.length === 0) {
        squareError = 'No Square payments found in that time range.';
      }
    } catch (error) {
      console.error('Error checking Square payments:', error);
      squareError = 'Failed to check Square payments.';
    } finally {
      squareChecking = false;
    }
  }

  async function applySquareMatches() {
    if (squarePendingMatchCount === 0) return;
    squareApproving = true;
    try {
      for (const match of squareMatches) {
        if (squareApprovedClaimIds.includes(match.claimId)) continue;
        await updateClaimWithSquareMatch(match.claimId, 'approved', {
          paymentId: match.paymentId,
          fingerprint: match.fingerprint,
          locationId: match.locationId ?? null
        });
        claims = claims.map((claim) =>
          claim.id === match.claimId
            ? {
                ...claim,
                status: 'approved',
                square_payment_id: match.paymentId,
                square_card_fingerprint: match.fingerprint,
                square_location_id: match.locationId ?? null
              }
            : claim
        );
        squareApprovedClaimIds = [...squareApprovedClaimIds, match.claimId];
      }
    } catch (error) {
      console.error('Error applying Square matches:', error);
      squareError = 'Failed to apply approvals.';
    } finally {
      squareApproving = false;
    }
  }

  async function denySquareUnmatchedClaims() {
    if (squarePendingDenyCount === 0) return;
    squareDenying = true;
    try {
      for (const claimId of squareUnmatchedClaimIds) {
        if (squareDeniedClaimIds.includes(claimId)) continue;
        await updateClaimStatus(claimId, 'denied');
        claims = claims.map((claim) =>
          claim.id === claimId ? { ...claim, status: 'denied' } : claim
        );
        squareDeniedClaimIds = [...squareDeniedClaimIds, claimId];
      }
    } catch (error) {
      console.error('Error denying Square unmatched claims:', error);
      squareError = 'Failed to deny unmatched claims.';
    } finally {
      squareDenying = false;
    }
  }

  type SquarePayment = {
    id: string;
    created_at?: string;
    location_id?: string;
    amount_money?: { amount: number };
    card_details?: { card?: { last_4?: string; fingerprint?: string; card_fingerprint?: string } };
  };

  async function applyCsvMatches() {
    if (pendingMatchCount === 0) return;
    csvApproving = true;
    try {
      for (const match of csvMatches) {
        if (csvApprovedClaimIds.includes(match.claimId)) continue;
        await updateClaimStatus(match.claimId, 'approved');
        claims = claims.map((claim) =>
          claim.id === match.claimId ? { ...claim, status: 'approved' } : claim
        );
        csvApprovedClaimIds = [...csvApprovedClaimIds, match.claimId];
      }
      if (csvSourceText) buildMatchesFromCsv(csvSourceText);
    } catch (error) {
      console.error('Error applying CSV matches:', error);
      csvError = 'Failed to apply approvals.';
    } finally {
      csvApproving = false;
    }
  }

  async function denyUnmatchedClaims() {
    if (pendingDenyCount === 0) return;
    csvDenying = true;
    try {
      for (const claimId of csvUnmatchedClaimIds) {
        if (csvDeniedClaimIds.includes(claimId)) continue;
        await updateClaimStatus(claimId, 'denied');
        claims = claims.map((claim) =>
          claim.id === claimId ? { ...claim, status: 'denied' } : claim
        );
        csvDeniedClaimIds = [...csvDeniedClaimIds, claimId];
      }
      if (csvSourceText) buildMatchesFromCsv(csvSourceText);
    } catch (error) {
      console.error('Error denying unmatched claims:', error);
      csvError = 'Failed to deny unmatched claims.';
    } finally {
      csvDenying = false;
    }
  }

</script>

<div class="p-4 md:p-10 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
<div class="max-w-4xl mx-auto space-y-10">
  {#if squareBanner}
    <div class={`rounded-2xl border px-4 py-3 text-sm font-bold uppercase tracking-widest flex items-center justify-between gap-4 ${squareBanner.type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-200' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
      <span>{squareBanner.message}</span>
      <button
        type="button"
        on:click={() => (squareBanner = null)}
        class="text-zinc-300 hover:text-white transition-colors text-xs font-black tracking-[0.3em]"
        aria-label="Dismiss Square status"
      >
        CLOSE
      </button>
    </div>
  {/if}
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
              <div class="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  on:click={saveVenue}
                  disabled={savingVenue || !venueName.trim()}
                  class="bg-white text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight disabled:opacity-50"
                >
                  {savingVenue ? 'Saving...' : 'Save Changes'}
                </button>
                {#if squareConnected}
                  <button
                    type="button"
                    on:click={disconnectSquare}
                    disabled={squareSyncing}
                    class="bg-orange-500 text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight shadow-xl shadow-orange-500/10 disabled:opacity-50"
                  >
                    {squareSyncing ? 'Disconnecting...' : 'Disconnect Square'}
                  </button>
                {:else}
                  <button
                    type="button"
                    on:click={connectSquare}
                    class="bg-orange-500 text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight shadow-xl shadow-orange-500/10"
                  >
                    Connect Square
                  </button>
                {/if}
              </div>
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
          {#if squareConnected && (squareLocationsError || (squareLocationsLoaded && squareLocations.length !== 1))}
            <div class="mt-2 bg-zinc-950 border border-zinc-800 rounded-xl p-4 w-full">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-xs font-black uppercase tracking-widest text-zinc-500">Square Locations</p>
                  <p class="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-1">
                    Leave unchecked to allow all locations
                  </p>
                </div>
                <button
                  type="button"
                  on:click={saveSquareLocations}
                  disabled={squareLocationsSaving || squareLocationsLoading}
                  class="bg-white text-black font-black px-4 py-2 rounded-xl uppercase tracking-tight text-xs disabled:opacity-50"
                >
                  {squareLocationsSaving ? 'Saving...' : 'Save Locations'}
                </button>
              </div>
              {#if squareLocationsError}
                <p class="text-xs font-bold uppercase tracking-widest text-red-400 mt-3">
                  {squareLocationsError}
                </p>
              {/if}
              {#if squareLocationsLoading}
                <p class="text-xs font-bold uppercase tracking-widest text-zinc-500 mt-3">Loading...</p>
              {:else if squareLocations.length === 0}
                <p class="text-xs font-bold uppercase tracking-widest text-zinc-500 mt-3">
                  No Square locations found.
                </p>
              {:else}
                <div class="mt-3 grid gap-2">
                  {#each squareLocations as location}
                    <label class="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-zinc-300">
                      <input
                        type="checkbox"
                        checked={squareLocationIds.has(location.id)}
                        on:change={() => toggleSquareLocation(location.id)}
                        class="h-3.5 w-3.5 accent-blue-500"
                      />
                      <span class="min-w-0 truncate">{location.name}</span>
                      {#if location.status}
                        <span class="text-[10px] text-zinc-500">{location.status}</span>
                      {/if}
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
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

    <section class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="text-zinc-500 uppercase tracking-tighter text-sm font-bold">
          <span class="text-white">Kick</span><span class="text-orange-500">back</span> Dashboard
        </h1>
        <div class="text-[3.4rem] sm:text-6xl md:text-6xl font-black text-white mt-1">${totalAmount.toFixed(2)}</div>
        <p class="text-xs font-black uppercase tracking-widest text-zinc-500 mt-1">
          {selectedWeekLabel ? `Total ${selectedWeekLabel}` : selectedCount > 0 && !isFullSelection ? 'Claimed' : 'Total Claimed'}
        </p>
      </div>
      <div class="flex flex-col gap-3 md:items-end md:text-right">
        <div>
          <div class="text-zinc-500 text-sm uppercase font-bold">
            <span class="inline-block min-w-[96px]">
              {selectedCount > 0 && !isFullSelection ? 'Fee' : 'Total Fee'}
            </span>
          </div>
          <div class="text-2xl font-bold text-orange-400 mt-1">${totalFee.toFixed(2)}</div>
        </div>
        <div>
          <div class="text-zinc-500 text-sm uppercase font-bold">
            <span class="inline-block min-w-[96px]">
              {selectedCount > 0 && !isFullSelection ? 'Claims' : 'Total Claims'}
            </span>
          </div>
          <div class="text-2xl font-bold mt-1">{totalClaimsCount}</div>
        </div>
      </div>
    </section>

    {#if selectedCount > 0}
    <section class="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 md:p-6" transition:slide>
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p class="text-xs font-black uppercase tracking-widest text-zinc-500">Bulk Actions</p>
          <p class="text-sm font-bold text-white mt-1">{selectedCount} Selected</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 md:justify-end md:flex-1">
          <button
            type="button"
            on:click={() => applyBulkStatus('approved')}
            disabled={bulkApplying || selectedCount === 0}
            class="bg-green-500 text-black font-black px-4 py-2 rounded-xl uppercase tracking-tight text-xs disabled:opacity-50"
          >
            {bulkApplying ? 'Applying...' : 'Bulk Approve'}
          </button>
          <button
            type="button"
            on:click={() => applyBulkStatus('pending')}
            disabled={bulkApplying || selectedCount === 0}
            class="bg-zinc-200 text-black font-black px-4 py-2 rounded-xl uppercase tracking-tight text-xs disabled:opacity-50"
          >
            {bulkApplying ? 'Applying...' : 'Bulk Pending'}
          </button>
          <button
            type="button"
            on:click={() => applyBulkStatus('denied')}
            disabled={bulkApplying || selectedCount === 0}
            class="bg-red-500 text-white font-black px-4 py-2 rounded-xl uppercase tracking-tight text-xs disabled:opacity-50"
          >
            {bulkApplying ? 'Applying...' : 'Bulk Deny'}
          </button>
          {#if squareConnected}
            <button
              type="button"
              on:click={autoCheckSquare}
              disabled={squareChecking || selectedCount === 0}
              class="bg-orange-500/90 text-black font-black px-4 py-2 rounded-xl uppercase tracking-tight text-xs disabled:opacity-50"
            >
              {squareChecking ? 'Checking...' : 'Auto-check Square'}
            </button>
          {/if}
          <label class="inline-flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-black text-zinc-300 cursor-pointer hover:text-white transition-colors uppercase tracking-tight">
            <input
              type="file"
              accept=".csv,text/csv"
              class="hidden"
              on:change={(event) => {
                const target = event.currentTarget as HTMLInputElement;
                const file = target.files?.[0];
                if (file) handleCsvUpload(file);
                if (target) target.value = '';
              }}
            />
            Upload CSV
          </label>
          {#if csvFileName}
            <span class="text-[10px] font-black uppercase tracking-widest text-zinc-500">{csvFileName}</span>
          {/if}
        </div>
      </div>
      {#if csvError}
        <p class="text-xs font-bold uppercase tracking-widest text-red-400 mt-3">{csvError}</p>
      {/if}
      {#if csvFileName}
          <div class="mt-4 bg-zinc-950 border border-zinc-800 rounded-xl p-4">
            <div class="flex flex-wrap gap-6 text-xs font-bold uppercase tracking-widest text-zinc-400">
              <span>{selectedCount} Claims</span>
              <span>{csvMatches.length} Matched</span>
              <span>{csvUnmatchedClaimIds.length} Unmatched</span>
            </div>
            <div class="mt-4">
              {#if pendingMatchCount > 0}
              <button
                type="button"
                on:click={applyCsvMatches}
                disabled={csvApproving}
                class="bg-green-500 text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight disabled:opacity-50"
              >
                {csvApproving ? 'Applying...' : `Approve ${pendingMatchCount} Matched Claims`}
              </button>
              {:else}
                <button
                  type="button"
                  disabled={true}
                  class="bg-green-500/30 text-green-100 font-black px-6 py-3 rounded-xl uppercase tracking-tight cursor-not-allowed"
                >
                  Approved {csvMatches.length} Matched Claims
                </button>
              {/if}
            </div>
          {#if csvUnmatchedClaimIds.length > 0}
            <div class="mt-3">
              {#if pendingDenyCount > 0}
              <button
                type="button"
                on:click={denyUnmatchedClaims}
                disabled={csvDenying}
                class="bg-red-500 text-white font-black px-6 py-3 rounded-xl uppercase tracking-tight disabled:opacity-50"
              >
                {csvDenying ? 'Applying...' : `Deny ${pendingDenyCount} Unmatched Claims`}
              </button>
              {:else}
                <button
                  type="button"
                  disabled={true}
                  class="bg-red-500/30 text-red-100 font-black px-6 py-3 rounded-xl uppercase tracking-tight cursor-not-allowed"
                >
                  Denied {csvUnmatchedClaimIds.length} Unmatched Claims
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
      {#if squareError}
        <p class="text-xs font-bold uppercase tracking-widest text-red-400 mt-3">{squareError}</p>
      {/if}
      {#if squareMatches.length > 0 || squareUnmatchedClaimIds.length > 0}
        <div class="mt-4 bg-zinc-950 border border-zinc-800 rounded-xl p-4">
          <div class="flex flex-wrap gap-6 text-xs font-bold uppercase tracking-widest text-zinc-400">
            <span>Square Check</span>
            {#if squareCheckedRange}
              <span class="text-zinc-600">{squareCheckedRange}</span>
            {/if}
            <span>{squareMatches.length} Matched</span>
            <span>{squareUnmatchedClaimIds.length} Unmatched</span>
          </div>
          <div class="mt-4">
            {#if squarePendingMatchCount > 0}
              <button
                type="button"
                on:click={applySquareMatches}
                disabled={squareApproving}
                class="bg-green-500 text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight disabled:opacity-50"
              >
                {squareApproving ? 'Applying...' : `Approve ${squarePendingMatchCount} Matched Claims`}
              </button>
            {:else}
              <button
                type="button"
                disabled={true}
                class="bg-green-500/30 text-green-100 font-black px-6 py-3 rounded-xl uppercase tracking-tight cursor-not-allowed"
              >
                Approved {squareMatches.length} Matched Claims
              </button>
            {/if}
          </div>
          {#if squareUnmatchedClaimIds.length > 0}
            <div class="mt-3">
              {#if squarePendingDenyCount > 0}
                <button
                  type="button"
                  on:click={denySquareUnmatchedClaims}
                  disabled={squareDenying}
                  class="bg-red-500 text-white font-black px-6 py-3 rounded-xl uppercase tracking-tight disabled:opacity-50"
                >
                  {squareDenying ? 'Applying...' : `Deny ${squarePendingDenyCount} Unmatched Claims`}
                </button>
              {:else}
                <button
                  type="button"
                  disabled={true}
                  class="bg-red-500/30 text-red-100 font-black px-6 py-3 rounded-xl uppercase tracking-tight cursor-not-allowed"
                >
                  Denied {squareUnmatchedClaimIds.length} Unmatched Claims
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </section>
    {/if}

    <div class="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
      <div class="relative">
        <div
          class="w-full overflow-x-auto"
          bind:this={claimsScrollEl}
          on:scroll={updateClaimsScrollFade}
        >
        <table class="min-w-[720px] w-full text-left border-collapse">
        <thead>
          <tr class="bg-zinc-800/50 text-zinc-400 text-xs uppercase">
            <th class="p-3 pl-4 font-semibold">
              <div class="flex items-center gap-3">
                <input
                  type="checkbox"
                  aria-label="Select all claims"
                  checked={allSelected}
                  on:change={toggleSelectAllClaims}
                  class="h-3.5 w-3.5 accent-blue-500"
                />
                <span>Date/Time</span>
              </div>
            </th>
            <th class="p-4 font-semibold text-center">Total Claimed</th>
            <th class="p-4 font-semibold text-center">
              <span class="relative inline-flex items-center">
                <button
                  type="button"
                  class="text-zinc-400 hover:text-white transition-colors"
                  on:click={() => {
                    showRatesTip = !showRatesTip;
                    if (showRatesTip) {
                      if (ratesTipTimer) clearTimeout(ratesTipTimer);
                      ratesTipTimer = setTimeout(() => {
                        showRatesTip = false;
                        ratesTipTimer = null;
                      }, 1600);
                    }
                  }}
                  on:blur={() => showRatesTip = false}
                >
                  RATES (%)
                </button>
                <span class={`rates-tip ${showRatesTip ? 'is-visible' : ''}`}>Guest / Referrer / Platform</span>
              </span>
            </th>
            <th class="p-4 font-semibold text-center">Fee</th>
            <th class="p-4 font-semibold text-center">Last 4</th>
            <th class="p-4 font-semibold text-center">Status</th>
            <th class="p-4 font-semibold text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-800">
          {#each weekGroups as weekGroup}
            <tr class="bg-zinc-950/60 text-zinc-400 text-[10px] uppercase tracking-[0.3em]">
              <td colspan="7" class="px-4 py-3 font-black">
                <div class="flex items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select week ${weekGroup.label}`}
                    checked={allSelected || isWeekSelected(weekGroup.claims, selectedClaimIds)}
                    on:change={() => toggleWeekSelection(weekGroup.claims)}
                    class="h-3.5 w-3.5 accent-blue-500"
                  />
                  <span>{weekGroup.label}</span>
                </div>
              </td>
            </tr>
            {#each weekGroup.claims as claim}
              <tr class="hover:bg-zinc-800/30 transition-colors">
                <td class="p-3 pl-4 text-zinc-400 text-sm">
                  <div class="flex items-center gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select claim ${claim.id}`}
                      checked={selectedClaimIds.has(claim.id ?? '')}
                      on:change={() => toggleSelect(claim.id)}
                      class="h-3.5 w-3.5 accent-blue-500"
                    />
                    <span>
                      {new Date(claim.purchased_at).toLocaleDateString()} 
                      <span class="text-zinc-600 ml-1">{new Date(claim.purchased_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </span>
                  </div>
                </td>
                <td class={`p-4 text-center font-mono font-bold ${getClaimStatus(claim) === 'denied' ? 'text-zinc-600' : 'text-orange-400'}`}>
                  ${Number(claim.amount).toFixed(2)}
                </td>
                <td class="p-4 text-center text-xs font-bold uppercase tracking-widest text-zinc-400 whitespace-nowrap">
                  {formatRate(claim.kickback_guest_rate)} / {formatRate(claim.kickback_referrer_rate)} / 1
                </td>
                <td class={`p-4 text-center font-mono font-bold ${getClaimStatus(claim) === 'denied' ? 'text-zinc-600' : 'text-zinc-200'}`}>
                  ${getFeeAmount(claim).toFixed(2)}
                </td>
                <td class="p-4 text-center whitespace-nowrap">
                  <span class="bg-zinc-800 px-2 py-1 rounded text-xs text-zinc-300">*{claim.last_4}</span>
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
                      {#if getClaimStatus(claim) !== 'pending'}
                        <button
                          type="button"
                          on:click={() => handleClaimStatus(claim, 'pending')}
                          disabled={updatingClaimId === claim.id}
                          class="text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                        >
                          Pending
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
            {/each}
          {:else}
            {#if !loading}
              <tr>
                <td colspan="7" class="p-10 text-center text-zinc-500 italic">No claims found yet. Go get some!</td>
              </tr>
            {/if}
          {/each}
        </tbody>
        </table>
        </div>
        {#if showClaimsScrollLeftFade}
          <div class="pointer-events-none absolute top-0 left-0 h-full w-8 bg-gradient-to-r from-zinc-900/80 to-transparent md:hidden"></div>
        {/if}
        {#if showClaimsScrollFade}
          <div class="pointer-events-none absolute top-0 right-0 h-full w-8 bg-gradient-to-l from-zinc-900/80 to-transparent md:hidden"></div>
        {/if}
      </div>
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

  .rates-tip {
    position: absolute;
    top: 140%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(9, 9, 11, 0.95);
    border: 1px solid rgba(63, 63, 70, 0.6);
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #e4e4e7;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
    z-index: 10;
  }

  .rates-tip.is-visible {
    opacity: 1;
    pointer-events: auto;
  }

  @media (hover: hover) and (pointer: fine) {
    th:hover .rates-tip,
    th:focus-within .rates-tip {
      opacity: 1;
      pointer-events: auto;
    }
  }
</style>

