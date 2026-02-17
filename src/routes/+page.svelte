<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { pushState, replaceState } from '$app/navigation';
  import type { Session } from '@supabase/supabase-js';
  import { supabase } from '$lib/supabase';
  import { GOAL_DAYS, KICKBACK_RATE, MAX_BILL } from '$lib/claims/constants';
  import {
    calculateKickbackWithRate,
    getDaysAtVenue,
    normalizeAmountInput,
    normalizeLast4,
    parseAmount
  } from '$lib/claims/utils';
  import {
    clearDraftFromStorage,
    draftToQuery,
    getDraftFromStorage,
    getDraftFromUrl,
    saveDraftToStorage
  } from '$lib/claims/draft';
  import {
    deleteClaim,
    fetchClaimsForUser,
    insertClaim,
    upsertProfileLast4
  } from '$lib/claims/repository';
  import type { Claim } from '$lib/claims/types';
  import type { ClaimDraft } from '$lib/claims/types';
  import type { Venue } from '$lib/venues/types';
  import { fetchActiveVenues } from '$lib/venues/repository';
  import {
    buildReferralCodeFromEmail,
    generateReferralCode,
    isReferralCodeValid,
    normalizeReferralCode
  } from '$lib/referrals/code';
  import {
    buildClaimInsert,
    isPurchaseTimeOlderThanMaxAge,
    validateClaimInput
  } from '$lib/claims/submit';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import ClaimForm from '$lib/components/ClaimForm.svelte';
  import Landing from '$lib/components/Landing.svelte';
  import AutoClaimWarningModal from '$lib/components/AutoClaimWarningModal.svelte';
  import ClaimWindowExpiredModal from '$lib/components/ClaimWindowExpiredModal.svelte';
  import GuestWarningModal from '$lib/components/GuestWarningModal.svelte';
  import ReferralModal from '$lib/components/ReferralModal.svelte';
  import PayoutSetupModal from '$lib/components/PayoutSetupModal.svelte';
  import { onDestroy } from 'svelte';

  let last4: string = '';
  let dashboardComponent: Dashboard | null = null;

  function refreshDashboardPayoutProfile() {
    if (dashboardComponent?.loadPayoutProfile) {
      dashboardComponent.loadPayoutProfile();
    }
  }

  let venue = '';
  let venueId = '';
  let referrer = '';
  let purchaseTime = '';
  let maxPurchaseTime = '';
  let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let errorMessage = '';
  let successMessage = '';

  let showReferModal = false;
  let showPayoutSetup = false;
  let showLanding = false;
  let referralPresetVenueId = '';
  let referralPresetVenueName = '';
  let shouldOpenReferFromUrl = false;

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
  let referralEditLocked = false;
  let referralOriginalCode: string | null = null;

  let claims: Claim[] = [];
  let totalPending = 0;
  let highlightClaimKey: string | null = null;
  let claimantCodes: Record<string, string> = {};
  let deferredInstallPrompt: any = null;
  let showInstallBanner = false;
  let showIosInstallModal = false;
  const installPromptKey = 'kickback:install_prompt_shown';
  let installedHandlerAdded = false;
  let autoClaimBanner: { venue: string; daysLeft: number } | null = null;
  let autoClaimBannerTimer: ReturnType<typeof setTimeout> | null = null;
  let canAutosave = false;
  let claimsChannel: any = null;

  let amount: number | null = null;
  let amountInput = '';
  let purchaseTimeTooOld = false;

  let showGuestWarning = false;
  let showAutoClaimWarning = false;
  let autoClaimWarningVenue = '';
  let autoClaimWarningDaysLeft = 0;
  let autoClaimWarningOverride = false;
  let showClaimWindowExpired = false;
  let claimWindowVenue = '';

  let session: Session | null | undefined = undefined;
  let userId: string | null = null;
  let userRefCode = 'member';
  const historyViewKey = 'view';
  const historyReferKey = 'refer';
  const svelteStateKey = 'sveltekit:states';

  function getHistoryState(): Record<string, any> {
    if (typeof window === 'undefined') return {};
    const rawState = window.history.state;
    if (rawState && typeof rawState === 'object' && svelteStateKey in rawState) {
      return (rawState as Record<string, any>)[svelteStateKey] ?? {};
    }
    return (rawState as Record<string, any>) ?? {};
  }

  function mergeDrafts(urlDraft: ClaimDraft | null, storedDraft: ClaimDraft | null): ClaimDraft | null {
    if (!urlDraft && !storedDraft) return null;
    return {
      amount: String(urlDraft?.amount ?? storedDraft?.amount ?? '').trim(),
      venue: String(urlDraft?.venue ?? storedDraft?.venue ?? '').trim(),
      venueId: String(urlDraft?.venueId ?? storedDraft?.venueId ?? '').trim(),
      venueCode: String(urlDraft?.venueCode ?? storedDraft?.venueCode ?? '').trim() || undefined,
      ref: String(urlDraft?.ref ?? storedDraft?.ref ?? '').trim(),
      last4: String(urlDraft?.last4 ?? storedDraft?.last4 ?? '').trim()
    };
  }

  onMount(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state?.[svelteStateKey] ?? event.state ?? {};
      const nextView = state?.[historyViewKey];
      showForm = nextView === 'claim';
      showReferModal = Boolean(state?.[historyReferKey]);
    };
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
    };
    const handleInstalled = () => {
      markInstallPrompted();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handlePopState);
      window.addEventListener('beforeinstallprompt', handleBeforeInstall as EventListener);
      window.addEventListener('appinstalled', handleInstalled);
      installedHandlerAdded = true;
      try {
        const hash = window.location.hash || '';
        if (hash && hash.includes('access_token') && hash.includes('refresh_token')) {
          const params = new URLSearchParams(hash.replace(/^#/, ''));
          const access_token = params.get('access_token') || '';
          const refresh_token = params.get('refresh_token') || '';
          if (access_token && refresh_token) {
            (async () => {
              try {
                await supabase.auth.setSession({ access_token, refresh_token });
              } catch {}
              const clean = window.location.pathname + window.location.search;
              window.history.replaceState(window.history.state, '', clean);
              window.location.replace('/auth/callback?redirect_to=/');
            })();
          }
        }
      } catch {}
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('popstate', handlePopState);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall as EventListener);
        if (installedHandlerAdded) {
          window.removeEventListener('appinstalled', handleInstalled);
        }
      }
    };
  });

  $: amount = parseAmount(amountInput);
  $: venueId = venues?.length ? getVenueIdByName(venue) : '';
  $: kickbackRate = venueId && venues?.length ? getKickbackRate(venueId, session ? 'referrer' : 'guest') : KICKBACK_RATE;
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
  $: if (!session && canAutosave) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const meaningful = Boolean(
          String(amountInput ?? '').trim() ||
          (venue || '').trim() ||
          venueId ||
          (normalizedReferrerInput || '').trim() ||
          (last4 || '').trim()
        );
        if (meaningful) {
          const code = getVenueCodeById(venueId);
          saveDraftToStorage(window.localStorage, {
            amount: String(amountInput ?? ''),
            venue,
            venueId,
            venueCode: code || undefined,
            ref: normalizedReferrerInput,
            last4
          });
        }
      }
    } catch {}
  }
  $: canSubmit = Boolean(
    (amount ?? 0) > 0 &&
    venueId.length > 0 &&
    referrerFormatValid &&
    !isSelfReferral &&
    referrerLookupStatus === 'valid' &&
    last4.length === 4 &&
    purchaseTime.trim().length > 0 &&
    !purchaseTimeTooOld
  );
  $: purchaseTimeTooOld =
    purchaseTime.trim().length > 0 && isPurchaseTimeOlderThanMaxAge(purchaseTime);
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
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .or(`referral_code.ilike.${normalized},referral_code_original.ilike.${normalized}`);
    if (error) throw error;
    if (!data || data.length === 0) return true;
    return data.every((row) => row.id === userId);
  }

  async function lookupReferrerProfile(code: string): Promise<{ id: string; code: string } | null> {
    const normalized = normalizeReferralCode(code);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, referral_code')
      .or(`referral_code.ilike.${normalized},referral_code_original.ilike.${normalized}`)
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
    const baseCode = buildReferralCodeFromEmail(email);
    if (baseCode && isReferralCodeValid(baseCode)) {
      // Try the base code first (e.g., "daniel")
      if (await isReferralCodeAvailable(baseCode, userId)) return baseCode;
      
      // Try numbered variations (e.g., "daniel1", "daniel2", etc.)
      for (let i = 1; i <= 9; i++) {
        const numberedCode = `${baseCode}${i}`;
        if (await isReferralCodeAvailable(numberedCode, userId)) return numberedCode;
      }
    }
    
    // Fallback to random codes
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
        .select('referral_code, referral_code_original, referral_code_updated_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (data?.referral_code) {
        userRefCode = data.referral_code;
        referralOriginalCode = data.referral_code_original ?? null;
        referralEditLocked = Boolean(data.referral_code_updated_at);
        if (!data.referral_code_original) {
          await supabase
            .from('profiles')
            .update({ referral_code_original: data.referral_code })
            .eq('id', userId);
          referralOriginalCode = data.referral_code;
        }
        return;
      }
      const generated = await generateUniqueReferralCode(userId, fallbackEmail);
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          referral_code: generated,
          referral_code_original: generated,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
      if (updateError) throw updateError;
      userRefCode = generated;
      referralOriginalCode = generated;
      referralEditLocked = false;
    } catch (error) {
      console.error('Error ensuring referral code:', error);
      userRefCode = buildReferralCodeFromEmail(fallbackEmail) || 'member';
    }
  }

  async function ensureProfileRow(userId: string) {
    try {
      const { data: existing, error: readError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      if (readError) throw readError;
      if (existing?.id) return;

      const { error } = await supabase
        .from('profiles')
        .insert({ id: userId, notify_payout_confirmation: true, updated_at: new Date().toISOString() });
      if (error) throw error;
    } catch (error) {
      console.error('Error ensuring profile row:', error);
    }
  }


  async function updateReferralCode(code: string): Promise<{ ok: boolean; message?: string; code?: string }> {
    if (!session?.user?.id) return { ok: false, message: 'Sign in to update your code.' };
    const normalized = normalizeReferralCode(code);
    if (!isReferralCodeValid(normalized)) {
      return { ok: false, message: 'Use 4-8 letters or numbers.' };
    }
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('referral_code, referral_code_original, referral_code_updated_at')
        .eq('id', session.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (profile?.referral_code_updated_at) {
        referralEditLocked = true;
        return { ok: false, message: 'You can only update your code once.' };
      }
      const available = await isReferralCodeAvailable(normalized, session.user.id);
      if (!available) return { ok: false, message: 'Code already taken.' };
      const originalCode = profile?.referral_code_original ?? profile?.referral_code ?? userRefCode;
      const { error } = await supabase
        .from('profiles')
        .update({
          referral_code: normalized,
          referral_code_original: originalCode,
          referral_code_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', session.user.id);
      if (error) throw error;
      userRefCode = normalized;
      referrerCodeCache = { ...referrerCodeCache, [session.user.id]: normalized };
      referralOriginalCode = originalCode ?? null;
      referralEditLocked = true;
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
      void hydrateClaimantCodes(claims);
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

  function canPromptInstall(): boolean {
    return typeof window !== 'undefined' && Boolean(deferredInstallPrompt) && !localStorage.getItem(installPromptKey);
  }

  function isStandaloneInstalled(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      ((window.navigator as any)?.standalone === true)
    );
  }

  function isMobileViewport(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia ? window.matchMedia('(max-width: 767px)').matches : false;
  }

  function isIosDevice(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isAppleMobile = /iPhone|iPad|iPod/i.test(ua);
    const isIpadDesktopUA = /Macintosh/i.test(ua) && 'ontouchend' in document;
    return isAppleMobile || isIpadDesktopUA;
  }

  function markInstallPrompted() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(installPromptKey, '1');
    showInstallBanner = false;
  }

  function showAutoClaimNotice(venueName: string, daysLeft: number) {
    autoClaimBanner = { venue: venueName, daysLeft };
    if (autoClaimBannerTimer) clearTimeout(autoClaimBannerTimer);
    autoClaimBannerTimer = setTimeout(() => {
      autoClaimBanner = null;
      autoClaimBannerTimer = null;
    }, 6500);
  }

  onDestroy(() => {
    if (autoClaimBannerTimer) {
      clearTimeout(autoClaimBannerTimer);
      autoClaimBannerTimer = null;
    }
    try {
      if (claimsChannel) {
        supabase.removeChannel(claimsChannel);
        claimsChannel = null;
      }
    } catch {}
  });

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

  function triggerInstallBanner() {
    if (!isMobileViewport() || isStandaloneInstalled()) return;
    if (canPromptInstall()) {
      showInstallBanner = true;
      showIosInstallModal = false;
    } else if (isIosDevice()) {
      showIosInstallModal = true;
    }
  }

  function dismissIosInstallModal() {
    showIosInstallModal = false;
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

  function getAutoClaimDaysLeft(venueIdValue: string, venueName: string): number | null {
    const normalizedName = venueName.trim().toLowerCase();
    if (!normalizedName && !venueIdValue) return null;
    const uid = session?.user?.id ?? null;
    if (!uid) return null;
    const hasActive = claims.some((claim) => {
      if (claim.status === 'denied') return false;
      if (claim.submitter_id !== uid) return false;
      if (venueIdValue) {
        if (claim.venue_id !== venueIdValue) return false;
      } else {
        if (claim.venue.trim().toLowerCase() !== normalizedName) return false;
      }
      return Boolean(claim.square_payment_id);
    });
    if (!hasActive) return null;
    const computedDaysLeft = Math.max(GOAL_DAYS - getDaysAtVenue(claims, venueName), 0);
    return computedDaysLeft > 0 ? computedDaysLeft : null;
  }

  function isClaimWindowExpired(venueIdValue: string, venueName: string): boolean {
    const normalizedName = venueName.trim().toLowerCase();
    if (!normalizedName && !venueIdValue) return false;

    const relevantClaims = claims.filter((claim) => {
      if (claim.status === 'denied') return false;
      if (venueIdValue) return claim.venue_id === venueIdValue;
      return claim.venue.trim().toLowerCase() === normalizedName;
    });

    if (relevantClaims.length === 0) return false;

    const earliestTime = Math.min(
      ...relevantClaims.map((claim) => new Date(claim.purchased_at).getTime()).filter((time) => !Number.isNaN(time))
    );
    if (!Number.isFinite(earliestTime)) return false;

    const diffInDays = Math.floor((Date.now() - earliestTime) / (1000 * 60 * 60 * 24));
    return diffInDays >= GOAL_DAYS;
  }

  async function handleSubmitClaim(): Promise<boolean> {
    if (!session) return submitClaim();
    const venueName = getVenueNameById(venueId) || venue;
    if (isClaimWindowExpired(venueId, venueName)) {
      claimWindowVenue = venueName;
      showClaimWindowExpired = true;
      return false;
    }
    const daysLeft = getAutoClaimDaysLeft(venueId, venueName);
    if (daysLeft && !autoClaimWarningOverride) {
      autoClaimWarningVenue = venueName;
      autoClaimWarningDaysLeft = daysLeft;
      showAutoClaimWarning = true;
      return false;
    }
    return submitClaim();
  }

  async function proceedAutoClaimSubmit() {
    showAutoClaimWarning = false;
    autoClaimWarningOverride = true;
    await submitClaim();
    autoClaimWarningOverride = false;
  }

  function dismissAutoClaimWarning() {
    showAutoClaimWarning = false;
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
    const refParam = urlParams?.get('ref')?.trim() ?? '';
    const venueParam = urlParams?.get('venue')?.trim() ?? '';
    const venueIdParam = urlParams?.get('venue_id')?.trim() ?? '';
    const hasRef = Boolean(refParam);
    const hasVenueParam = Boolean(venueParam || venueIdParam);
    const hasRefAndVenue = hasRef && hasVenueParam;
    const hasVenueOnly = hasVenueParam && !hasRef;
    const hasRefOnly = hasRef && !hasVenueParam;

    const localNow = getLocalNowInputValue();
    purchaseTime = localNow;
    maxPurchaseTime = localNow;

    const venuesPromise = fetchVenues();
    const { data } = await supabase.auth.getSession();
    session = data.session;
    userId = session?.user?.id ?? null;
    if (userId) {
      // Fetch user profile to ensure email is available
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, role')
        .eq('id', userId)
        .maybeSingle();
      
      // If profile doesn't exist, create it
      if (!profile && session?.user?.email) {
        const profilePayload = {
          id: userId,
          email: session.user.email,
          role: 'member',
          notify_payout_confirmation: true,
          updated_at: new Date().toISOString()
        };
        const { error } = await supabase.from('profiles').upsert(profilePayload);
        if (error) {
          console.error('Error creating profile:', error);
        }
      }
      
    }

    if (!session) {
      if (hasVenueOnly) {
        window.location.href = `/login?${urlParams?.toString() ?? ''}`;
        return;
      }
      if (hasRefOnly || hasRefAndVenue) {
        showForm = true;
        showLanding = false;
      } else {
        showForm = false;
        showLanding = true;
      }
    } else {
      if (hasRefAndVenue) {
        showForm = true;
        showLanding = false;
      }
    }

    if (!session && !hasRefAndVenue && !hasVenueOnly && !hasRefOnly) {
      showLanding = true;
      void venuesPromise;
      canAutosave = true;
      return;
    }

    await venuesPromise;

    const venueFromParams = urlParams ? getVenueFromParams(urlParams) : null;
    referralPresetVenueId = venueFromParams?.id ?? venueIdParam ?? '';
    referralPresetVenueName = venueFromParams?.name ?? venueParam ?? '';

    const allowDraft = !hasVenueOnly;
    const urlDraft = allowDraft ? getDraftFromUrl(window.location.search) : null;
    const storedDraft = getDraftFromStorage(localStorage);
    const draft = allowDraft ? mergeDrafts(urlDraft, storedDraft) : null;
    const hasDraft = Boolean(
      draft &&
      (
        String(draft.amount ?? '').trim() ||
        String(draft.venue ?? '').trim() ||
        String(draft.venueId ?? '').trim() ||
        String(draft.venueCode ?? '').trim() ||
        String(draft.ref ?? '').trim() ||
        String(draft.last4 ?? '').trim()
      )
    );

    if (hasDraft && draft) {
      amountInput = String(draft.amount ?? '');
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
      const dashboardLoadPromise = fetchDashboardData();
      const profileBootstrapPromise = (async () => {
        if (!last4) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('last_4')
            .eq('id', session.user.id)
            .maybeSingle();
          if (profile?.last_4) last4 = String(profile.last_4);
        }

        await ensureProfileRow(session.user.id);
        await ensureReferralCode(session.user.id, session.user.email ?? 'member');

        const { data: payoutProfile } = await supabase
          .from('payout_profiles')
          .select('user_id')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (!payoutProfile) {
          showPayoutSetup = true;
        }
      })();

      await dashboardLoadPromise;

      if (shouldOpenReferFromUrl) {
        showReferModal = true;
      }

      if (typeof window !== 'undefined') {
        const state = getHistoryState();
        if (!state[historyViewKey]) {
          replaceState('', { ...state, [historyViewKey]: showForm ? 'claim' : 'dashboard' });
        }
      }
      profileBootstrapPromise.catch((error) => {
        console.error('Profile bootstrap failed:', error);
      });
    }
    canAutosave = true;
  });

  async function submitClaim(): Promise<boolean> {
    const validationError = validateClaimInput({
      amount,
      last4,
      referrerInput: normalizedReferrerInput,
      referrerFormatValid: isReferralCodeValid(normalizedReferrerInput),
      isSelfReferral,
      referrerLookupStatus,
      referrerProfileId,
      venueId,
      purchaseTime
    });
    if (validationError) {
      status = 'error';
      errorMessage = validationError;
      return false;
    }

    const cleanAmount = Number(amount!.toFixed(2));

    status = 'loading';

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        void upsertProfileLast4(user.id, last4).catch((error) => {
          console.error('Error updating last4:', error);
        });
      }

      const createdAt = new Date().toISOString();
      const venueName = getVenueNameById(venueId);
      if (!venueName) {
        status = 'error';
        errorMessage = 'Please select a valid venue';
        return false;
      }

      const rates = getVenueRates(venueId);
      if (session?.user?.id) {
        try {
          const precheckRes = await fetch('/api/square/precheck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              venue_id: venueId,
              amount: cleanAmount,
              last_4: last4,
              purchased_at: purchaseTime,
              submitter_id: session.user.id
            })
          });
          const precheck = await precheckRes.json().catch(() => null);
          if (precheckRes.ok && precheck?.ok && precheck.bound_to_other_user) {
            status = 'error';
            errorMessage = 'This card is already linked to another account at this venue';
            return false;
          }
          if (precheckRes.ok && precheck?.ok && precheck.duplicate) {
            if (precheck.by_same_user) {
              const venueName = getVenueNameById(venueId) || venueId;
              const daysLeft = getAutoClaimDaysLeft(venueId, venueName) ?? 0;
              autoClaimWarningVenue = venueName;
              autoClaimWarningDaysLeft = daysLeft;
              showAutoClaimWarning = true;
              return false;
            }
            status = 'error';
            errorMessage = 'This transaction has already been claimed';
            return false;
          }
        } catch (err) {
          // proceed as pending on any precheck error
        }
      }
      const insertedClaim = await insertClaim(
        buildClaimInsert({
          venueName,
          venueId,
          referrerCode: normalizeReferralCode(normalizedReferrerInput) || null,
          referrerProfileId,
          amount: cleanAmount,
          rates,
          purchaseTime,
          last4,
          createdAt,
          submitterId: session?.user?.id ?? null,
          submitterReferralCode: userRefCode || null
        })
      );
      let linkSquarePromise: Promise<boolean> | null = null;
      if (insertedClaim.id && session?.user?.id) {
        linkSquarePromise = (async () => {
          try {
            const response = await fetch('/api/square/link-claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ claim_id: insertedClaim.id })
            });
            const payload = await response.json().catch(() => null);
            if (response.ok) {
              return Boolean(payload?.linked);
            }
          } catch (error) {
            console.error('Error linking Square payment:', error);
          }
          return false;
        })();
      }
      successMessage = `Submitted ${venue} claim for $${cleanAmount.toFixed(2)}.`;
      status = 'success';
      amountInput = '';
      if (!session) {
        last4 = '';
      }
      if (session) {
        showForm = false;
        if (typeof window !== 'undefined') {
          const state = getHistoryState();
          replaceState('', { ...state, [historyViewKey]: 'dashboard' });
        }
        const existingClaims = insertedClaim.id
          ? claims.filter((claim) => claim.id !== insertedClaim.id)
          : claims;
        claims = [insertedClaim, ...existingClaims].sort(
          (a, b) =>
            new Date(b.purchased_at ?? b.created_at).getTime() -
            new Date(a.purchased_at ?? a.created_at).getTime()
        );
        highlightClaimKey = insertedClaim.id ?? insertedClaim.created_at ?? null;
        if (highlightClaimKey) {
          setTimeout(() => {
            if (highlightClaimKey) highlightClaimKey = null;
          }, 3000);
        }
        if (shouldShowInstallBanner()) {
          showInstallBanner = true;
        }
        status = 'idle';
        successMessage = '';
        void (async () => {
          const linkedSquare = linkSquarePromise ? await linkSquarePromise : false;
          try {
            await fetchDashboardData();
          } catch (error) {
            console.error('Error refreshing dashboard after claim submit:', error);
          }
          const newClaim =
            claims.find((claim) => claim.id && claim.id === insertedClaim.id) ??
            claims.find((claim) => claim.created_at === insertedClaim.created_at);
          if (newClaim) {
            highlightClaimKey = newClaim.id ?? newClaim.created_at ?? null;
          }
          if (linkedSquare) {
            const daysAtVenue = getDaysAtVenue(claims, venueName);
            const daysLeft = Math.max(GOAL_DAYS - daysAtVenue, 0);
            if (daysLeft > 0) {
              showAutoClaimNotice(venueName, daysLeft);
            }
          }
        })();
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
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (error) {
        const fallback = await supabase.auth.signOut();
        if (fallback?.error) {
          console.error('Error logging out:', fallback.error.message);
        }
      }
    } finally {
      if (typeof window !== 'undefined') {
        const clearStorage = (storage: Storage) => {
          const keys = [];
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (key && key.startsWith('sb-')) keys.push(key);
          }
          for (const key of keys) storage.removeItem(key);
        };
        try {
          clearStorage(window.localStorage);
          clearStorage(window.sessionStorage);
        } catch (error) {
          console.error('Error clearing auth storage:', error);
        }
      }
      window.location.replace('/');
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
  $: autoClaimsActive = Boolean(
    getAutoClaimDaysLeft(venueId, getVenueNameById(venueId) || venue)
  );

  function openReferModal() {
    showReferModal = true;
    if (typeof window === 'undefined') return;
    const state = getHistoryState();
    if (!state[historyReferKey]) {
      pushState('', { ...state, [historyReferKey]: true });
    }
  }

  function closeReferModal() {
    showReferModal = false;
    if (typeof window === 'undefined') return;
    const state = getHistoryState();
    if (state[historyReferKey]) {
      const { [historyReferKey]: _removed, ...rest } = state;
      replaceState('', rest);
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

  function getVenueFromParams(params: URLSearchParams): Venue | null {
    const venueIdParam = params.get('venue_id')?.trim() ?? '';
    if (venueIdParam) {
      return venues.find((v) => v.id === venueIdParam) ?? null;
    }
    const venueParam = params.get('venue')?.trim() ?? '';
    if (!venueParam) return null;
    const codeMatch = venues.find(
      (v) => (v.short_code ?? '').toUpperCase() === venueParam.toUpperCase()
    );
    if (codeMatch) return codeMatch;
    const nameMatch = venues.find(
      (v) => v.name.trim().toLowerCase() === venueParam.toLowerCase()
    );
    return nameMatch ?? null;
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

  function getClaimRateForKind(claim: Claim, kind: 'guest' | 'referrer'): number {
    const storedRate = kind === 'guest' ? claim.kickback_guest_rate : claim.kickback_referrer_rate;
    if (storedRate != null) return Number(storedRate) / 100;
    if (claim.venue_id) {
      const venueMatch = venues.find((venueItem) => venueItem.id === claim.venue_id);
      const fallbackRate = kind === 'guest' ? venueMatch?.kickback_guest : venueMatch?.kickback_referrer;
      return Number(fallbackRate ?? 5) / 100;
    }
    const venueMatch = venues.find(
      (venueItem) => venueItem.name.trim().toLowerCase() === claim.venue.trim().toLowerCase()
    );
    const fallbackRate = kind === 'guest' ? venueMatch?.kickback_guest : venueMatch?.kickback_referrer;
    return Number(fallbackRate ?? 5) / 100;
  }

  function calculateTotalPendingWithRates(claimList: Claim[]): number {
    const currentUserId = session?.user?.id ?? userId;
    if (!currentUserId) return 0;
    return claimList.reduce((sum, claim) => {
      if (claim.status === 'denied' || claim.status === 'paidout') return sum;
      const amount = Number(claim.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) return sum;
      let earned = 0;
      if (claim.submitter_id === currentUserId) {
        earned += calculateKickbackWithRate(amount, getClaimRateForKind(claim, 'guest'));
      }
      if (claim.referrer_id === currentUserId) {
        earned += calculateKickbackWithRate(amount, getClaimRateForKind(claim, 'referrer'));
      }
      return sum + earned;
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
    if (lockedReferrer) {
      referrer = lockedReferrer.code ?? '';
      void syncLockedReferrer(lockedReferrer);
    } else {
      referrer = '';
    }
    isVenueLocked = false;
    isReferrerLocked = Boolean(lockedReferrer);
    referrerLockedByVenue = Boolean(lockedReferrer);
    amountInput = '';
    purchaseTime = getLocalNowInputValue();
    maxPurchaseTime = purchaseTime;
    if (session && typeof window !== 'undefined') {
      const state = getHistoryState();
      pushState('', { ...state, [historyViewKey]: 'claim' });
    }
    showForm = true;
  }

  function handleFormBack() {
    showForm = false;
    if (session && typeof window !== 'undefined') {
      const state = getHistoryState();
      replaceState('', { ...state, [historyViewKey]: 'dashboard' });
    }
  }
</script>

<main class="min-h-screen bg-black text-white">
  {#if session === undefined}
    <div class="w-full min-h-screen" aria-hidden="true"></div>
  {:else if !session && showLanding}
    <div class="w-full">
      <Landing />
    </div>
  {:else if session && !showForm}
    <div class="mx-auto w-full max-w-6xl p-6 flex flex-col items-center">
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
        onOpenRefer={openReferModal}
        onLogout={handleSignOut}
      />
    </div>
  {:else}
    <div class="mx-auto w-full max-w-6xl p-6 flex flex-col items-center">
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
        {purchaseTimeTooOld}
        {isVenueLocked}
        {isReferrerLocked}
        autoClaimsActive={autoClaimsActive}
        loginUrl={loginUrl}
        onBack={handleFormBack}
        onSubmit={handleSubmitClaim}
        onConfirmGuest={confirmGuestSubmit}
        onAmountInput={handleInput}
        onAmountHydrate={hydrateAmountInput}
      />
    </div>
    {#if showAutoClaimWarning}
      <AutoClaimWarningModal
        venue={autoClaimWarningVenue || venue}
        daysLeft={autoClaimWarningDaysLeft}
        onProceed={proceedAutoClaimSubmit}
        onDismiss={dismissAutoClaimWarning}
      />
    {/if}
    {#if showGuestWarning}
      <GuestWarningModal
        kickback={kickback}
        kickbackRatePercent={kickbackRatePercent}
        loginUrl={loginUrl}
        onProceed={proceedAsGuest}
      />
    {/if}
    {#if showClaimWindowExpired}
      <ClaimWindowExpiredModal
        venue={claimWindowVenue || venue}
        onDismiss={() => (showClaimWindowExpired = false)}
      />
    {/if}
  {/if}

  {#if showReferModal}
    <ReferralModal
      {venues}
      userRefCode={userRefCode}
      referralEditLocked={referralEditLocked}
      initialVenueId={referralPresetVenueId}
      initialVenueName={referralPresetVenueName}
      onUpdateReferralCode={updateReferralCode}
      onClose={closeReferModal}
    />
  {/if}

  {#if showPayoutSetup && userId}
    <PayoutSetupModal
      userId={userId}
      onSuccess={async () => {
        await fetchDashboardData();
        refreshDashboardPayoutProfile();
      }}
      onClose={() => (showPayoutSetup = false)}
    />
  {/if}

  {#if showIosInstallModal}
    <div class="fixed inset-0 z-[320] flex items-center justify-center px-6">
      <button
        type="button"
        class="absolute inset-0 bg-black/80 backdrop-blur-sm"
        on:click={dismissIosInstallModal}
        aria-label="Close install instructions"
      ></button>
      <div class="relative w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <p class="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Install Kickback</p>
        <p class="mt-3 text-sm font-bold text-white">On iPhone, install from Safari:</p>
        <ol class="mt-3 space-y-2 text-sm text-zinc-300">
          <li>1. Tap the Share button in Safari.</li>
          <li>2. Scroll and tap Add to Home Screen.</li>
          <li>3. Tap Add.</li>
        </ol>
        <button
          type="button"
          on:click={dismissIosInstallModal}
          class="mt-5 w-full rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-zinc-200 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  {/if}

  {#if autoClaimBanner}
    <div class="fixed bottom-36 left-0 right-0 px-6 z-[220] flex justify-center" in:fly={{ y: 80 }}>
      <div class="w-full max-w-sm bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl shadow-black/40 p-4 flex items-center gap-3 text-center">
        <div class="flex-1">
          <p class="text-xs font-black uppercase tracking-[0.2em] text-orange-400">
            {autoClaimBanner.venue} supports auto claims
          </p>
          <p class="text-[11px] font-bold uppercase tracking-widest text-zinc-300 mt-2">
            Any time your card is used at this venue for the next {autoClaimBanner.daysLeft} days,
            you'll automatically receive your kickback.
          </p>
        </div>
        <button
          type="button"
          on:click={() => (autoClaimBanner = null)}
          class="text-zinc-400 hover:text-white transition-colors text-xs font-black tracking-[0.3em]"
          aria-label="Dismiss auto claim notice"
        >
          CLOSE
        </button>
      </div>
    </div>
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
