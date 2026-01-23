<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Session } from '@supabase/supabase-js';
  import { supabase } from '$lib/supabase';
  import { MAX_BILL } from '$lib/claims/constants';
  import { calculateKickbackWithRate, normalizeAmountInput, normalizeLast4, parseAmount } from '$lib/claims/utils';
  import { KICKBACK_RATE } from '$lib/claims/constants';
  import {
    clearDraftFromStorage,
    draftToQuery,
    getDraftFromStorage,
    getDraftFromUrl
  } from '$lib/claims/draft';
  import {
    deleteClaim,
    fetchClaimsForUser,
    insertClaim,
    upsertProfileLast4
  } from '$lib/claims/repository';
  import type { Claim } from '$lib/claims/types';
  import type { Venue } from '$lib/venues/types';
  import { fetchActiveVenues } from '$lib/venues/repository';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import ClaimForm from '$lib/components/ClaimForm.svelte';
  import GuestWarningModal from '$lib/components/GuestWarningModal.svelte';
  import ReferralModal from '$lib/components/ReferralModal.svelte';

  let last4 = '';
  let venue = '';
  let venueId = '';
  let referrer = '';
  let purchaseTime = '';
  let maxPurchaseTime = '';
  let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let errorMessage = '';
  let successMessage = '';

  let showReferModal = false;

  let venues: Venue[] = [];

  let isReferrerLocked = false;
  let isVenueLocked = false;
  let showForm = false;
  let referrerLockedByVenue = false;

  let claims: Claim[] = [];
  let totalPending = 0;
  let highlightClaimKey: string | null = null;

  let amount: number | null = null;
  let amountInput = '';

  let showGuestWarning = false;

  let session: Session | null = null;

  $: userRefCode = session?.user?.email?.split('@')[0] || 'member';
  $: last4 = normalizeLast4(last4);
  $: amount = parseAmount(amountInput);
  $: venueId = getVenueIdByName(venue);
  $: kickbackRate = getKickbackRate(venueId, session ? 'referrer' : 'guest');
  $: kickbackRatePercent = formatRatePercent(kickbackRate);
  $: kickbackAmount = calculateKickbackWithRate(Number(amountInput || 0), kickbackRate);
  $: kickback = kickbackAmount.toFixed(2);
  $: canSubmit = Boolean(
    (amount ?? 0) > 0 &&
    venueId.length > 0 &&
    referrer.trim().length > 0 &&
    last4.length === 4 &&
    purchaseTime.trim().length > 0
  );
  $: if (session && venue.trim()) {
    const lockedReferrer = getVenueLockedReferrer(venue);
    if (lockedReferrer) {
      if (referrer !== lockedReferrer) referrer = lockedReferrer;
      isReferrerLocked = true;
      referrerLockedByVenue = true;
    } else if (referrerLockedByVenue) {
      isReferrerLocked = false;
      referrerLockedByVenue = false;
    }
  }

  async function fetchDashboardData() {
    if (!session) return;

    try {
      claims = await fetchClaimsForUser(session.user.id);
      totalPending = calculateTotalPendingWithRates(claims);
    } catch (error) {
      console.error('Error fetching claims:', error);
    }
  }

  async function fetchVenues() {
    try {
      venues = await fetchActiveVenues();
    } catch (error) {
      console.error('Error fetching venues:', error);
      venues = [];
    }
  }

  function handleInput(e: Event & { currentTarget: HTMLInputElement }) {
    const raw = e.currentTarget.value;
    const normalized = normalizeAmountInput(raw, MAX_BILL);

    if (normalized !== raw) {
      e.currentTarget.value = normalized;
    }

    amountInput = normalized;
    amountInput = normalized;
  }

  function confirmGuestSubmit() {
    showGuestWarning = true;
  }

  function proceedAsGuest() {
    showGuestWarning = false;
    submitClaim();
  }

  onMount(async () => {
    showReferModal = false;
    showGuestWarning = false;
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    }

    const localNow = getLocalNowInputValue();
    purchaseTime = localNow;
    maxPurchaseTime = localNow;

    await fetchVenues();

    const { data } = await supabase.auth.getSession();
    session = data.session;

    const urlDraft = getDraftFromUrl(window.location.search);
    const storedDraft = getDraftFromStorage(localStorage);
    const draft = urlDraft ?? storedDraft;

    if (draft) {
      amountInput = draft.amount ?? '';
      venue = draft.venueId ? getVenueNameById(draft.venueId) || draft.venue || '' : draft.venue || '';
      referrer = draft.ref || '';
      last4 = draft.last4 || '';

      isReferrerLocked = Boolean(referrer);
      isVenueLocked = Boolean(getVenueIdByName(venue));

      clearDraftFromStorage(localStorage);

      if (session) {
        await tick();
        if (canSubmit) {
          const submitted = await submitClaim();
          if (submitted) {
            window.history.replaceState({}, '', '/');
          } else {
            showForm = true;
          }
        } else {
          showForm = true;
        }
      }
    }

    if (session) {
      if (!last4) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('last_4')
          .eq('id', session.user.id)
          .maybeSingle();
        if (profile?.last_4) last4 = String(profile.last_4);
      }

      await fetchDashboardData();
    }
  });

  async function submitClaim(): Promise<boolean> {
    if (!amount || amount <= 0) {
      status = 'error';
      errorMessage = 'Please enter a valid amount';
      return false;
    }

    const cleanAmount = Number(amount.toFixed(2));

    if (last4.length !== 4) {
      status = 'error';
      errorMessage = 'Please enter 4 digits';
      return false;
    }
    if (!referrer.trim()) {
      status = 'error';
      errorMessage = 'Please enter a referrer';
      return false;
    }
    if (!venueId) {
      status = 'error';
      errorMessage = 'Please select a valid venue';
      return false;
    }
    if (!purchaseTime.trim()) {
      status = 'error';
      errorMessage = 'Please enter a purchase time';
      return false;
    }
    const purchaseDate = new Date(purchaseTime);
    if (Number.isNaN(purchaseDate.getTime())) {
      status = 'error';
      errorMessage = 'Please enter a valid purchase time';
      return false;
    }
    if (purchaseDate.getTime() > Date.now() + 60000) {
      status = 'error';
      errorMessage = 'Purchase time cannot be in the future';
      return false;
    }

    status = 'loading';

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await upsertProfileLast4(user.id, last4);
      }

      const createdAt = new Date().toISOString();
      const venueName = getVenueNameById(venueId);
      if (!venueName) {
        status = 'error';
        errorMessage = 'Please select a valid venue';
        return false;
      }

      const rates = getVenueRates(venueId);
      await insertClaim({
        venue: venueName,
        venue_id: venueId,
        referrer: referrer || null,
        amount: cleanAmount,
        kickback_guest_rate: rates.guestRate,
        kickback_referrer_rate: rates.referrerRate,
        purchased_at: new Date(purchaseTime).toISOString(),
        last_4: last4,
        created_at: createdAt,
        submitter_id: session?.user?.id ?? null
      });

      successMessage = `Submitted ${venue} claim for $${cleanAmount.toFixed(2)}.`;
      status = 'success';
      amountInput = '';
      if (!session) {
        last4 = '';
      }
      if (session) {
        showForm = false;
        status = 'idle';
        successMessage = '';
        highlightClaimKey = null;
        await tick();
        await fetchDashboardData();
        highlightClaimKey = claims[0]?.id ?? claims[0]?.created_at ?? null;
        if (highlightClaimKey) {
          setTimeout(() => {
            if (highlightClaimKey) highlightClaimKey = null;
          }, 2000);
        }
        return true;
      } else {
        setTimeout(() => {
          if (status === 'success') status = 'idle';
        }, 2000);
        return true;
      }
    } catch (e: any) {
      status = 'error';
      errorMessage = e.message || 'Connection failed';
      console.error(e);
      return false;
    }
  }

  async function handleSignOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error logging out:', error.message);
      }
    } finally {
      window.location.href = '/login';
    }
  }

  async function handleDeleteClaim(claim: Claim) {
    if (!claim.id) return;
    const confirmed = window.confirm('Remove this claim? This cannot be undone.');
    if (!confirmed) return;

    try {
      await deleteClaim(claim.id);
      await fetchDashboardData();
    } catch (error) {
      console.error('Error deleting claim:', error);
      status = 'error';
      errorMessage = 'Failed to remove claim';
    }
  }

  function buildLoginUrl(
    draftAmount: number | null,
    draftVenue: string,
    draftVenueId: string,
    draftReferrer: string,
    draftLast4: string
  ) {
    const query = draftToQuery({
      amount: draftAmount ? draftAmount.toString() : '',
      venue: draftVenue,
      venueId: draftVenueId,
      ref: draftReferrer,
      last4: draftLast4
    });
    return query ? `/login?${query}` : '/login';
  }

  $: loginUrl = buildLoginUrl(amount, venue, venueId, referrer, last4);

  function hydrateAmountInput(value: string) {
    const normalized = normalizeAmountInput(value, MAX_BILL);
    amountInput = normalized;
  }

  function getVenueIdByName(name: string): string {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return '';
    const match = venues.find((v) => v.name.trim().toLowerCase() === normalizedName);
    return match?.id ?? '';
  }

  function getVenueNameById(id: string): string {
    if (!id) return '';
    const match = venues.find((v) => v.id === id);
    return match?.name ?? '';
  }

  function getVenueRates(id: string): { guestRate: number; referrerRate: number } {
    const match = venues.find((v) => v.id === id);
    const fallback = KICKBACK_RATE * 100;
    const guestRate = match?.kickback_guest ?? fallback;
    const referrerRate = match?.kickback_referrer ?? fallback;
    return {
      guestRate: Number(guestRate),
      referrerRate: Number(referrerRate)
    };
  }

  function getKickbackRate(id: string, kind: 'guest' | 'referrer'): number {
    const rates = getVenueRates(id);
    const selected = kind === 'guest' ? rates.guestRate : rates.referrerRate;
    return Number(selected) / 100;
  }

  function formatRatePercent(rate: number): string {
    const percent = (rate * 100).toFixed(1);
    return percent.endsWith('.0') ? percent.slice(0, -2) : percent;
  }

  function calculateTotalPendingWithRates(claimList: Claim[]): number {
    return claimList.reduce((sum, claim) => {
      const savedRate = claim.kickback_referrer_rate ?? null;
      if (savedRate != null) {
        return sum + calculateKickbackWithRate(Number(claim.amount || 0), Number(savedRate) / 100);
      }

      if (claim.venue_id) {
        const venueMatch = venues.find((venueItem) => venueItem.id === claim.venue_id);
        const rate = venueMatch?.kickback_referrer ?? 5;
        return sum + calculateKickbackWithRate(Number(claim.amount || 0), Number(rate) / 100);
      }

      const venueMatch = venues.find(
        (venueItem) => venueItem.name.trim().toLowerCase() === claim.venue.trim().toLowerCase()
      );
      const rate = venueMatch?.kickback_referrer ?? 5;
      return sum + calculateKickbackWithRate(Number(claim.amount || 0), Number(rate) / 100);
    }, 0);
  }

  function getVenueLockedReferrer(venueName: string): string | null {
    const normalizedVenue = venueName.trim().toLowerCase();
    if (!normalizedVenue) return null;

    let earliestTime = Number.POSITIVE_INFINITY;
    let ref: string | null = null;

    for (const claim of claims) {
      if (claim.venue.trim().toLowerCase() !== normalizedVenue) continue;
      if (!claim.referrer) continue;
      const time = new Date(claim.purchased_at).getTime();
      if (Number.isNaN(time)) continue;
      if (time < earliestTime) {
        earliestTime = time;
        ref = claim.referrer;
      }
    }

    return ref;
  }

  function getLocalNowInputValue(): string {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }

  function startNewClaim() {
    const latestVenue = claims[0]?.venue ?? '';
    const validVenue = getVenueIdByName(latestVenue) ? latestVenue : '';
    const lockedReferrer = validVenue ? getVenueLockedReferrer(validVenue) : null;
    venue = validVenue;
    referrer = lockedReferrer ?? '';
    isVenueLocked = false;
    isReferrerLocked = Boolean(lockedReferrer);
    referrerLockedByVenue = Boolean(lockedReferrer);
    amountInput = '';
    purchaseTime = getLocalNowInputValue();
    maxPurchaseTime = purchaseTime;
    showForm = true;
  }
</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center p-6">
  {#if session && !showForm}
    <Dashboard
      {claims}
      {totalPending}
      {highlightClaimKey}
      {venues}
      userEmail={session?.user?.email ?? ''}
      onNewClaim={startNewClaim}
      onDeleteClaim={handleDeleteClaim}
      onLogout={handleSignOut}
      onOpenRefer={() => showReferModal = true}
    />
  {:else}
    <ClaimForm
      {session}
      showBack={Boolean(session)}
      {status}
      {errorMessage}
      {successMessage}
      {amount}
      {canSubmit}
      {venues}
      {kickbackRatePercent}
      bind:amountInput
      maxBill={MAX_BILL}
      {kickback}
      bind:venue
      bind:referrer
      bind:purchaseTime
      bind:last4
      {maxPurchaseTime}
      {isVenueLocked}
      {isReferrerLocked}
      loginUrl={loginUrl}
      onBack={() => showForm = false}
      onSubmit={submitClaim}
      onConfirmGuest={confirmGuestSubmit}
      onAmountInput={handleInput}
      onAmountHydrate={hydrateAmountInput}
      onLogout={handleSignOut}
    />
    {#if showGuestWarning}
      <GuestWarningModal
        kickback={kickback}
        {kickbackRatePercent}
        {loginUrl}
        onProceed={proceedAsGuest}
      />
    {/if}
  {/if}

  {#if showReferModal}
    <ReferralModal
      {venues}
      userRefCode={userRefCode}
      onClose={() => showReferModal = false}
    />
  {/if}
</main>
