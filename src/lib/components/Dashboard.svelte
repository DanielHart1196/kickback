<script lang="ts">
  import { fade, fly, slide } from 'svelte/transition';
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { GOAL_DAYS, KICKBACK_RATE } from '$lib/claims/constants';
  import { calculateKickbackWithRate, isClaimDenied } from '$lib/claims/utils';
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
  type PayoutHistoryItem = {
    id: string;
    amount: number;
    currency: string;
    paid_at: string;
    pay_id: string;
    claim_count?: number;
    venue_totals?: { venue: string; total_amount: number }[];
  };
  type HistoryItem =
    | { kind: 'payout'; key: string; timestamp: number; payout: PayoutHistoryItem }
    | { kind: 'claim'; key: string; timestamp: number; claim: Claim };

  let payoutHistory: PayoutHistoryItem[] = [];
  let historyItems: HistoryItem[] = [];
  let filterPayoutsOnly = false;
  let hasClaimFilters = false;
  let filterStatus: Set<'pending' | 'approved' | 'paid' | 'denied'> = new Set();
  let filterReferred: Set<'referrer' | 'direct'> = new Set();
  const statusOptions: Array<'approved' | 'pending' | 'paid' | 'denied'> = ['approved', 'pending', 'paid', 'denied'];
  const referralOptions: Array<'referrer' | 'direct'> = ['referrer', 'direct'];
  let showFilterMenu = false;
  let listContainer: HTMLDivElement | null = null;
  let filterMenuEl: HTMLDivElement | null = null;
  let filterButtonEl: HTMLButtonElement | null = null;
  let referButtonEl: HTMLButtonElement | null = null;
  let showSettings = false;
  let showDeleteWarning = false;
  let deleteStatus: 'idle' | 'loading' | 'error' = 'idle';
  let deleteError = '';
  let payoutPayId = '';
  let payoutFullName = '';
  let payoutDob = '';
  let payoutAddress = '';
  let payoutIsHobbyist = false;
  let payoutHobbyistConfirmedAt: string | null = null;
  let payoutStatus: 'idle' | 'loading' | 'saving' | 'error' | 'success' = 'idle';
  let payoutError = '';
  let payoutMessage = '';
  let lastLoadedUserId: string | null = null;
  let payoutStripeAccountId = '';
  let payoutStripeStatusLoaded = false;
  let payoutStripeAccountStatus: 'pending' | 'verified' | 'rejected' | null = null;
  let payoutStripeAccountLink = '';
  let payoutStripeRequirements: any[] = [];
  const SUPPORT_MESSAGE_MAX_LENGTH = 500;
  let supportMessageInput = '';
  let supportSubmitting = false;
  let supportStatus: 'idle' | 'success' | 'error' = 'idle';
  let supportStatusMessage = '';
  let supportSuccessTimer: ReturnType<typeof setTimeout> | null = null;
  let notifyApprovedClaims = false;
  let notifyPayoutConfirmation = false;
  let isPwaInstalled = false;
  let isMobileScreen = false;
  let authProviderLabel = '';
  let canEditAuthEmail = false;
  let emailEditMode = false;
  let emailDraft = '';
  let emailChangeStatus: 'idle' | 'saving' | 'success' | 'error' = 'idle';
  let emailChangeMessage = '';
  const MIN_PASSWORD_LENGTH = 6;
  let passwordDraft = '';
  let passwordConfirmDraft = '';
  let passwordChangeStatus: 'idle' | 'saving' | 'success' | 'error' = 'idle';
  let passwordChangeMessage = '';
  let showPasswordChange = false;
  let payoutStripeOnboarded = false;
  const notifyEssential = true;
  const REFER_BUTTON_GAP_PX = 32;
  const REFER_BUTTON_HEIGHT_PX = 56;
  const CLAIM_SLOT_HEIGHT_PX = 88;
  const BASE_HISTORY_BOTTOM_PADDING_PX = REFER_BUTTON_HEIGHT_PX + REFER_BUTTON_GAP_PX * 2;
  let filterMenuExtraPaddingPx = 0;
  let historyPaddingBottomPx = BASE_HISTORY_BOTTOM_PADDING_PX;
  let filterMenuWasOpen = false;

  $: if (userId && userId !== lastLoadedUserId) {
    lastLoadedUserId = userId;
  }

  async function ensureProfileEmail() {
    if (!userId || !userEmail) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({ 
          id: userId, 
          email: userEmail,
          updated_at: new Date().toISOString()
        });
      if (error) console.error('Error ensuring profile email:', error);
    } catch (err) {
      console.error('Failed to ensure profile email:', err);
    }
  }

  onMount(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!showFilterMenu) return;
      const target = event.target as Node;
      if (filterMenuEl?.contains(target)) return;
      if (filterButtonEl?.contains(target)) return;
      showFilterMenu = false;
    };
    const updateInstallAvailability = () => {
      if (typeof window === 'undefined') return;
      isMobileScreen = window.matchMedia ? window.matchMedia('(max-width: 767px)').matches : false;
      isPwaInstalled =
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        ((window.navigator as any)?.standalone === true);
    };
    document.addEventListener('click', handleOutsideClick);
    if (typeof window !== 'undefined') {
      try {
        updateInstallAvailability();
        window.addEventListener('appinstalled', updateInstallAvailability);
        window.addEventListener('resize', updateInstallAvailability);
      } catch {}
      const hash = window.location.hash || '';
      /*
      if (hash && /payouts/i.test(hash)) {
        openSettings();
        if (/connected/i.test(hash)) {
          payoutMessage = 'Stripe connected';
          try {
            const localId = localStorage.getItem('stripe_account_id') || '';
            if (localId) {
              payoutStripeAccountId = localId;
            }
          } catch {}
          setTimeout(() => {
            if (payoutMessage) payoutMessage = '';
          }, 4000);
        }
        const cleanUrl = window.location.pathname + window.location.search;
        window.history.replaceState(window.history.state, '', cleanUrl);
      }
      */
      supabase.auth.getSession().then(({ data }) => {
        const session = data?.session;
        let provider: string =
          (session?.user as any)?.app_metadata?.provider ??
          ((session?.user as any)?.identities?.[0]?.provider ?? '');
        provider = String(provider || '').toLowerCase();
        canEditAuthEmail = provider === 'email';
        if (provider === 'email') {
          authProviderLabel = 'Signed in with Email';
        } else if (provider) {
          authProviderLabel = 'Signed up with ' + (provider.charAt(0).toUpperCase() + provider.slice(1));
        } else {
          authProviderLabel = 'Signed up';
        }
        if (session?.access_token) {
          void loadPayoutHistory(session.access_token);
        }
      });
    }
    return () => {
      document.removeEventListener('click', handleOutsideClick);
      if (typeof window !== 'undefined') {
        window.removeEventListener('appinstalled', updateInstallAvailability);
        window.removeEventListener('resize', updateInstallAvailability);
      }
    };
  });

  async function loadPayoutHistory(token: string) {
    try {
      const response = await fetch('/api/payouts/history', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        payoutHistory = [];
        return;
      }
      payoutHistory = Array.isArray(payload?.payouts) ? payload.payouts : [];
    } catch {
      payoutHistory = [];
    }
  }

  

  function openSettings() {
    showSettings = true;
    loadPayoutProfileInternal();
  }
  function closeSettings() {
    showSettings = false;
  }

  async function loadPayoutProfileInternal() {
    if (!userId) return;
    payoutStatus = 'loading';
    payoutError = '';
    payoutMessage = '';
    payoutStripeStatusLoaded = false;
    try {
      // Load payout profile data
      const { data: payoutData, error: payoutErrorData } = await supabase
        .from('payout_profiles')
        .select('pay_id, full_name, dob, address, is_hobbyist, hobbyist_confirmed_at')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (payoutErrorData) throw payoutErrorData;
      
      payoutPayId = payoutData?.pay_id ?? '';
      payoutFullName = payoutData?.full_name ?? '';
      payoutDob = payoutData?.dob ?? '';
      payoutAddress = payoutData?.address ?? '';
      payoutIsHobbyist = payoutData?.is_hobbyist ?? false;
      payoutHobbyistConfirmedAt = payoutData?.hobbyist_confirmed_at ?? null;

      // Load notification preferences from profiles
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('notify_approved_claims, notify_payout_confirmation')
        .eq('id', userId)
        .maybeSingle();
      
      if (profileError) {
        console.error('Error loading profile notifications:', profileError);
      }
      if (!profileError && profileData) {
        notifyApprovedClaims = profileData.notify_approved_claims ?? false;
        notifyPayoutConfirmation = profileData.notify_payout_confirmation ?? false;
      }

      payoutStripeAccountId = '';
      /*
      try {
        const localId = typeof window !== 'undefined' ? localStorage.getItem('stripe_account_id') || '' : '';
        if (!payoutStripeAccountId && localId) {
          payoutStripeAccountId = localId;
          await supabase
            .from('payout_profiles')
            .upsert(
              { user_id: userId, stripe_account_id: payoutStripeAccountId, updated_at: new Date().toISOString() },
              { onConflict: 'user_id' }
            );
        }
      } catch {}
      */
      /*
      try {
        const statusRes = await fetch('/api/stripe/connect/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId })
        });
        const statusPayload = await statusRes.json().catch(() => null);
        if (statusRes.ok && statusPayload?.ok) {
          if (!payoutStripeAccountId && statusPayload?.account_id) {
            payoutStripeAccountId = statusPayload.account_id || '';
          }
          payoutStripeOnboarded = Boolean(statusPayload?.onboarded);
        }
        payoutStripeStatusLoaded = true;
      } catch {
        payoutStripeStatusLoaded = true;
      }
      */
      payoutStatus = 'idle';
    } catch (error) {
      payoutStatus = 'idle';
    }
  }

  async function saveNotificationPreferences() {
    if (!userId) return;
    try {
      const profilePayload = {
        id: userId,
        notify_approved_claims: notifyApprovedClaims,
        notify_payout_confirmation: notifyPayoutConfirmation,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('profiles').upsert(profilePayload, { onConflict: 'id' });
      if (error) {
        console.error('Error saving notification preferences:', error);
      }
    } catch (err) {
      console.error('Failed to save notification preferences:', err);
    }
  }

  function beginEmailEdit() {
    emailDraft = String(userEmail || '').trim();
    emailChangeStatus = 'idle';
    emailChangeMessage = '';
    emailEditMode = true;
  }

  function cancelEmailEdit() {
    emailEditMode = false;
    emailChangeStatus = 'idle';
    emailChangeMessage = '';
  }

  async function saveEmailChange() {
    const nextEmail = String(emailDraft || '').trim().toLowerCase();
    const currentEmail = String(userEmail || '').trim().toLowerCase();
    if (!nextEmail) {
      emailChangeStatus = 'error';
      emailChangeMessage = 'Enter an email address.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      emailChangeStatus = 'error';
      emailChangeMessage = 'Enter a valid email address.';
      return;
    }
    if (nextEmail === currentEmail) {
      emailChangeStatus = 'error';
      emailChangeMessage = 'Use a different email address.';
      return;
    }

    emailChangeStatus = 'saving';
    emailChangeMessage = '';
    try {
      const { error } = await supabase.auth.updateUser({ email: nextEmail });
      if (error) throw error;
      emailChangeStatus = 'success';
      emailChangeMessage = 'Check your inbox to confirm your new email.';
      emailEditMode = false;
    } catch (error) {
      emailChangeStatus = 'error';
      emailChangeMessage = error instanceof Error ? error.message : 'Failed to update email.';
    }
  }

  async function savePasswordChange() {
    if (!passwordDraft) {
      passwordChangeStatus = 'error';
      passwordChangeMessage = 'Enter a new password.';
      return;
    }
    if (passwordDraft.length < MIN_PASSWORD_LENGTH) {
      passwordChangeStatus = 'error';
      passwordChangeMessage = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
      return;
    }
    if (passwordDraft !== passwordConfirmDraft) {
      passwordChangeStatus = 'error';
      passwordChangeMessage = 'Passwords do not match.';
      return;
    }

    passwordChangeStatus = 'saving';
    passwordChangeMessage = '';
    try {
      const { error } = await supabase.auth.updateUser({ password: passwordDraft });
      if (error) throw error;
      passwordChangeStatus = 'success';
      passwordChangeMessage = 'Password updated.';
      passwordDraft = '';
      passwordConfirmDraft = '';
    } catch (error) {
      passwordChangeStatus = 'error';
      passwordChangeMessage = error instanceof Error ? error.message : 'Failed to update password.';
    }
  }

  function togglePasswordChange() {
    showPasswordChange = !showPasswordChange;
    if (!showPasswordChange) {
      passwordDraft = '';
      passwordConfirmDraft = '';
      passwordChangeStatus = 'idle';
      passwordChangeMessage = '';
    }
  }

  async function savePayoutProfile() {
    if (!userId) {
      console.warn('savePayoutProfile: No userId available');
      return;
    }
    
    if (payoutIsHobbyist && !payoutHobbyistConfirmedAt) {
      payoutHobbyistConfirmedAt = new Date().toISOString();
    } else if (!payoutIsHobbyist) {
      payoutHobbyistConfirmedAt = null;
    }

    payoutStatus = 'saving';
    payoutError = '';
    payoutMessage = '';
    try {
      const trimmedPayId = payoutPayId.trim();

      if (trimmedPayId) {
        // Check if pay_id is already used by another user
        const { data: existing, error: checkError } = await supabase
          .from('payout_profiles')
          .select('user_id')
          .eq('pay_id', trimmedPayId)
          .neq('user_id', userId)
          .maybeSingle();

        if (checkError) throw checkError;
        if (existing) {
          throw new Error('This PayID is already registered to another user');
        }
      }

      const payoutPayload = {
        user_id: userId,
        pay_id: trimmedPayId || null,
        full_name: payoutFullName.trim() || null,
        dob: payoutDob || null,
        address: payoutAddress.trim() || null,
        is_hobbyist: payoutIsHobbyist,
        hobbyist_confirmed_at: payoutHobbyistConfirmedAt,
        stripe_account_id: payoutStripeAccountId || null,
        updated_at: new Date().toISOString()
      };
      
      const { error: payoutErr } = await supabase.from('payout_profiles').upsert(payoutPayload, { onConflict: 'user_id' });
      if (payoutErr) throw payoutErr;

      payoutStatus = 'success';
      payoutMessage = 'Payout details saved';
      setTimeout(() => {
        if (payoutStatus === 'success') {
          payoutStatus = 'idle';
          payoutMessage = '';
        }
      }, 3000);
    } catch (error: any) {
      payoutStatus = 'error';
      if (error?.code === '23505') {
        payoutError = 'This PayID is already registered to another user';
      } else {
        payoutError = error instanceof Error ? error.message : 'Failed to save payout details.';
      }
    }
  }

  async function sendSupportMessage() {
    const message = String(supportMessageInput || '').trim();
    const email = String(userEmail || '').trim();
    if (!message) return;
    if (message.length > SUPPORT_MESSAGE_MAX_LENGTH) {
      supportStatus = 'error';
      supportStatusMessage = `Message must be ${SUPPORT_MESSAGE_MAX_LENGTH} characters or fewer.`;
      return;
    }
    if (!email) {
      supportStatus = 'error';
      supportStatusMessage = 'Signed-in email is required.';
      return;
    }

    supportSubmitting = true;
    if (supportSuccessTimer) {
      clearTimeout(supportSuccessTimer);
      supportSuccessTimer = null;
    }
    supportStatus = 'idle';
    supportStatusMessage = '';
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          venue: 'User Dashboard',
          message
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message ?? 'Failed to send support message');
      }
      supportStatus = 'success';
      supportStatusMessage = 'thanks - message received';
      supportMessageInput = '';
      supportSuccessTimer = setTimeout(() => {
        if (supportStatus === 'success') {
          supportStatus = 'idle';
          supportStatusMessage = '';
        }
        supportSuccessTimer = null;
      }, 3000);
    } catch (error) {
      supportStatus = 'error';
      supportStatusMessage = error instanceof Error ? error.message : 'Failed to send support message';
    } finally {
      supportSubmitting = false;
    }
  }

  function handleSupportMessageInput(event: Event & { currentTarget: HTMLTextAreaElement }) {
    const next = String(event.currentTarget.value ?? '');
    supportMessageInput = next.slice(0, SUPPORT_MESSAGE_MAX_LENGTH);
    if (supportStatus !== 'idle') {
      supportStatus = 'idle';
      supportStatusMessage = '';
    }
    if (supportSuccessTimer) {
      clearTimeout(supportSuccessTimer);
      supportSuccessTimer = null;
    }
  }

  /*
  async function connectStripe() {
    if (!userId) return;
    try {
      payoutStatus = 'loading';
      const response = await fetch('/api/stripe/connect/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          email: userEmail
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.url) {
        payoutStatus = 'error';
        payoutError = payload?.error ?? 'Failed to start Stripe Connect.';
        return;
      }
      try {
        if (typeof window !== 'undefined' && payload.account_id) {
          localStorage.setItem('stripe_account_id', payload.account_id);
        }
      } catch {}
      window.location.href = payload.url;
    } catch (error) {
      payoutStatus = 'error';
      payoutError = error instanceof Error ? error.message : 'Failed to start Stripe Connect.';
    }
  }

  async function openStripeDashboard() {
    if (!payoutStripeAccountId) return;
    try {
      payoutStatus = 'loading';
      const response = await fetch('/api/stripe/connect/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId
        })
      });
      const payload = await response.json().catch(() => null);
      payoutStatus = 'idle';
      if (!response.ok || !payload?.ok || !payload?.url) {
        payoutError = payload?.error ?? 'Failed to open Stripe dashboard.';
        return;
      }
      window.open(payload.url, '_blank');
    } catch (error) {
      payoutStatus = 'error';
      payoutError = error instanceof Error ? error.message : 'Failed to open Stripe dashboard.';
    }
  }
  */

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
      window.location.href = '/';
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

  function getVenueRate(claim: Claim, kind: 'guest' | 'referrer'): number {
    const fallback = KICKBACK_RATE * 100;
    if (claim.venue_id) {
      const venue = venues.find((v) => v.id === claim.venue_id);
      const rate = kind === 'guest' ? venue?.kickback_guest ?? fallback : venue?.kickback_referrer ?? fallback;
      return Number(rate) / 100;
    }
    const normalizedName = claim.venue.trim().toLowerCase();
    const venue = venues.find((v) => v.name.trim().toLowerCase() === normalizedName);
    const rate = kind === 'guest' ? venue?.kickback_guest ?? fallback : venue?.kickback_referrer ?? fallback;
    return Number(rate) / 100;
  }

  function getClaimRateForKind(claim: Claim, kind: 'guest' | 'referrer'): number {
    const storedRate = kind === 'guest' ? claim.kickback_guest_rate : claim.kickback_referrer_rate;
    if (storedRate != null) return Number(storedRate) / 100;
    return getVenueRate(claim, kind);
  }

  function getKickbackForClaim(claim: Claim): number {
    if (isClaimDenied(claim)) return 0;
    const amount = Number(claim.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    let total = 0;
    if (claim.submitter_id === userId) {
      total += calculateKickbackWithRate(amount, getClaimRateForKind(claim, 'guest'));
    }
    if (claim.referrer_id === userId) {
      total += calculateKickbackWithRate(amount, getClaimRateForKind(claim, 'referrer'));
    }
    return Number(total.toFixed(2));
  }

  function getTotalKickbackAtVenue(venueName: string, claim: Claim): number {
    const isDirectClaim = claim.submitter_id === userId;
    const isReferrerClaim = claim.referrer_id === userId;

    return claims.reduce((sum, c) => {
      if (isClaimDenied(c)) return sum;
      if (c.venue.trim().toLowerCase() !== venueName.trim().toLowerCase()) return sum;

      // For direct claims: include all claims at venue where user is submitter OR referrer
      if (isDirectClaim) {
        const isUserSubmitter = c.submitter_id === userId;
        const isUserReferrer = c.referrer_id === userId;

        if (!isUserSubmitter && !isUserReferrer) return sum;

        return sum + getKickbackForClaim(c);
      }

      // For referrer claims: only include claims from this specific submitter where user is referrer
      if (isReferrerClaim) {
        if (c.submitter_id !== claim.submitter_id || c.referrer_id !== userId) return sum;
        return sum + getKickbackForClaim(c);
      }

      return sum;
    }, 0);
  }

  function getDaysLeftAtVenueForUser(venueName: string, submitterId: string | undefined): number {
    if (!submitterId) return GOAL_DAYS;

    const normalizedVenue = venueName.trim().toLowerCase();
    const userVenueClaims = claims.filter((c) => {
      if (isClaimDenied(c)) return false;
      if (c.submitter_id !== submitterId) return false;
      return c.venue.trim().toLowerCase() === normalizedVenue;
    });

    if (userVenueClaims.length === 0) return GOAL_DAYS;

    const firstClaimAt = Math.min(
      ...userVenueClaims.map((c) => new Date(c.purchased_at).getTime()).filter((time) => Number.isFinite(time))
    );
    if (!Number.isFinite(firstClaimAt)) return GOAL_DAYS;

    const diffInDays = Math.floor((Date.now() - firstClaimAt) / (1000 * 60 * 60 * 24));
    return Math.max(GOAL_DAYS - diffInDays, 0);
  }

  function getProgressPercentAtVenueForUser(venueName: string, submitterId: string | undefined): number {
    const daysLeft = getDaysLeftAtVenueForUser(venueName, submitterId);
    const elapsedDays = Math.min(Math.max(GOAL_DAYS - daysLeft, 0), GOAL_DAYS);
    return (elapsedDays / GOAL_DAYS) * 100;
  }

  function getClaimStatus(claim: Claim): 'pending' | 'approved' | 'paid' | 'guestpaid' | 'refpaid' | 'paidout' | 'denied' {
    return (claim.status as any) ?? 'approved';
  }

  function getDisplayStatus(claim: Claim): 'pending' | 'approved' | 'paid' | 'denied' {
    const status = getClaimStatus(claim);
    if (status === 'paidout' || status === 'guestpaid' || status === 'refpaid') return 'paid';
    return status;
  }

  function getStatusTotal(status: 'pending' | 'approved'): number {
    return claims.reduce((sum, claim) => {
      const claimStatus = getClaimStatus(claim);
      if (status === 'pending' && claimStatus !== 'pending') return sum;
      if (status === 'approved' && !(claimStatus === 'approved' || claimStatus === 'paid' || claimStatus === 'guestpaid' || claimStatus === 'refpaid' || claimStatus === 'paidout')) return sum;
      return sum + getKickbackForClaim(claim);
    }, 0);
  }

  $: {
    claims;
    venues;
    pendingTotal = getStatusTotal('pending');
    approvedTotal = getStatusTotal('approved');
  }
  $: filteredClaims = claims.filter((claim) => {
    const status = getDisplayStatus(claim);
    const isReferred = Boolean(claim.referrer_id && claim.referrer_id === userId);
    const statusOk = filterStatus.size === 0 || filterStatus.has(status);
    const referredOk =
      filterReferred.size === 0 ||
      (filterReferred.has('referrer') && isReferred) ||
      (filterReferred.has('direct') && !isReferred);
    return statusOk && referredOk;
  });
  $: hasClaimFilters = filterStatus.size > 0 || filterReferred.size > 0;
  $: historyPaddingBottomPx =
    BASE_HISTORY_BOTTOM_PADDING_PX + (showFilterMenu ? filterMenuExtraPaddingPx : 0);
  $: if (showFilterMenu && !filterMenuWasOpen) {
    filterMenuWasOpen = true;
    void ensureFilterMenuClearance(true);
  }
  $: if (showFilterMenu) {
    filteredClaims.length;
    filterPayoutsOnly;
    void ensureFilterMenuClearance(false);
  }
  $: if (!showFilterMenu && filterMenuWasOpen) {
    filterMenuWasOpen = false;
    filterMenuExtraPaddingPx = 0;
  }
  $: historyItems = [
    ...(
      filterPayoutsOnly || !hasClaimFilters
        ? payoutHistory.map((payout) => ({
            kind: 'payout' as const,
            key: `payout:${payout.id}`,
            timestamp: new Date(payout.paid_at).getTime(),
            payout
          }))
        : []
    ),
    ...(filterPayoutsOnly
      ? []
      : filteredClaims.map((claim) => ({
          kind: 'claim' as const,
          key: `claim:${claim.id ?? claim.created_at}`,
          timestamp: new Date(claim.purchased_at).getTime(),
          claim
        })))
  ].sort((a, b) => {
    const at = Number.isFinite(a.timestamp) ? a.timestamp : 0;
    const bt = Number.isFinite(b.timestamp) ? b.timestamp : 0;
    return bt - at;
  });


  function getStatusBadgeClass(status: 'pending' | 'approved' | 'paid' | 'denied'): string {
    if (status === 'approved') return 'border-green-500/30 bg-green-500/10 text-green-400';
    if (status === 'paid') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
    if (status === 'denied') return 'border-red-500/30 bg-red-500/10 text-red-400';
    return 'border-zinc-700 bg-zinc-800 text-zinc-300';
  }

  async function ensureFilterMenuClearance(allowScroll: boolean) {
    if (typeof window === 'undefined') return;
    await tick();
    if (!showFilterMenu || !filterMenuEl || !referButtonEl) {
      if (filterMenuExtraPaddingPx !== 0) filterMenuExtraPaddingPx = 0;
      return;
    }

    const visibleClaimCount = filterPayoutsOnly ? 0 : filteredClaims.length;
    const cappedClaimCount = Math.min(visibleClaimCount, 4);
    if (cappedClaimCount >= 4) {
      if (filterMenuExtraPaddingPx !== 0) filterMenuExtraPaddingPx = 0;
    } else {
      const popupHeight = filterMenuEl.offsetHeight;
      const requiredExtraPadding = Math.max(
        0,
        Math.ceil(popupHeight + REFER_BUTTON_GAP_PX - cappedClaimCount * CLAIM_SLOT_HEIGHT_PX)
      );
      if (requiredExtraPadding !== filterMenuExtraPaddingPx) {
        filterMenuExtraPaddingPx = requiredExtraPadding;
        await tick();
      }
    }

    if (!allowScroll) return;
    const menuBottom = filterMenuEl.getBoundingClientRect().bottom;
    const referTop = referButtonEl.getBoundingClientRect().top;
    const targetMenuBottom = referTop - REFER_BUTTON_GAP_PX;
    const overlap = menuBottom - targetMenuBottom;
    if (overlap > 0) {
      const postPadScrollable =
        document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      if (postPadScrollable > 0) {
        window.scrollBy({ top: Math.min(overlap + 4, postPadScrollable), behavior: 'auto' });
      }
    }
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
      <span class="kickback-wordmark"><span class="text-white">Kick</span><span class="text-orange-500">back</span></span>
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
          <span class="block mt-2">Payouts every Wednesday</span>
        </span>
      </span>
    </p>
    <div class="flex items-center justify-center gap-3">
      <h2 class="text-6xl font-black tracking-normal text-green-500">${totalPending.toFixed(2)}</h2>
    </div>
  </div>

  <button 
    on:click={onNewClaim}
    class="w-full bg-white text-black font-black py-5 rounded-[2rem] text-xl uppercase tracking-tight shadow-xl shadow-white/5 active:scale-95 transition-all"
  >
    + New Claim
  </button>

  <div
    class="space-y-4 mt-12"
    style={`padding-bottom: calc(${historyPaddingBottomPx}px + env(safe-area-inset-bottom));`}
    bind:this={listContainer}
  >
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
        {filterPayoutsOnly ? `${payoutHistory.length} Payouts` : `${filteredClaims.length} Claims`}
        <svg viewBox="0 0 24 24" aria-hidden="true" class={`h-4 w-4 transition-transform ${showFilterMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {#if showFilterMenu}
        <div bind:this={filterMenuEl} class="absolute right-0 top-full mt-2 w-56 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-3 space-y-3 z-10">
          <div>
            <div class="flex flex-col gap-2">
              <button
                type="button"
                class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${filterPayoutsOnly ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                on:click={() => {
                  const nextValue = !filterPayoutsOnly;
                  filterPayoutsOnly = nextValue;
                  if (nextValue) {
                    filterStatus = new Set();
                    filterReferred = new Set();
                  }
                }}
              >
                Payouts
              </button>
            </div>
          </div>
          <div>
            <p class="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500 mb-2">Status</p>
            <div class="flex flex-col gap-2">
              {#each statusOptions as status}
                {#if status === 'approved'}
                  <button
                    type="button"
                    class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${filterStatus.has(status) ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                    on:click={() => {
                      if (filterPayoutsOnly) filterPayoutsOnly = false;
                      const next = new Set(filterStatus);
                      if (next.has(status)) {
                        next.delete(status);
                      } else {
                        next.add(status);
                      }
                      filterStatus = next;
                    }}
                  >
                    APPROVED
                  </button>
                {:else if status === 'pending'}
                  <button
                    type="button"
                    class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${filterStatus.has(status) ? 'border-zinc-700 bg-zinc-800 text-zinc-200' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                    on:click={() => {
                      if (filterPayoutsOnly) filterPayoutsOnly = false;
                      const next = new Set(filterStatus);
                      if (next.has(status)) {
                        next.delete(status);
                      } else {
                        next.add(status);
                      }
                      filterStatus = next;
                    }}
                  >
                    PENDING
                  </button>
                {:else if status === 'paid'}
                  <button
                    type="button"
                    class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${filterStatus.has(status) ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                    on:click={() => {
                      if (filterPayoutsOnly) filterPayoutsOnly = false;
                      const next = new Set(filterStatus);
                      if (next.has(status)) {
                        next.delete(status);
                      } else {
                        next.add(status);
                      }
                      filterStatus = next;
                    }}
                  >
                    PAID
                  </button>
                {:else}
                  <button
                    type="button"
                    class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${filterStatus.has(status) ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                    on:click={() => {
                      if (filterPayoutsOnly) filterPayoutsOnly = false;
                      const next = new Set(filterStatus);
                      if (next.has(status)) {
                        next.delete(status);
                      } else {
                        next.add(status);
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
              {#each referralOptions as kind}
                <button
                  type="button"
                  class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${
                    kind === 'referrer'
                      ? filterReferred.has(kind)
                        ? 'border-orange-400/60 bg-orange-500/15 text-orange-300'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                      : filterReferred.has(kind)
                        ? 'border-zinc-600 bg-zinc-800 text-zinc-200'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                  }`}
                  on:click={() => {
                    if (filterPayoutsOnly) filterPayoutsOnly = false;
                    const next = new Set(filterReferred);
                    if (next.has(kind)) {
                      next.delete(kind);
                    } else {
                      next.add(kind);
                    }
                    filterReferred = next;
                  }}
                >
                  {kind === 'referrer' ? 'Referrer' : 'Direct'}
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>

    {#if historyItems.length === 0}
      <div class="py-12 text-center border-2 border-dashed border-zinc-900 rounded-[2rem]" transition:fade|local={{ duration: 180 }}>
        <p class="text-zinc-600 text-xs font-bold uppercase tracking-widest">No activity yet</p>
      </div>
    {/if}
    {#each historyItems as item (item.key)}
      {#if item.kind === 'payout'}
        <div transition:slide|local={{ duration: 220 }}>
          <details class="group bg-zinc-900/20 border border-zinc-900 rounded-2xl overflow-hidden">
            <summary class="list-none p-5 flex items-center justify-between gap-4 cursor-pointer active:bg-zinc-900/50">
              <div class="flex items-center justify-between flex-1 gap-4">
                <div class="flex flex-col justify-center">
                  <p class="text-xl font-black uppercase tracking-widest text-[#0D9CFF]">
                    ${Number(item.payout.amount ?? 0).toFixed(2)}
                  </p>
                  <p class="text-zinc-300 uppercase tracking-tight text-sm font-bold">Payout</p>
                </div>
                <div class="flex items-center">
                  <p class="text-zinc-500 text-sm font-bold whitespace-nowrap">
                    {new Date(item.payout.paid_at).toLocaleDateString()} {new Date(item.payout.paid_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <div class="text-zinc-600 group-open:rotate-180 transition-transform">
                <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
            </summary>

            <div class="px-5 pb-6 pt-2 space-y-4">
              <div class="grid grid-cols-1 gap-3 pt-2 border-t border-zinc-800/50">
                <div class="flex items-center justify-between">
                  <p class="text-xs font-black text-zinc-400 uppercase">PayID</p>
                  <p class="text-sm font-bold text-white">{item.payout.pay_id || 'Not set'}</p>
                </div>
                <div class="flex items-center justify-between">
                  <p class="text-xs font-black text-zinc-400 uppercase">Total Claims</p>
                  <p class="text-sm font-bold text-white">{Number(item.payout.claim_count ?? 0)}</p>
                </div>
                <div class="flex items-center justify-between">
                  <p class="text-xs font-black text-zinc-400 uppercase">Total Payout</p>
                  <p class="text-sm font-bold text-[#0D9CFF]">${Number(item.payout.amount ?? 0).toFixed(2)} {String(item.payout.currency ?? 'aud').toUpperCase()}</p>
                </div>
              </div>

              <div class="pt-2 border-t border-zinc-800/50">
                <p class="text-xs font-black text-zinc-400 uppercase mb-2">Amount by Venue</p>
                {#if item.payout.venue_totals && item.payout.venue_totals.length > 0}
                  <div class="space-y-1">
                    {#each item.payout.venue_totals as venueRow}
                      <div class="flex items-center justify-between text-sm">
                        <span class="text-zinc-300 uppercase tracking-tight">{venueRow.venue}</span>
                        <span class="font-bold text-white">${Number(venueRow.total_amount ?? 0).toFixed(2)}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-sm text-zinc-500">No venue breakdown.</p>
                {/if}
              </div>
            </div>
          </details>
        </div>
      {:else}
        {@const claim = item.claim}
      <div transition:slide|local={{ duration: 220 }}>
        <details
          class={`group bg-zinc-900/20 border border-zinc-900 rounded-2xl overflow-hidden transition-[border-color,box-shadow] duration-1000 ease-out ${
            (claim.id ?? claim.created_at) === highlightClaimKey
              ? 'border-orange-500/70 shadow-lg shadow-orange-500/20'
              : ''
          }`}
          data-claim-key={claim.id ?? claim.created_at}
        >
        <summary class="list-none p-5 flex items-center justify-between gap-4 cursor-pointer active:bg-zinc-900/50">
            <div class="flex items-center justify-between flex-1 gap-4">
              <div class="flex flex-col justify-center">
              <p class={`text-xl font-black uppercase tracking-widest ${isClaimDenied(claim) ? 'text-zinc-500' : 'text-green-500'}`}>
                +${getKickbackForClaim(claim).toFixed(2)}
              </p>
              {#if claim.referrer_id && claim.referrer_id === userId}
                <p class="text-zinc-300 uppercase tracking-tight text-sm font-bold">
                  {claimantCodes[claim.submitter_id ?? ''] || claim.referrer || 'Referral'}
                  <span class="ml-1 text-orange-400 font-black uppercase tracking-widest">
                    +${getKickbackForClaim(claim).toFixed(2)}
                  </span>
                </p>
              {:else}
                <p class="text-zinc-300 uppercase tracking-tight text-sm font-bold">{claim.venue}</p>
              {/if}
              </div>
            <div class="flex flex-col items-end gap-1">
            <div class="flex items-center gap-2 shrink-0">
              <p class="text-zinc-500 text-sm font-bold whitespace-nowrap">
                {new Date(claim.purchased_at).toLocaleDateString()} {new Date(claim.purchased_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <div class="flex items-center gap-2">
              {#if claim.referrer_id && claim.referrer_id === userId}
                <span class="border rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border-orange-500/30 bg-orange-500/10 text-orange-400">
                  REFERRER
                </span>
              {/if}
              <span class={`border rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${getStatusBadgeClass(getDisplayStatus(claim))}`}>
                {getDisplayStatus(claim).toUpperCase()}
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
            <div class="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              {#if claim.referrer_id && claim.referrer_id === userId}
                <p class="text-sm font-black uppercase tracking-widest text-zinc-400">Total kickback at {claim.venue} from {claimantCodes[claim.submitter_id ?? ''] || claim.referrer || 'Referral'}</p>
              {:else}
                <p class="text-sm font-black uppercase tracking-widest text-zinc-400">Total kickback at {claim.venue}</p>
              {/if}
              <p class="text-base font-black text-orange-500">
                ${getTotalKickbackAtVenue(claim.venue, claim).toFixed(2)}
              </p>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-sm font-black uppercase text-zinc-400 tracking-widest">30-day progress</p>
              <p class="text-sm font-black text-white">
                {getDaysLeftAtVenueForUser(claim.venue, claim.submitter_id ?? undefined)} DAYS LEFT
              </p>
            </div>
            <div class="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-orange-500 transition-all duration-1000"
                style="width: {getProgressPercentAtVenueForUser(claim.venue, claim.submitter_id ?? undefined)}%"
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
                  <span class={`${isClaimDenied(claim) ? 'text-zinc-500' : 'text-green-500'} font-black uppercase tracking-widest`}>
                    +${getKickbackForClaim(claim).toFixed(2)}
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
              {#if claim.id && claim.submitter_id === userId && claim.status === 'pending'}
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
      {/if}
    {/each}
    
    

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
      class="absolute right-0 top-0 h-full w-[320px] max-w-[88vw] bg-zinc-950 border-l border-zinc-800 p-6 shadow-2xl flex flex-col"
      transition:fly={{ x: 320, duration: 220 }}
    >
      <div class="flex items-center justify-between flex-shrink-0">
        <h2 class="text-sm font-black uppercase tracking-[0.2em] text-white">User Settings</h2>
        <button
          type="button"
          on:click={closeSettings}
          class="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 hover:text-white transition-colors"
        >
          Close
        </button>
      </div>
      <div class="mt-6 space-y-4 text-sm text-zinc-300 overflow-y-auto flex-1 custom-scrollbar">
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">Account</p>
          {#if canEditAuthEmail && emailEditMode}
            <div class="mt-3">
              <input
                type="email"
                bind:value={emailDraft}
                placeholder="new@email.com"
                class="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
              />
            </div>
          {:else}
            <div class="mt-3 flex items-center justify-between gap-2">
              <p class="text-white truncate">{userEmail || 'Signed in'}</p>
              {#if canEditAuthEmail}
                <button
                  type="button"
                  on:click={beginEmailEdit}
                  class="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
                  aria-label="Edit email"
                  title="Edit email"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              {/if}
            </div>
          {/if}
          <p class="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {authProviderLabel || 'Signed in'}
          </p>
          {#if canEditAuthEmail}
            {#if emailEditMode}
              <div class="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  on:click={saveEmailChange}
                  disabled={emailChangeStatus === 'saving'}
                  class="rounded-lg bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-black hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {emailChangeStatus === 'saving' ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  on:click={cancelEmailEdit}
                  disabled={emailChangeStatus === 'saving'}
                  class="rounded-lg border border-zinc-700 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            {/if}
            {#if emailChangeMessage}
              <p class={`mt-2 text-[10px] font-bold uppercase tracking-widest ${emailChangeStatus === 'error' ? 'text-red-400' : 'text-zinc-500'}`}>
                {emailChangeMessage}
              </p>
            {/if}
            <div class="mt-4">
              <button
                type="button"
                on:click={togglePasswordChange}
                class="text-[11px] font-black uppercase tracking-[0.2em] text-orange-400 hover:text-orange-300 transition-colors"
              >
                {showPasswordChange ? 'Hide password update' : 'Change password'}
              </button>
            </div>
            {#if showPasswordChange}
              <div class="mt-3 space-y-2">
                <input
                  type="password"
                  bind:value={passwordDraft}
                  placeholder="New password"
                  class="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
                />
                <input
                  type="password"
                  bind:value={passwordConfirmDraft}
                  placeholder="Confirm new password"
                  class="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
                />
                <button
                  type="button"
                  on:click={savePasswordChange}
                  disabled={passwordChangeStatus === 'saving'}
                  class="w-full rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {passwordChangeStatus === 'saving' ? 'Updating...' : 'Update'}
                </button>
                {#if passwordChangeMessage}
                  <p class={`text-[10px] font-bold uppercase tracking-widest ${passwordChangeStatus === 'error' ? 'text-red-400' : 'text-zinc-500'}`}>
                    {passwordChangeMessage}
                  </p>
                {/if}
              </div>
            {/if}
          {/if}
        </div>
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">Payouts</p>
          <div class="mt-4 space-y-4">
            <div>
              <label for="payout-full-name" class="mb-1 block text-[11px] font-black uppercase tracking-[0.2em] text-white">
                Full Name
              </label>
              <input
                id="payout-full-name"
                type="text"
                bind:value={payoutFullName}
                placeholder="Your legal name"
                class="w-full rounded-xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
              />
            </div>
            <div>
              <label for="payout-payid" class="mb-1 block text-[11px] font-black uppercase tracking-[0.2em] text-white">
                PayID
              </label>
              <input
                id="payout-payid"
                type="text"
                bind:value={payoutPayId}
                placeholder="Phone or email"
                class="w-full rounded-xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
              />
            </div>

            <div class="space-y-3 pt-2">
              <label class="flex items-start gap-3 cursor-pointer group">
                <div class="relative flex items-center pt-0.5">
                  <input
                    type="checkbox"
                    bind:checked={payoutIsHobbyist}
                    class="peer h-4 w-4 rounded border-zinc-800 bg-black/40 text-orange-500 focus:ring-orange-500/20 focus:ring-offset-0 transition-all cursor-pointer appearance-none border"
                  />
                  <svg 
                    class="absolute h-4 w-4 text-orange-500 opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none p-0.5" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor" 
                    stroke-width="4"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div class="flex-1">
                  <p class="text-[10px] font-black uppercase tracking-widest text-white group-hover:text-orange-500 transition-colors">
                    I confirm I'm a Hobbyist
                  </p>
                  {#if !payoutIsHobbyist}
                    <p class="mt-1 text-[10px] leading-relaxed font-bold text-zinc-500 uppercase tracking-tight" transition:slide|local>
                      I agree that my referrals are a social/recreational activity and not a business. <a href="https://kkbk.app/terms" target="_blank" class="text-orange-500/80 hover:text-orange-500 underline decoration-orange-500/30 transition-colors">Terms</a>
                    </p>
                  {/if}
                </div>
              </label>
            </div>

            {#if payoutError}
              <p class="text-[10px] font-bold uppercase tracking-widest text-red-400">{payoutError}</p>
            {/if}
            {#if payoutMessage}
              <p class="text-[10px] font-bold uppercase tracking-widest text-green-400">{payoutMessage}</p>
            {/if}
            <button
              type="button"
              on:click={savePayoutProfile}
              disabled={payoutStatus === 'saving'}
              class="w-full rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {payoutStatus === 'saving' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">Notifications</p>
          <div class="mt-4 space-y-4">
            <div>
              <div class="flex items-center justify-between">
                <div class="flex-1 pr-4">
                  <p class="text-[11px] font-black uppercase tracking-[0.2em] text-white">Approved claims</p>
                </div>
                <button
                  type="button"
                  on:click={onRequestInstall}
                  disabled={!isMobileScreen || isPwaInstalled}
                  class="rounded-lg bg-zinc-200 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-black hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPwaInstalled ? 'Installed' : 'Install'}
                </button>
              </div>
              <p class="mt-0.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Install the Kickback app to receive instant payout notifications
              </p>
            </div>

            <p class="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">Email</p>

            <div class="flex items-center justify-between">
              <div class="flex-1 pr-4">
                <p class="text-[11px] font-black uppercase tracking-[0.2em] text-white">Payout confirmation</p>
              </div>
              <label class="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" bind:checked={notifyPayoutConfirmation} on:change={saveNotificationPreferences} class="peer sr-only" />
                <div class="h-5 w-9 rounded-full bg-zinc-800 transition-colors peer-checked:bg-orange-500 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full"></div>
              </label>
            </div>

            <div class="flex items-center justify-between opacity-50">
              <div class="flex-1 pr-4">
                <p class="text-[11px] font-black uppercase tracking-[0.2em] text-white">Essential account & compliance</p>
              </div>
              <label class="relative inline-flex cursor-not-allowed items-center">
                <input type="checkbox" checked={notifyEssential} disabled class="peer sr-only" />
                <div class="h-5 w-9 rounded-full border border-orange-500/25 bg-orange-500/20 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-orange-200/70 after:transition-all peer-checked:after:translate-x-full"></div>
              </label>
            </div>
          </div>
        </div>
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">Contact Support</p>
          <div class="mt-3 flex items-center justify-between gap-3">
            <a
              href="mailto:support@kkbk.app"
              target="_blank"
              rel="noreferrer noopener"
              class="inline-block text-[11px] font-black uppercase tracking-[0.2em] text-orange-400 hover:text-orange-300"
            >
              support@kkbk.app
            </a>
            {#if supportMessageInput.length > 0}
              <p class="text-[10px] font-bold text-zinc-500 whitespace-nowrap">
                {supportMessageInput.length}/{SUPPORT_MESSAGE_MAX_LENGTH}
              </p>
            {/if}
          </div>
          <div class="mt-3 space-y-3">
            <textarea
              bind:value={supportMessageInput}
              rows="2"
              maxlength={SUPPORT_MESSAGE_MAX_LENGTH}
              placeholder="Your message..."
              on:input={handleSupportMessageInput}
              class="w-full resize-none rounded-xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
            ></textarea>
            <button
              type="button"
              on:click={sendSupportMessage}
              disabled={supportSubmitting || !supportMessageInput.trim()}
              class="w-full rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {supportSubmitting ? 'Sending...' : 'Send'}
            </button>
          </div>
          {#if supportStatusMessage}
            <p class={`mt-2 text-[10px] font-bold uppercase tracking-widest ${supportStatus === 'error' ? 'text-red-400' : 'text-zinc-500'}`}>
              {supportStatusMessage}
            </p>
          {/if}
        </div>
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">Actions</p>
          <button
            type="button"
            on:click={onLogout}
            class="mt-3 w-full rounded-xl border border-zinc-700 px-4 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-200 hover:border-zinc-500 transition-colors"
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

<style>
  .custom-scrollbar {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none;  /* IE and Edge */
  }
  .custom-scrollbar::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }

</style>

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
  bind:this={referButtonEl}
  class="fixed h-14 -translate-x-1/2 w-[calc(100%-3rem)] max-w-sm z-50 bg-zinc-900/80 backdrop-blur-xl border border-zinc-700 text-white font-black rounded-2xl flex items-center justify-center gap-3 shadow-2xl active:scale-95 transition-all uppercase text-xs tracking-[0.2em]"
  style="left: calc(50% - (var(--scrollbar-width) / 2)); bottom: calc(2rem + env(safe-area-inset-bottom));"
  in:fly={{ y: 100 }}
>
  Refer a Friend
</button>
