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
  import { generateReferralCode, isReferralCodeValid, normalizeReferralCode } from '$lib/referrals/code';
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
  let referrerLookupStatus: 'idle' | 'checking' | 'valid' | 'invalid' = 'idle';
  let referrerLookupTimer: ReturnType<typeof setTimeout> | null = null;
  let referrerLookupSeq = 0;

  let claims: Claim[] = [];
  let totalPending = 0;
  let highlightClaimKey: string | null = null;

  let amount: number | null = null;
  let amountInput = '';

  let showGuestWarning = false;

  let session: Session | null | undefined = undefined;
  let userRefCode = 'member';
  const historyViewKey = 'view';

  onMount(() => {
    const handlePopState = (event: PopStateEvent) => {
      const nextView = event.state?.[historyViewKey];
      showForm = nextView === 'claim';
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handlePopState);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('popstate', handlePopState);
      }
    };
  });

  $: last4 = normalizeLast4(last4);
  $: amount = parseAmount(amountInput);
  $: venueId = getVenueIdByName(venue);
  $: kickbackRate = getKickbackRate(venueId, session ? 'referrer' : 'guest');
  $: kickbackRatePercent = formatRatePercent(kickbackRate);
  $: kickbackAmount = calculateKickbackWithRate(Number(amountInput || 0), kickbackRate);
  $: kickback = kickbackAmount.toFixed(2);
  $: referrerFormatValid = referrer.trim().length > 0 && isReferralCodeValid(referrer);
  $: canSubmit = Boolean(
    (amount ?? 0) > 0 &&
    venueId.length > 0 &&
    referrerFormatValid &&
    referrerLookupStatus === 'valid' &&
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
  } else if (referrerLockedByVenue) {
    isReferrerLocked = false;
    referrerLockedByVenue = false;
  }
  $: if (!referrer.trim() || !referrerFormatValid) {
    if (referrerLookupTimer) {
      clearTimeout(referrerLookupTimer);
      referrerLookupTimer = null;
    }
    referrerLookupStatus = 'idle';
  } else {
    scheduleReferrerLookup(referrer);
  }

  async function isReferralCodeAvailable(code: string, userId: string): Promise<boolean> {
    const { data, error } = await supabase.from('profiles').select('id').eq('referral_code', code);
    if (error) throw error;
    if (!data || data.length === 0) return true;
    return data.every((row) => row.id === userId);
  }

  async function doesReferralCodeExist(code: string): Promise<boolean> {
    const normalized = normalizeReferralCode(code);
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('referral_code', normalized)
      .limit(1);
    if (error) throw error;
    return Boolean(data && data.length > 0);
  }

  function scheduleReferrerLookup(code: string) {
    if (referrerLookupTimer) clearTimeout(referrerLookupTimer);
    const requestId = referrerLookupSeq + 1;
    referrerLookupSeq = requestId;
    referrerLookupStatus = 'checking';
    referrerLookupTimer = setTimeout(async () => {
      try {
        const exists = await doesReferralCodeExist(code);
        if (requestId !== referrerLookupSeq) return;
        referrerLookupStatus = exists ? 'valid' : 'invalid';
      } catch (error) {
        console.error('Error validating referral code:', error);
        if (requestId !== referrerLookupSeq) return;
        referrerLookupStatus = 'invalid';
      }
    }, 300);
  }

  async function generateUniqueReferralCode(userId: string): Promise<string> {
    for (let i = 0; i < 20; i += 1) {
      const code = generateReferralCode(4);
      if (await isReferralCodeAvailable(code, userId)) return code;
    }
    return generateReferralCode(4);
  }

  async function ensureReferralCode(userId: string, fallbackEmail: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('referral_code')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (data?.referral_code) {
        userRefCode = data.referral_code;
        return;
      }
      const generated = await generateUniqueReferralCode(userId);
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ referral_code: generated, updated_at: new Date().toISOString() })
        .eq('id', userId);
      if (updateError) throw updateError;
      userRefCode = generated;
    } catch (error) {
      console.error('Error ensuring referral code:', error);
      userRefCode = fallbackEmail.split('@')[0] || 'member';
    }
  }

  async function updateReferralCode(code: string): Promise<{ ok: boolean; message?: string; code?: string }> {
    if (!session?.user?.id) return { ok: false, message: 'Sign in to update your code.' };
    const normalized = normalizeReferralCode(code);
    if (!isReferralCodeValid(normalized)) {
      return { ok: false, message: 'Use 4-8 letters or numbers.' };
    }
    try {
      const available = await isReferralCodeAvailable(normalized, session.user.id);
      if (!available) return { ok: false, message: 'Code already taken.' };
      const { error } = await supabase
        .from('profiles')
        .update({ referral_code: normalized, updated_at: new Date().toISOString() })
        .eq('id', session.user.id);
      if (error) throw error;
      userRefCode = normalized;
      return { ok: true, code: normalized };
    } catch (error) {
      console.error('Error updating referral code:', error);
      return { ok: false, message: 'Failed to update code.' };
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
      if (draft.venueCode) {
        const venueFromCode = getVenueByCode(draft.venueCode);
        venue = venueFromCode?.name ?? draft.venue ?? '';
      } else if (draft.venueId) {
        venue = getVenueNameById(draft.venueId) || draft.venue || '';
      } else {
        venue = draft.venue || '';
      }
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

      await ensureReferralCode(session.user.id, session.user.email ?? 'member');
      await fetchDashboardData();

      if (typeof window !== 'undefined' && !window.history.state?.[historyViewKey]) {
        window.history.replaceState({ [historyViewKey]: showForm ? 'claim' : 'dashboard' }, '', window.location.href);
      }
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
    if (!isReferralCodeValid(referrer)) {
      status = 'error';
      errorMessage = 'Referrer code must be 4-8 letters or numbers';
      return false;
    }
    if (referrerLookupStatus !== 'valid') {
      status = 'error';
      errorMessage = 'Unrecognized referral code';
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
      const insertedClaim = await insertClaim({
        venue: venueName,
        venue_id: venueId,
        referrer: normalizeReferralCode(referrer) || null,
        amount: cleanAmount,
        status: 'pending',
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
        if (typeof window !== 'undefined') {
          window.history.replaceState({ [historyViewKey]: 'dashboard' }, '', window.location.href);
        }
        status = 'idle';
        successMessage = '';
        highlightClaimKey = null;
        await tick();
        await fetchDashboardData();
        const newClaim =
          claims.find((claim) => claim.id && claim.id === insertedClaim.id) ??
          claims.find((claim) => claim.created_at === insertedClaim.created_at);
        highlightClaimKey = newClaim?.id ?? newClaim?.created_at ?? null;
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
    const venueCode = getVenueCodeById(draftVenueId);
    const query = draftToQuery({
      amount: draftAmount ? draftAmount.toString() : '',
      venue: draftVenue,
      venueId: draftVenueId,
      venueCode,
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


  function getVenueByCode(code: string): Venue | undefined {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) return undefined;
    return venues.find((v) => (v.short_code ?? '').toUpperCase() === normalizedCode);
  }

  function getVenueCodeById(id: string): string {
    if (!id) return '';
    const match = venues.find((v) => v.id === id);
    return match?.short_code ?? '';
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
      if (claim.status === 'denied') return sum;
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
    const venueIdMatch = getVenueIdByName(venueName);

    let earliestTime = Number.POSITIVE_INFINITY;
    let ref: string | null = null;

    for (const claim of claims) {
      if (venueIdMatch) {
        if (claim.venue_id !== venueIdMatch) continue;
      } else if (claim.venue.trim().toLowerCase() !== normalizedVenue) {
        continue;
      }
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
    const latestClaim = claims[0];
    const venueFromId = latestClaim?.venue_id ? getVenueNameById(latestClaim.venue_id) : '';
    const latestVenue = venueFromId || latestClaim?.venue || '';
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
    if (session && typeof window !== 'undefined') {
      window.history.pushState({ [historyViewKey]: 'claim' }, '', window.location.href);
    }
    showForm = true;
  }

  function handleFormBack() {
    showForm = false;
    if (session && typeof window !== 'undefined') {
      window.history.replaceState({ [historyViewKey]: 'dashboard' }, '', window.location.href);
    }
  }
</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center p-6">
  {#if session === undefined}
    <div class="min-h-screen"></div>
  {:else if session && !showForm}
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
      {referrerLookupStatus}
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
      onBack={handleFormBack}
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
      onUpdateReferralCode={updateReferralCode}
      onClose={() => showReferModal = false}
    />
  {/if}
</main>
