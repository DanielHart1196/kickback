<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { pushState, replaceState } from '$app/navigation';
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
  import {
    buildReferralCodeFromEmail,
    generateReferralCode,
    isReferralCodeValid,
    normalizeReferralCode
  } from '$lib/referrals/code';
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
  let referrerProfileId: string | null = null;
  let lockedReferrerRequestId = 0;
  let referrerCodeCache: Record<string, string> = {};
  let lockedReferrerId: string | null = null;
  let lockedReferrerCode: string | null = null;

  let claims: Claim[] = [];
  let totalPending = 0;
  let highlightClaimKey: string | null = null;
  let claimantCodes: Record<string, string> = {};
  let deferredInstallPrompt: any = null;
  let showInstallBanner = false;
  const installPromptKey = 'kickback:install_prompt_shown';

  let amount: number | null = null;
  let amountInput = '';

  let showGuestWarning = false;

  let session: Session | null | undefined = undefined;
  let userId: string | null = null;
  let userRefCode = 'member';
  const historyViewKey = 'view';
  const historyReferKey = 'refer';

  onMount(() => {
    const handlePopState = (event: PopStateEvent) => {
      const nextView = event.state?.[historyViewKey];
      showForm = nextView === 'claim';
      showReferModal = Boolean(event.state?.[historyReferKey]);
    };
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handlePopState);
      window.addEventListener('beforeinstallprompt', handleBeforeInstall as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('popstate', handlePopState);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall as EventListener);
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
  $: normalizedReferrerInput = typeof referrer === 'string' ? referrer : '';
  $: referrerFormatValid =
    normalizedReferrerInput.trim().length > 0 && isReferralCodeValid(normalizedReferrerInput);
  $: isSelfReferral = Boolean(session) &&
    normalizedReferrerInput.trim().length > 0 &&
    (referrerProfileId === session?.user?.id ||
      normalizeReferralCode(normalizedReferrerInput) === normalizeReferralCode(userRefCode));
  $: canSubmit = Boolean(
    (amount ?? 0) > 0 &&
    venueId.length > 0 &&
    referrerFormatValid &&
    !isSelfReferral &&
    referrerLookupStatus === 'valid' &&
    last4.length === 4 &&
    purchaseTime.trim().length > 0
  );
  $: if (session && venue.trim()) {
    const lockedReferrer = getVenueLockedReferrer(venue);
    if (lockedReferrer) {
      if (lockedReferrer.id !== lockedReferrerId || lockedReferrer.code !== lockedReferrerCode) {
        lockedReferrerId = lockedReferrer.id;
        lockedReferrerCode = lockedReferrer.code;
        void syncLockedReferrer(lockedReferrer);
      }
      isReferrerLocked = true;
      referrerLockedByVenue = true;
    } else if (referrerLockedByVenue) {
      isReferrerLocked = false;
      referrerLockedByVenue = false;
      lockedReferrerId = null;
      lockedReferrerCode = null;
    }
  } else if (referrerLockedByVenue) {
    isReferrerLocked = false;
    referrerLockedByVenue = false;
    lockedReferrerId = null;
    lockedReferrerCode = null;
  }
  $: if (!normalizedReferrerInput.trim() || !referrerFormatValid) {
    if (referrerLookupTimer) {
      clearTimeout(referrerLookupTimer);
      referrerLookupTimer = null;
    }
    referrerLookupStatus = 'idle';
    referrerProfileId = null;
  } else {
    scheduleReferrerLookup(normalizedReferrerInput);
  }

  async function isReferralCodeAvailable(code: string, userId: string): Promise<boolean> {
    const normalized = normalizeReferralCode(code);
    const { data, error } = await supabase.from('profiles').select('id').ilike('referral_code', normalized);
    if (error) throw error;
    if (!data || data.length === 0) return true;
    return data.every((row) => row.id === userId);
  }

  async function lookupReferrerProfile(code: string): Promise<{ id: string; code: string } | null> {
    const normalized = normalizeReferralCode(code);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, referral_code')
      .ilike('referral_code', normalized)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) return null;
    return { id: data.id, code: data.referral_code ?? normalized };
  }

  function scheduleReferrerLookup(code: string) {
    if (referrerLookupTimer) clearTimeout(referrerLookupTimer);
    const requestId = referrerLookupSeq + 1;
    referrerLookupSeq = requestId;
    referrerLookupStatus = 'checking';
    referrerLookupTimer = setTimeout(async () => {
      try {
        const profile = await lookupReferrerProfile(code);
        if (requestId !== referrerLookupSeq) return;
        referrerProfileId = profile?.id ?? null;
        referrerLookupStatus = profile ? 'valid' : 'invalid';
      } catch (error) {
        console.error('Error validating referral code:', error);
        if (requestId !== referrerLookupSeq) return;
        referrerLookupStatus = 'invalid';
        referrerProfileId = null;
      }
    }, 300);
  }

  async function generateUniqueReferralCode(userId: string, email: string): Promise<string> {
    const preferred = buildReferralCodeFromEmail(email);
    if (preferred && isReferralCodeValid(preferred)) {
      if (await isReferralCodeAvailable(preferred, userId)) return preferred;
    }
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
      const generated = await generateUniqueReferralCode(userId, fallbackEmail);
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ referral_code: generated, updated_at: new Date().toISOString() })
        .eq('id', userId);
      if (updateError) throw updateError;
      userRefCode = generated;
    } catch (error) {
      console.error('Error ensuring referral code:', error);
      userRefCode = buildReferralCodeFromEmail(fallbackEmail) || 'member';
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
      await hydrateClaimantCodes(claims);
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

  function shouldShowInstallBanner(): boolean {
    if (typeof window === 'undefined') return false;
    if (!deferredInstallPrompt) return false;
    const seen = localStorage.getItem(installPromptKey);
    return !seen;
  }

  function markInstallPrompted() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(installPromptKey, '1');
    showInstallBanner = false;
  }

  async function handleInstall() {
    if (!deferredInstallPrompt) {
      showInstallBanner = false;
      return;
    }
    deferredInstallPrompt.prompt();
    try {
      const choice = await deferredInstallPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        markInstallPrompted();
      }
    } catch (error) {
      console.error('Install prompt failed:', error);
    } finally {
      deferredInstallPrompt = null;
      showInstallBanner = false;
    }
  }

  function dismissInstall() {
    markInstallPrompted();
    deferredInstallPrompt = null;
  }

  async function hydrateClaimantCodes(claimList: Claim[]) {
    const ids = Array.from(
      new Set(
        claimList
          .map((claim) => claim.submitter_id)
          .filter((id): id is string => Boolean(id))
      )
    );
    if (ids.length === 0) {
      claimantCodes = {};
      return;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, referral_code')
        .in('id', ids);
      if (error) throw error;
      claimantCodes = (data ?? []).reduce<Record<string, string>>((acc, row) => {
        acc[row.id] = row.referral_code ?? '';
        return acc;
      }, {});
    } catch (error) {
      console.error('Error loading claimant codes:', error);
      claimantCodes = {};
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
    const urlParams =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const hasRefOnly = Boolean(urlParams?.get('ref')) && !urlParams?.get('venue') && !urlParams?.get('venue_id');

    const localNow = getLocalNowInputValue();
    purchaseTime = localNow;
    maxPurchaseTime = localNow;

    await fetchVenues();

    const { data } = await supabase.auth.getSession();
    session = data.session;
    userId = session?.user?.id ?? null;

    if (hasRefOnly) {
      if (!session) {
        window.location.href = `/login?${urlParams?.toString() ?? ''}`;
        return;
      }
      showForm = true;
    }

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
        replaceState(
          window.history.state ?? {},
          { [historyViewKey]: showForm ? 'claim' : 'dashboard' },
          window.location.href
        );
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
    if (!normalizedReferrerInput.trim()) {
      status = 'error';
      errorMessage = 'Please enter a referrer';
      return false;
    }
    if (!isReferralCodeValid(normalizedReferrerInput)) {
      status = 'error';
      errorMessage = 'Referrer code must be 4-8 letters or numbers';
      return false;
    }
    if (isSelfReferral) {
      status = 'error';
      errorMessage = 'You cannot use your own referral code';
      return false;
    }
    if (referrerLookupStatus !== 'valid') {
      status = 'error';
      errorMessage = 'Unrecognized referral code';
      return false;
    }
    if (!referrerProfileId) {
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
        referrer: normalizeReferralCode(normalizedReferrerInput) || null,
        referrer_id: referrerProfileId,
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
        replaceState(window.history.state ?? {}, { [historyViewKey]: 'dashboard' }, window.location.href);
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
        if (shouldShowInstallBanner()) {
          showInstallBanner = true;
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
    if (!session?.user?.id || claim.submitter_id !== session.user.id) return;
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

  function openReferModal() {
    showReferModal = true;
    if (typeof window === 'undefined') return;
    const state = window.history.state ?? {};
    if (!state[historyReferKey]) {
      pushState(window.history.state ?? {}, { ...state, [historyReferKey]: true }, window.location.href);
    }
  }

  function closeReferModal() {
    showReferModal = false;
    if (typeof window === 'undefined') return;
    const state = window.history.state ?? {};
    if (state[historyReferKey]) {
      const { [historyReferKey]: _removed, ...rest } = state;
      replaceState(window.history.state ?? {}, rest, window.location.href);
    }
  }

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

  async function getReferrerCodeById(referrerId: string): Promise<string | null> {
    if (referrerCodeCache[referrerId]) {
      return referrerCodeCache[referrerId];
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('referral_code')
      .eq('id', referrerId)
      .maybeSingle();
    if (error) {
      console.error('Error fetching referrer code:', error);
      return null;
    }
    const code = data?.referral_code ?? null;
    if (code) {
      referrerCodeCache = { ...referrerCodeCache, [referrerId]: code };
    }
    return code;
  }

  async function syncLockedReferrer(locked: { id: string | null; code: string | null }) {
    if (locked.id) {
      const requestId = lockedReferrerRequestId + 1;
      lockedReferrerRequestId = requestId;
      const code = (await getReferrerCodeById(locked.id)) ?? locked.code ?? '';
      if (requestId !== lockedReferrerRequestId) return;
      if (code && referrer !== code) referrer = code;
      return;
    }
    if (locked.code && referrer !== locked.code) {
      referrer = locked.code;
    }
  }

  function getVenueLockedReferrer(
    venueName: string
  ): { id: string | null; code: string | null } | null {
    const normalizedVenue = venueName.trim().toLowerCase();
    if (!normalizedVenue) return null;
    const venueIdMatch = getVenueIdByName(venueName);

    let earliestTime = Number.POSITIVE_INFINITY;
    let referrerId: string | null = null;
    let referrerCode: string | null = null;

    for (const claim of claims) {
      if (venueIdMatch) {
        if (claim.venue_id !== venueIdMatch) continue;
      } else if (claim.venue.trim().toLowerCase() !== normalizedVenue) {
        continue;
      }
      if (!claim.referrer && !claim.referrer_id) continue;
      const time = new Date(claim.purchased_at).getTime();
      if (Number.isNaN(time)) continue;
      if (time < earliestTime) {
        earliestTime = time;
        referrerId = claim.referrer_id ?? null;
        referrerCode = claim.referrer ?? null;
      }
    }

    if (!referrerId && !referrerCode) return null;
    return { id: referrerId, code: referrerCode };
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
      pushState(window.history.state ?? {}, { [historyViewKey]: 'claim' }, window.location.href);
    }
    showForm = true;
  }

  function handleFormBack() {
    showForm = false;
    if (session && typeof window !== 'undefined') {
      replaceState(window.history.state ?? {}, { [historyViewKey]: 'dashboard' }, window.location.href);
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
      userId={userId ?? ''}
      claimantCodes={claimantCodes}
      onNewClaim={startNewClaim}
      onDeleteClaim={handleDeleteClaim}
      onLogout={handleSignOut}
      onOpenRefer={openReferModal}
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
      {isSelfReferral}
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
      onClose={closeReferModal}
    />
  {/if}

  {#if showInstallBanner}
    <div class="fixed bottom-28 left-0 right-0 px-6 z-[210] flex justify-center" in:fly={{ y: 80 }}>
      <div class="w-full max-w-sm bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl shadow-black/40 p-4 flex items-center gap-3">
        <div class="flex-1">
          <p class="text-sm font-black uppercase tracking-[0.18em] text-white">Add to Home</p>
          <p class="text-xs text-zinc-400 font-semibold">Install Kickback for faster access.</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            on:click={dismissInstall}
            class="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 hover:text-white transition-colors"
          >
            Later
          </button>
          <button
            type="button"
            on:click={handleInstall}
            class="bg-white text-black font-black px-3 py-2 rounded-xl text-[11px] uppercase tracking-tight active:scale-95 transition-all"
          >
            Install
          </button>
        </div>
      </div>
    </div>
  {/if}
</main>




