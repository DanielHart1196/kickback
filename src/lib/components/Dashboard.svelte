<script lang="ts">
  import { fade, fly, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { onMount, tick } from 'svelte';
  import { GOAL_DAYS, KICKBACK_RATE } from '$lib/claims/constants';
  import { calculateKickbackWithRate, isClaimDenied } from '$lib/claims/utils';
  import { supabase } from '$lib/supabase';
  import type { Claim } from '$lib/claims/types';
  import type { Venue } from '$lib/venues/types';
  

  type PendingInvitation = {
    id: string;
    venueId: string;
    venueName: string;
    referrerCode: string;
    createdAt: string;
  };
  type AcceptedInvitation = {
    id: string;
    userId?: string;
    venueId: string;
    venueName: string;
    referrerCode: string;
    activatedAt: string;
    expiresAt: string | null;
    role: 'guest' | 'referrer';
  };

  export let claims: Claim[] = [];
  export let totalBalance = 0;
  export let totalScheduled = 0;
  export let totalPaid = 0;
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
  export let pendingInvitations: PendingInvitation[] = [];
  export let acceptedInvitations: AcceptedInvitation[] = [];
  export let payoutHistory: PayoutHistoryItem[] = [];
  export let onContinueInvitation: (invite: PendingInvitation) => void = () => {};
  export let onDeleteInvitation: (invite: PendingInvitation) => void = () => {};

  let lastHighlightKey: string | null = null;
  type PayoutHistoryItem = {
    id: string;
    amount: number;
    currency: string;
    paid_at: string;
    pay_id: string;
    bsb?: string;
    account_number?: string;
    payout_method?: string;
    claim_count?: number;
    period_start: string;
    period_end: string;
    referral_rewards: number;
    cashback: number;
    venue_totals?: { venue: string; total_amount: number }[];
  };
  type HistoryItem =
    | { kind: 'payout'; key: string; timestamp: number; payout: PayoutHistoryItem }
    | { kind: 'claim'; key: string; timestamp: number; claim: Claim }
    | { kind: 'invitation'; key: string; timestamp: number; invitation: PendingInvitation }
    | { kind: 'accepted_invitation'; key: string; timestamp: number; invitation: AcceptedInvitation };

  let historyItems: HistoryItem[] = [];
  let historyFilter: 'earnings' | 'payouts' | 'venues' | 'guests' | null = null;
  let filterStatus: Set<'pending' | 'approved' | 'paid' | 'denied'> = new Set();
  const statusOptions: Array<'approved' | 'paid' | 'denied'> = ['approved', 'paid', 'denied'];
  const historyFilterOptions: Array<'earnings' | 'payouts' | 'venues' | 'guests'> = [
    'earnings',
    'payouts',
    'venues',
    'guests'
  ];
  let showFilterMenu = false;
  let listContainer: HTMLDivElement | null = null;
  let filterMenuEl: HTMLDivElement | null = null;
  let filterButtonEl: HTMLButtonElement | null = null;
  let referButtonEl: HTMLButtonElement | null = null;
  let showSettings = false;
  let showDeleteWarning = false;
  let deleteStatus: 'idle' | 'loading' | 'error' = 'idle';
  let deleteError = '';
  let showDeleteInvitationWarning = false;
  let deleteInvitationTarget: PendingInvitation | null = null;
  let payoutPayId = '';
  let payoutBsb = '';
  let payoutAccountNumber = '';
  let payoutUseBankDetails = false;
  let payoutFullName = '';
  let payoutDob = '';
  let payoutAddress = '';
  let payoutAbn = '';
  let payoutIsHobbyist = false;
  let payoutHobbyistInteracted = false;
  let payoutHobbyistConfirmedAt: string | null = null;
  let payoutStatus: 'idle' | 'loading' | 'saving' | 'error' | 'success' = 'idle';
  let payoutError = '';
  let payoutMessage = '';
  let payoutProfileLoaded = false;
  let payoutProfileLoading = false;
  let payoutProfileLoadPromise: Promise<void> | null = null;
  let payoutProfilePrefetchTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLoadedUserId: string | null = null;
  let payoutStripeAccountId = '';
  let payoutStripeStatusLoaded = false;
  let payoutStripeAccountStatus: 'pending' | 'verified' | 'rejected' | null = null;
  let payoutStripeAccountLink = '';
  let payoutStripeRequirements: any[] = [];
  let payoutProfileSnapshot = '';
  let payoutProfileDirty = false;
  let payoutProfileCurrent = '';
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

  function onlyDigits(value: string, maxLen: number) {
    return value.replace(/\D/g, '').slice(0, maxLen);
  }

  function formatBsbInput(value: string) {
    const digits = onlyDigits(value, 6);
    if (digits.length <= 3) return digits;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  const pwaInstalledKey = 'kickback:pwa_installed';
  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
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
    payoutProfileLoaded = false;
    payoutProfileLoadPromise = null;
    schedulePayoutProfilePrefetch();
  }

  function schedulePayoutProfilePrefetch() {
    if (typeof window === 'undefined') {
      void ensurePayoutProfileLoaded(true);
      return;
    }
    if (payoutProfilePrefetchTimer) {
      clearTimeout(payoutProfilePrefetchTimer);
      payoutProfilePrefetchTimer = null;
    }
    const runPrefetch = () => {
      payoutProfilePrefetchTimer = null;
      void ensurePayoutProfileLoaded(true);
    };
    const requestIdle = (window as any).requestIdleCallback;
    if (typeof requestIdle === 'function') {
      requestIdle(runPrefetch, { timeout: 800 });
      return;
    }
    payoutProfilePrefetchTimer = setTimeout(runPrefetch, 120);
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
      const runtimeInstalled =
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        ((window.navigator as any)?.standalone === true);
      let storedInstalled = false;
      try {
        storedInstalled = localStorage.getItem(pwaInstalledKey) === '1';
      } catch {}
      isPwaInstalled = runtimeInstalled || storedInstalled;
    };
    const handleBeforeInstallPrompt = () => {
      if (typeof window === 'undefined') return;
      const runtimeInstalled =
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        ((window.navigator as any)?.standalone === true);
      if (!runtimeInstalled) {
        try {
          localStorage.removeItem(pwaInstalledKey);
        } catch {}
        isPwaInstalled = false;
      }
    };
    const handleInstalled = () => {
      try {
        localStorage.setItem(pwaInstalledKey, '1');
      } catch {}
      updateInstallAvailability();
    };
    document.addEventListener('click', handleOutsideClick);
    if (typeof window !== 'undefined') {
      try {
        updateInstallAvailability();
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
        window.addEventListener('appinstalled', handleInstalled);
        window.addEventListener('resize', updateInstallAvailability);
        window.addEventListener('focus', updateInstallAvailability);
        window.addEventListener('pageshow', updateInstallAvailability);
        document.addEventListener('visibilitychange', updateInstallAvailability);
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
        if (provider === 'google') {
          authProviderLabel = 'Signed up with Google';
        } else {
          authProviderLabel = '';
        }
        if (session?.access_token) {
          void loadPayoutHistory(session.access_token);
        }
      });
    }
    return () => {
      document.removeEventListener('click', handleOutsideClick);
      if (payoutProfilePrefetchTimer) {
        clearTimeout(payoutProfilePrefetchTimer);
        payoutProfilePrefetchTimer = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
        window.removeEventListener('appinstalled', handleInstalled);
        window.removeEventListener('resize', updateInstallAvailability);
        window.removeEventListener('focus', updateInstallAvailability);
        window.removeEventListener('pageshow', updateInstallAvailability);
        document.removeEventListener('visibilitychange', updateInstallAvailability);
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
        return;
      }
      payoutHistory = Array.isArray(payload?.payouts) ? payload.payouts : [];
    } catch {}
  }

  

  let settingsPanelEl: HTMLElement | null = null;
  let settingsSwipeStartX = 0;
  let settingsSwipeStartY = 0;
  let settingsSwipeOffset = 0;
  let settingsSwipeActive = false;
  let settingsSwipeLock: 'horizontal' | 'vertical' | null = null;
  let settingsCloseTimer: ReturnType<typeof setTimeout> | null = null;
  const SETTINGS_SWIPE_THRESHOLD_PX = 90;
  const SETTINGS_SWIPE_ANIM_MS = 120;

  function getSettingsPanelWidth() {
    return settingsPanelEl?.offsetWidth ?? 320;
  }

  async function openSettings() {
    if (settingsCloseTimer) {
      clearTimeout(settingsCloseTimer);
      settingsCloseTimer = null;
    }
    settingsSwipeOffset = getSettingsPanelWidth();
    showSettings = true;
    await tick();
    requestAnimationFrame(() => {
      settingsSwipeOffset = 0;
    });
    void ensurePayoutProfileLoaded();
  }
  function closeSettings() {
    animateSettingsClose();
  }

  function animateSettingsClose() {
    if (!showSettings) return;
    if (settingsCloseTimer) {
      clearTimeout(settingsCloseTimer);
      settingsCloseTimer = null;
    }
    settingsSwipeOffset = getSettingsPanelWidth();
    settingsSwipeActive = false;
    settingsSwipeLock = null;
    settingsCloseTimer = setTimeout(() => {
      showSettings = false;
      settingsSwipeOffset = 0;
      settingsCloseTimer = null;
    }, SETTINGS_SWIPE_ANIM_MS);
  }

  function handleSettingsTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    settingsSwipeActive = true;
    settingsSwipeStartX = touch.clientX;
    settingsSwipeStartY = touch.clientY;
    settingsSwipeOffset = 0;
    settingsSwipeLock = null;
  }

  function handleSettingsTouchMove(event: TouchEvent) {
    if (!settingsSwipeActive || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - settingsSwipeStartX;
    const dy = touch.clientY - settingsSwipeStartY;

    if (!settingsSwipeLock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      settingsSwipeLock = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    }

    if (settingsSwipeLock !== 'horizontal') return;
    event.preventDefault();
    settingsSwipeOffset = Math.max(0, dx);
  }

  function handleSettingsTouchEnd() {
    if (!settingsSwipeActive) return;
    settingsSwipeActive = false;
    const width = getSettingsPanelWidth();
    const threshold = Math.min(SETTINGS_SWIPE_THRESHOLD_PX, width * 0.35);
    if (settingsSwipeOffset > threshold) {
      animateSettingsClose();
    } else {
      settingsSwipeOffset = 0;
    }
    settingsSwipeLock = null;
  }

  async function ensurePayoutProfileLoaded(background = false) {
    if (!userId) return;
    if (payoutProfileLoaded) return;
    if (payoutProfileLoadPromise) {
      await payoutProfileLoadPromise;
      return;
    }
    payoutProfileLoadPromise = loadPayoutProfileInternal(background).finally(() => {
      payoutProfileLoadPromise = null;
    });
    await payoutProfileLoadPromise;
  }

  async function loadPayoutProfileInternal(background = false) {
    if (!userId) return;
    payoutProfileLoading = true;
    if (!background) {
      payoutStatus = 'loading';
      payoutError = '';
      payoutMessage = '';
    }
    payoutStripeStatusLoaded = false;
    try {
      // Load payout profile data
      const { data: payoutData, error: payoutErrorData } = await supabase
        .from('payout_profiles')
        .select('pay_id, bsb, account_number, payout_method, full_name, dob, address, abn, is_hobbyist, hobbyist_confirmed_at')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (payoutErrorData) throw payoutErrorData;
      
      payoutPayId = payoutData?.pay_id ?? '';
      payoutBsb = payoutData?.bsb ?? '';
      payoutAccountNumber = payoutData?.account_number ?? '';
      if (payoutData?.payout_method === 'bank') {
        payoutUseBankDetails = true;
      } else if (payoutData?.payout_method === 'payid') {
        payoutUseBankDetails = false;
      } else {
        payoutUseBankDetails = Boolean((payoutBsb || payoutAccountNumber) && !payoutPayId);
      }
      payoutFullName = payoutData?.full_name ?? '';
      payoutDob = payoutData?.dob ?? '';
      payoutAddress = payoutData?.address ?? '';
      payoutAbn = payoutData?.abn ?? '';
      payoutIsHobbyist = payoutData?.is_hobbyist ?? false;
      payoutHobbyistConfirmedAt = payoutData?.hobbyist_confirmed_at ?? null;
      payoutHobbyistInteracted = Boolean(payoutData);
      payoutProfileLoaded = true;
      await tick();
      payoutProfileSnapshot = payoutProfileCurrent;

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
      if (!background) {
        payoutStatus = 'idle';
      }
    } catch (error) {
      payoutProfileLoaded = true;
      if (!background) {
        payoutStatus = 'error';
        payoutError = error instanceof Error ? error.message : 'Failed to load payout details.';
      }
    } finally {
      payoutProfileLoading = false;
    }
  }

  export async function loadPayoutProfile() {
    await loadPayoutProfileInternal(true);
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

  async function handleApprovedClaimsToggle(event: Event & { currentTarget: HTMLInputElement }) {
    const nextValue = event.currentTarget.checked;
    const registerPush = async (): Promise<boolean> => {
      try {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
        const vapidRes = await fetch('/api/notifications/vapid-key');
        const vapidPayload = await vapidRes.json().catch(() => null);
        if (!vapidRes.ok || !vapidPayload?.ok || !vapidPayload?.publicKey) return false;
        const registration = await navigator.serviceWorker.ready;
        if (!registration.pushManager) return false;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(String(vapidPayload.publicKey))
          }));
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) return false;
        const subscribeRes = await fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ subscription })
        });
        return subscribeRes.ok;
      } catch {
        return false;
      }
    };
    const unregisterPush = async (): Promise<boolean> => {
      try {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
        const registration = await navigator.serviceWorker.ready;
        if (!registration.pushManager) return true;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return true;
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (accessToken) {
          await fetch('/api/notifications/subscribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify({ action: 'unsubscribe', subscription })
          });
        }
        await subscription.unsubscribe();
        return true;
      } catch {
        return false;
      }
    };
    if (nextValue && typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          notifyApprovedClaims = false;
          await saveNotificationPreferences();
          return;
        }
      } else if (Notification.permission === 'denied') {
        notifyApprovedClaims = false;
        await saveNotificationPreferences();
        return;
      }
      const registered = await registerPush();
      if (!registered) {
        notifyApprovedClaims = false;
        await saveNotificationPreferences();
        return;
      }
    }
    if (!nextValue) {
      await unregisterPush();
    }
    notifyApprovedClaims = nextValue;
    await saveNotificationPreferences();
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
      emailChangeMessage = 'Check your inbox to confirm your new email. Signing out...';
      emailEditMode = false;
      await Promise.resolve(onLogout());
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

  $: payoutProfileCurrent = JSON.stringify({
    pay_id: payoutPayId.trim(),
    bsb: onlyDigits(payoutBsb, 6),
    account_number: onlyDigits(payoutAccountNumber, 9),
    payout_use_bank: payoutUseBankDetails,
    full_name: payoutFullName.trim(),
    dob: payoutDob,
    address: payoutAddress.trim(),
    abn: payoutAbn.trim(),
    is_hobbyist: payoutIsHobbyist,
    hobbyist_confirmed_at: payoutHobbyistConfirmedAt,
    stripe_account_id: payoutStripeAccountId || null
  });

  $: payoutProfileDirty = payoutProfileLoaded && payoutProfileSnapshot !== payoutProfileCurrent;

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

      if (!payoutUseBankDetails && trimmedPayId) {
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
        bsb: onlyDigits(payoutBsb, 6) || null,
        account_number: onlyDigits(payoutAccountNumber, 9) || null,
        payout_method: payoutUseBankDetails ? 'bank' : 'payid',
        full_name: payoutFullName.trim() || null,
        dob: payoutDob || null,
        address: payoutAddress.trim() || null,
        abn: payoutAbn.trim() || null,
        is_hobbyist: payoutIsHobbyist,
        hobbyist_confirmed_at: payoutHobbyistConfirmedAt,
        stripe_account_id: payoutStripeAccountId || null,
        updated_at: new Date().toISOString()
      };
      
      const { error: payoutErr } = await supabase.from('payout_profiles').upsert(payoutPayload, { onConflict: 'user_id' });
      if (payoutErr) throw payoutErr;

      payoutStatus = 'success';
      payoutMessage = 'Payout details saved';
      payoutProfileSnapshot = payoutProfileCurrent;
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
      supportStatusMessage = `Message received - we'll send our reply to ${email}`;
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

  function openDeleteInvitationWarning(invite: PendingInvitation) {
    deleteInvitationTarget = invite;
    showDeleteInvitationWarning = true;
  }

  function closeDeleteInvitationWarning() {
    showDeleteInvitationWarning = false;
    deleteInvitationTarget = null;
  }

  async function confirmDeleteInvitation() {
    if (!deleteInvitationTarget) return;
    await onDeleteInvitation(deleteInvitationTarget);
    closeDeleteInvitationWarning();
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

  function getInvitationForClaim(claim: Claim): AcceptedInvitation | null {
    if (!claim.submitter_id) return null;
    const normalizedVenue = claim.venue.trim().toLowerCase();
    if (claim.submitter_id === userId) {
      return (
        acceptedInvitations.find((invite) => {
          if (invite.role !== 'guest') return false;
          if (claim.venue_id) return invite.venueId === claim.venue_id;
          return invite.venueName.trim().toLowerCase() === normalizedVenue;
        }) ?? null
      );
    }
    if (claim.referrer_id === userId) {
      return (
        acceptedInvitations.find((invite) => {
          if (invite.role !== 'referrer') return false;
          if (invite.userId && invite.userId !== claim.submitter_id) return false;
          if (claim.venue_id) return invite.venueId === claim.venue_id;
          return invite.venueName.trim().toLowerCase() === normalizedVenue;
        }) ?? null
      );
    }
    return null;
  }

  function getDaysLeftAtVenueForClaim(claim: Claim): number {
    const invite = getInvitationForClaim(claim);
    if (!invite) return GOAL_DAYS;
    return getDaysLeftForInvitation(invite);
  }

  function getProgressPercentAtVenueForUser(claim: Claim): number {
    const daysLeft = getDaysLeftAtVenueForClaim(claim);
    const elapsedDays = Math.min(Math.max(GOAL_DAYS - daysLeft, 0), GOAL_DAYS);
    return (elapsedDays / GOAL_DAYS) * 100;
  }

  function getTimeLeftLabelForVenue(claim: Claim): string {
    const invite = getInvitationForClaim(claim);
    if (!invite) return `${GOAL_DAYS} DAYS LEFT`;
    return getTimeLeftLabelForInvitation(invite);
  }

  function getProgressBarWidth(claim: Claim): number {
    const percent = getProgressPercentAtVenueForUser(claim);
    if (percent <= 0) return 2;
    return percent;
  }

  function getDaysLeftForInvitation(invite: AcceptedInvitation): number {
    const expiresAt = invite.expiresAt
      ? new Date(invite.expiresAt).getTime()
      : new Date(invite.activatedAt).getTime() + GOAL_DAYS * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(expiresAt)) return 0;
    const diffMs = expiresAt - Date.now();
    return Math.max(Math.ceil(diffMs / (24 * 60 * 60 * 1000)), 0);
  }

  function getTimeLeftLabelForInvitation(invite: AcceptedInvitation): string {
    const expiresAt = invite.expiresAt
      ? new Date(invite.expiresAt).getTime()
      : new Date(invite.activatedAt).getTime() + GOAL_DAYS * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(expiresAt)) return '0 MINS LEFT';
    const remainingMs = Math.max(expiresAt - Date.now(), 0);
    if (remainingMs >= 24 * 60 * 60 * 1000) {
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      return `${remainingDays} ${remainingDays === 1 ? 'DAY' : 'DAYS'} LEFT`;
    }
    const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
    if (hours >= 1) return `${hours} ${hours === 1 ? 'HOUR' : 'HOURS'} LEFT`;
    const minutes = Math.ceil(remainingMs / (60 * 1000));
    const clampedMinutes = Math.max(minutes, 0);
    return `${clampedMinutes} ${clampedMinutes === 1 ? 'MIN' : 'MINS'} LEFT`;
  }

  function getInvitationTimestamp(invite: AcceptedInvitation): number {
    const activatedAt = new Date(invite.activatedAt).getTime();
    return Number.isFinite(activatedAt) ? activatedAt : 0;
  }

  function getInvitationDisplayTime(invite: AcceptedInvitation): string {
    return invite.activatedAt;
  }

  function getInvitedCodeForInvitation(invite: AcceptedInvitation): string {
    if (invite.role !== 'referrer') return invite.referrerCode;
    const match = claims.find((claim) => {
      if (!claim.referrer_id || claim.referrer_id !== userId) return false;
      if (invite.venueId) return claim.venue_id === invite.venueId;
      return claim.venue?.trim().toLowerCase() === invite.venueName?.trim().toLowerCase();
    });
    if (!match) return invite.referrerCode;
    return (
      match.submitter_referral_code ||
      claimantCodes[match.submitter_id ?? ''] ||
      invite.referrerCode
    );
  }


  function getClaimStatus(claim: Claim): 'pending' | 'approved' | 'paid' | 'guestpaid' | 'refpaid' | 'paidout' | 'denied' {
    return (claim.status as any) ?? 'approved';
  }

  function getDisplayStatus(claim: Claim): 'pending' | 'approved' | 'paid' | 'denied' {
    const status = getClaimStatus(claim);
    if (status === 'paidout' || status === 'guestpaid' || status === 'refpaid') return 'paid';
    return status;
  }

  $: filteredClaims = claims.filter((claim) => {
    const status = getDisplayStatus(claim);
    const statusOk = filterStatus.size === 0 || filterStatus.has(status);
    return statusOk;
  });
  $: if (historyFilter && historyFilter !== 'earnings') {
    if (filterStatus.size > 0) filterStatus = new Set();
  }
  $: venueInvitations = acceptedInvitations.filter((invite) => invite.role === 'guest');
  $: guestInvitations = acceptedInvitations.filter((invite) => invite.role === 'referrer');
  $: venuesHistoryCount = pendingInvitations.length + venueInvitations.length;
  $: guestsHistoryCount = guestInvitations.length;
  $: historyFilterLabel =
    historyFilter === 'payouts'
      ? 'Payouts'
      : historyFilter === 'venues'
        ? 'Venues'
        : historyFilter === 'guests'
          ? 'Guests'
          : historyFilter === 'earnings'
            ? 'Earnings'
            : 'Filter';
  $: hasActiveHistoryFilters = Boolean(historyFilter || filterStatus.size > 0);
  $: historyPaddingBottomPx =
    BASE_HISTORY_BOTTOM_PADDING_PX + (showFilterMenu ? filterMenuExtraPaddingPx : 0);
  $: if (showFilterMenu && !filterMenuWasOpen) {
    filterMenuWasOpen = true;
    void ensureFilterMenuClearance();
  }
  $: if (showFilterMenu) {
    filteredClaims.length;
    historyFilter;
    venuesHistoryCount;
    guestsHistoryCount;
    void ensureFilterMenuClearance();
  }
  $: if (!showFilterMenu && filterMenuWasOpen) {
    filterMenuWasOpen = false;
    filterMenuExtraPaddingPx = 0;
  }
  $: allHistoryItems = [
    ...payoutHistory.map((payout) => ({
      kind: 'payout' as const,
      key: `payout:${payout.id}`,
      timestamp: new Date(payout.paid_at).getTime(),
      payout
    })),
    ...claims.map((claim) => ({
      kind: 'claim' as const,
      key: `claim:${claim.id ?? claim.created_at}`,
      timestamp: new Date(claim.purchased_at).getTime(),
      claim
    })),
    ...pendingInvitations.map((invitation) => ({
      kind: 'invitation' as const,
      key: `invitation:${invitation.id}`,
      timestamp: new Date(invitation.createdAt).getTime(),
      invitation
    })),
    ...acceptedInvitations.map((invitation) => ({
      kind: 'accepted_invitation' as const,
      key: `accepted:${invitation.id}:${invitation.role}`,
      timestamp: getInvitationTimestamp(invitation),
      invitation
    }))
  ];
  $: historyFilterCount =
    historyFilter === 'payouts'
      ? payoutHistory.length
      : historyFilter === 'venues'
        ? venuesHistoryCount
        : historyFilter === 'guests'
          ? guestsHistoryCount
          : historyFilter === 'earnings'
            ? filteredClaims.length
            : allHistoryItems.length;
  $: historyItems = [
    ...(!historyFilter || historyFilter === 'payouts'
      ? payoutHistory.map((payout) => ({
          kind: 'payout' as const,
          key: `payout:${payout.id}`,
          timestamp: new Date(payout.paid_at).getTime(),
          payout
        }))
      : []),
    ...(!historyFilter || historyFilter === 'earnings'
      ? (historyFilter === 'earnings' ? filteredClaims : claims).map((claim) => ({
          kind: 'claim' as const,
          key: `claim:${claim.id ?? claim.created_at}`,
          timestamp: new Date(claim.purchased_at).getTime(),
          claim
        }))
      : []),
    ...(!historyFilter || historyFilter === 'venues'
      ? pendingInvitations.map((invitation) => ({
          kind: 'invitation' as const,
          key: `invitation:${invitation.id}`,
          timestamp: new Date(invitation.createdAt).getTime(),
          invitation
        }))
      : []),
    ...(!historyFilter || historyFilter === 'venues'
      ? venueInvitations.map((invitation) => ({
          kind: 'accepted_invitation' as const,
          key: `accepted:${invitation.id}:${invitation.role}`,
          timestamp: getInvitationTimestamp(invitation),
          invitation
        }))
      : []),
    ...(!historyFilter || historyFilter === 'guests'
      ? guestInvitations.map((invitation) => ({
          kind: 'accepted_invitation' as const,
          key: `accepted:${invitation.id}:${invitation.role}`,
          timestamp: getInvitationTimestamp(invitation),
          invitation
        }))
      : [])
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

  function formatDateDdMmYyyy(value: string): string {
    if (!value) return '';
    const direct = String(value).trim();
    const isoMatch = direct.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    }
    const parsed = new Date(direct);
    if (!Number.isFinite(parsed.getTime())) return direct;
    return parsed.toLocaleDateString('en-GB');
  }

  function formatDateTimeDdMmYyyy(value: string): string {
    if (!value) return '';
    const parsed = new Date(String(value));
    if (!Number.isFinite(parsed.getTime())) return String(value);
    return `${parsed.toLocaleDateString('en-GB')} ${parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }

  function preserveScrollAfter(update: () => void) {
    if (typeof window === 'undefined') {
      update();
      return;
    }
    const before = window.scrollY;
    update();
    void tick().then(() => {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const target = Math.min(before, maxScroll);
      const behavior = before > maxScroll ? 'smooth' : 'auto';
      if (Math.abs(window.scrollY - target) > 1) {
        window.scrollTo({ top: target, behavior });
      }
    });
  }

  async function ensureFilterMenuClearance() {
    if (typeof window === 'undefined') return;
    await tick();
    if (!showFilterMenu || !filterMenuEl || !referButtonEl) {
      if (filterMenuExtraPaddingPx !== 0) filterMenuExtraPaddingPx = 0;
      return;
    }

    const visibleItemCount =
      !historyFilter
        ? allHistoryItems.length
        : historyFilter === 'payouts'
          ? payoutHistory.length
          : historyFilter === 'venues'
            ? venuesHistoryCount
            : historyFilter === 'guests'
              ? guestsHistoryCount
              : filteredClaims.length;
    const cappedItemCount = Math.min(visibleItemCount, 4);
    if (cappedItemCount >= 4) {
      if (filterMenuExtraPaddingPx !== 0) filterMenuExtraPaddingPx = 0;
    } else {
      const popupHeight = filterMenuEl.offsetHeight;
      const requiredExtraPadding = Math.max(
        0,
        Math.ceil(popupHeight + REFER_BUTTON_GAP_PX - cappedItemCount * CLAIM_SLOT_HEIGHT_PX)
      );
      if (requiredExtraPadding !== filterMenuExtraPaddingPx) {
        filterMenuExtraPaddingPx = requiredExtraPadding;
        await tick();
      }
    }

  }
</script>

<div class="w-full max-w-sm space-y-10 mx-auto" in:fade>
  <header class="relative text-center pt-2">
    <a href="/" aria-label="Go to home" class="inline-flex items-center justify-center">
      <img src="/branding/kickback-wordmark.svg" alt="Kickback" class="h-7 w-auto select-none" loading="eager" decoding="sync" />
    </a>
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
    <p class="text-zinc-500 text-xs font-bold uppercase tracking-widest mt-2">Member Dashboard</p>
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
          class="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <span class="block">Balance - ${totalBalance.toFixed(2)}</span>
          <span class="block mt-2">Scheduled for payout on Wednesday - ${totalScheduled.toFixed(2)}</span>
          <span class="block mt-2">Total paid - ${totalPaid.toFixed(2)}</span>
        </span>
      </span>
    </p>
    <div class="flex items-center justify-center gap-3">
      <h2 class="text-6xl font-black tracking-normal text-green-500">${totalBalance.toFixed(2)}</h2>
    </div>
  </div>

  <button 
    type="button"
    on:click={onOpenRefer}
    class="w-full appearance-none bg-white text-black font-black py-5 rounded-[2rem] text-xl uppercase tracking-tight shadow-xl shadow-white/5 active:scale-95 transition-all"
    style="background-color: #fff; color: #000; -webkit-appearance: none; appearance: none; -webkit-text-fill-color: #000;"
  >
    + Invite
  </button>

  <div
    class="space-y-4 mt-12"
    style={`padding-bottom: calc(${historyPaddingBottomPx}px + env(safe-area-inset-bottom));`}
    bind:this={listContainer}
  >
    <div class="flex justify-between items-end border-b border-zinc-800 pb-4 relative">
      <h3 class="text-base font-black uppercase tracking-[0.18em] text-zinc-400">History</h3>
      <button
        type="button"
        on:click={() => (showFilterMenu = !showFilterMenu)}
        bind:this={filterButtonEl}
        class="text-sm font-bold text-zinc-500 uppercase flex items-center gap-2 hover:text-white transition-colors"
        aria-haspopup="true"
        aria-expanded={showFilterMenu}
      >
        {hasActiveHistoryFilters ? `${historyFilterCount} ${historyFilterLabel}` : 'Filter'}
        <svg viewBox="0 0 24 24" aria-hidden="true" class={`h-4 w-4 transition-transform ${showFilterMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {#if showFilterMenu}
        <div bind:this={filterMenuEl} class="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-3 space-y-3 z-10">
          <div>
            <div class="flex flex-col gap-2">
              {#each historyFilterOptions as option}
                {@const isActive = historyFilter === option}
                <div class="flex flex-col gap-2">
                  <button
                    type="button"
                    class={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center ${
                    isActive
                      ? option === 'payouts'
                        ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                        : option === 'venues' || option === 'guests'
                          ? 'border-orange-500/30 bg-orange-500/10 text-orange-300'
                          : 'border-green-500/30 bg-green-500/10 text-green-400'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                  }`}
                  on:click={() => {
                    preserveScrollAfter(() => {
                      if (historyFilter === option) {
                        historyFilter = null;
                        filterStatus = new Set();
                      } else {
                        historyFilter = option;
                      }
                    });
                  }}
                >
                    {option === 'payouts'
                      ? 'Payouts'
                      : option === 'venues'
                        ? 'Venues'
                        : option === 'guests'
                          ? 'Guests'
                          : 'Earnings'}
                  </button>
                  {#if option === 'earnings' && isActive}
                    <div class="flex flex-col items-center gap-2" transition:slide|local={{ duration: 180 }}>
                      {#each statusOptions as status}
                        {#if status === 'approved'}
                          <button
                            type="button"
                            class={`w-36 px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center text-center ${filterStatus.has(status) ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                            on:click={() => {
                              preserveScrollAfter(() => {
                                const next = new Set(filterStatus);
                                if (next.has(status)) {
                                  next.delete(status);
                                } else {
                                  next.add(status);
                                }
                                filterStatus = next;
                              });
                            }}
                          >
                            APPROVED
                          </button>
                        {:else if status === 'paid'}
                          <button
                            type="button"
                            class={`w-36 px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center text-center ${filterStatus.has(status) ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                            on:click={() => {
                              preserveScrollAfter(() => {
                                const next = new Set(filterStatus);
                                if (next.has(status)) {
                                  next.delete(status);
                                } else {
                                  next.add(status);
                                }
                                filterStatus = next;
                              });
                            }}
                          >
                            PAID
                          </button>
                        {:else}
                          <button
                            type="button"
                            class={`w-36 px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border inline-flex items-center justify-center text-center ${filterStatus.has(status) ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'}`}
                            on:click={() => {
                              preserveScrollAfter(() => {
                                const next = new Set(filterStatus);
                                if (next.has(status)) {
                                  next.delete(status);
                                } else {
                                  next.add(status);
                                }
                                filterStatus = next;
                              });
                            }}
                          >
                            DENIED
                          </button>
                        {/if}
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>

    {#key historyItems.length === 0}
      {#if historyItems.length === 0}
        <div class="py-12 text-center border-2 border-dashed border-zinc-800 rounded-[2rem]" in:slide|local={{ duration: 200, delay: 220 }} out:slide|local={{ duration: 160 }}>
          <p class="text-zinc-600 text-xs font-bold uppercase tracking-widest">No activity yet</p>
        </div>
      {/if}
    {/key}
    {#each historyItems as item (item.key)}
      <div animate:flip={{ duration: 260 }} in:slide|local={{ duration: 220 }} out:slide|local={{ duration: 220 }}>
        {#if item.kind === 'invitation'}
          {@const invite = item.invitation}
          <div>
            <div class="bg-black border border-zinc-800 rounded-2xl p-5">
            <div>
              <p class="text-[11px] font-black uppercase tracking-[0.25em] text-orange-500">Pending Activation</p>
              <div class="mt-2 flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-sm font-bold text-white">{invite.venueName || 'Venue'}</p>
                  <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1">
                    Invited by {invite.referrerCode}
                  </p>
                </div>
                <div class="shrink-0 flex flex-col items-end gap-2">
                  <button
                    type="button"
                    on:click={() => onContinueInvitation(invite)}
                    class="rounded-full bg-orange-500/90 text-black text-xs font-black uppercase tracking-widest px-4 py-2 hover:bg-orange-400 transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
            <div class="mt-3 flex items-center justify-between gap-4">
              <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                Accepted {formatDateTimeDdMmYyyy(invite.createdAt)}
              </p>
              <button
                type="button"
                on:click={() => openDeleteInvitationWarning(invite)}
                class="text-[10px] font-bold uppercase tracking-widest text-red-500 hover:text-red-400 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
        {:else if item.kind === 'accepted_invitation'}
          {@const invite = item.invitation}
          <div>
            <div class="bg-black border border-zinc-800 rounded-2xl p-5">
            <div>
              <div class="flex items-end justify-between gap-4">
                <div class="min-w-0 flex flex-col">
                  <p class="text-xl font-black uppercase tracking-widest text-orange-500 whitespace-nowrap">
                    {invite.role === 'guest' ? 'Venue Added' : 'Guest Added'}
                  </p>
                  <p class="text-zinc-300 uppercase tracking-tight text-sm font-bold">
                    {invite.role === 'guest' ? invite.venueName || 'Venue' : getInvitedCodeForInvitation(invite)}
                  </p>
                  <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-1">
                    {invite.role === 'guest' ? 'Invited by' : 'At'} {invite.role === 'guest' ? invite.referrerCode : invite.venueName || 'Venue'}
                  </p>
                </div>
                <div class="shrink-0 text-right flex flex-col justify-end">
                  <p class="text-2xl font-black text-white">
                    {getTimeLeftLabelForInvitation(invite).split(' ').slice(0, 1).join(' ')}
                  </p>
                  <p class="text-[10px] font-black uppercase tracking-widest text-zinc-300">
                    {getTimeLeftLabelForInvitation(invite).split(' ').slice(1).join(' ')}
                  </p>
                </div>
              </div>
            </div>
            </div>
          </div>
        {:else if item.kind === 'payout'}
          <div>
            <details class="group bg-black border border-zinc-800 rounded-2xl overflow-hidden">
            <summary class="details-summary-reset list-none p-5 flex items-center justify-between gap-4 cursor-pointer active:bg-zinc-900/50">
              <div class="flex items-center justify-between flex-1 gap-4">
                <div class="flex flex-col justify-center">
                  <p class="text-xl font-black uppercase tracking-widest text-[#0D9CFF]">
                    ${Number(item.payout.amount ?? 0).toFixed(2)}
                  </p>
                  <p class="text-zinc-300 uppercase tracking-tight text-sm font-bold">Payout</p>
                </div>
                <div class="flex items-center">
                  <p class="text-zinc-500 text-sm font-bold whitespace-nowrap">
                    {formatDateTimeDdMmYyyy(item.payout.paid_at)}
                  </p>
                </div>
              </div>
              <div class="text-zinc-600 group-open:rotate-180 transition-transform">
                <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
            </summary>

            <div class="px-5 pb-6 pt-0">
              <div class="grid grid-cols-1 gap-3 pt-3 border-t border-zinc-800">
                {#if (item.payout.payout_method ?? '') === 'bank' || item.payout.bsb || item.payout.account_number}
                  <div class="flex items-center justify-between">
                    <p class="text-xs font-black text-zinc-400 uppercase">BSB-Account</p>
                    <p class="text-sm font-bold text-white">
                      {item.payout.bsb && item.payout.account_number
                        ? `${item.payout.bsb}-${item.payout.account_number}`
                        : 'Not set'}
                    </p>
                  </div>
                {:else}
                  <div class="flex items-center justify-between">
                    <p class="text-xs font-black text-zinc-400 uppercase">PayID</p>
                    <p class="text-sm font-bold text-white">{item.payout.pay_id || 'Not set'}</p>
                  </div>
                {/if}
                <div class="flex items-center justify-between">
                  <p class="text-xs font-black text-zinc-400 uppercase">Period</p>
                  <p class="text-sm font-bold text-white">
                    {formatDateDdMmYyyy(item.payout.period_start)} to {formatDateDdMmYyyy(item.payout.period_end)}
                  </p>
                </div>
                <div class="flex items-center justify-between">
                  <p class="text-xs font-black text-zinc-400 uppercase">Referral Rewards</p>
                  <p class="text-sm font-bold text-white">${Number(item.payout.referral_rewards ?? 0).toFixed(2)}</p>
                </div>
                <div class="flex items-center justify-between">
                  <p class="text-xs font-black text-zinc-400 uppercase">Cashback</p>
                  <p class="text-sm font-bold text-white">${Number(item.payout.cashback ?? 0).toFixed(2)}</p>
                </div>
                <div class="mt-1 border-t border-zinc-800 pt-3 flex items-center justify-between">
                  <p class="text-xs font-black text-zinc-400 uppercase">Total</p>
                  <p class="text-sm font-bold text-[#0D9CFF]">${Number(item.payout.amount ?? 0).toFixed(2)} {String(item.payout.currency ?? 'aud').toUpperCase()}</p>
                </div>
              </div>

            </div>
            </details>
          </div>
        {:else}
          {@const claim = item.claim}
          <div>
            <details
          class={`group bg-black border border-zinc-800 rounded-2xl overflow-hidden transition-[border-color] duration-1000 ease-out ${
            (claim.id ?? claim.created_at) === highlightClaimKey
              ? 'border-orange-500'
              : ''
          }`}
          data-claim-key={claim.id ?? claim.created_at}
        >
        <summary class="details-summary-reset list-none py-5 pl-5 pr-4 relative cursor-pointer active:bg-zinc-900/50">
            <div class="flex">
              <div class="flex flex-col justify-center w-full">
              <p class={`text-xl font-black uppercase tracking-widest ${isClaimDenied(claim) ? 'text-zinc-500' : 'text-green-500'}`}>
                +${getKickbackForClaim(claim).toFixed(2)}
              </p>
              {#if claim.referrer_id && claim.referrer_id === userId}
                <p class="text-zinc-300 uppercase tracking-tight text-sm font-bold whitespace-nowrap">
                  FROM <span class="text-orange-500">{claimantCodes[claim.submitter_id ?? ''] || claim.referrer || 'REFERRAL'}</span>
                </p>
              {:else}
                <p class="text-zinc-300 uppercase tracking-tight text-sm font-bold">{claim.venue}</p>
              {/if}
              </div>
            <div class="absolute right-12 top-5 flex flex-col items-end gap-1">
            <div class="flex items-center gap-2">
              <p class="text-zinc-500 text-sm font-bold whitespace-nowrap">
                {new Date(claim.purchased_at).toLocaleDateString()} {new Date(claim.purchased_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <span class={`border rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${getStatusBadgeClass(getDisplayStatus(claim))}`}>
                {getDisplayStatus(claim).toUpperCase()}
              </span>
            </div>
            </div>
          </div>
          <div class="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 group-open:rotate-180 transition-transform">
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
              <p class="text-sm font-bold text-white">
                {getTimeLeftLabelForVenue(claim)}
              </p>
            </div>
            <div class="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-orange-500 transition-all duration-1000"
                style="width: {getProgressBarWidth(claim)}%"
              ></div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-800">
            <div>
              <p class="text-xs font-black text-zinc-400 uppercase mb-1">Total Bill</p>
              <p class="text-sm font-bold text-white">${claim.amount.toFixed(2)}</p>
            </div>
            <div>
              <p class="text-xs font-black text-zinc-400 uppercase mb-1">
                {claim.referrer_id && claim.referrer_id === userId ? 'Purchaser' : 'Invited By'}
              </p>
              {#if claim.referrer_id && claim.referrer_id === userId}
                <p class="text-sm font-bold uppercase">
                  <span class="text-white">{claimantCodes[claim.submitter_id ?? ''] || claim.referrer || 'Purchaser'}</span>
                  <span class={`${isClaimDenied(claim) ? 'text-zinc-500' : 'text-green-500'} font-black uppercase tracking-widest`}>
                    +${getKickbackForClaim(claim).toFixed(2)}
                  </span>
                </p>
              {:else}
                <p class="text-sm font-bold uppercase">
                  <span class="text-white">{claim.referrer || 'Direct'}</span>
                  <span class={`${isClaimDenied(claim) ? 'text-zinc-500' : 'text-green-500'} font-black uppercase tracking-widest`}>
                    +${getKickbackForClaim(claim).toFixed(2)}
                  </span>
                </p>
              {/if}
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
      </div>
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
      bind:this={settingsPanelEl}
      class="absolute right-0 top-0 h-full w-[320px] max-w-[88vw] bg-zinc-950 border-l border-zinc-800 p-6 shadow-2xl flex flex-col"
      style={`transform: translateX(${settingsSwipeOffset}px); transition: ${settingsSwipeActive ? 'none' : `transform ${SETTINGS_SWIPE_ANIM_MS}ms ease`}; touch-action: pan-y;`}
      on:touchstart={handleSettingsTouchStart}
      on:touchmove={handleSettingsTouchMove}
      on:touchend={handleSettingsTouchEnd}
      on:touchcancel={handleSettingsTouchEnd}
    >
      <div class="flex items-center justify-between flex-shrink-0">
        <h2 class="text-sm font-black uppercase tracking-[0.2em] text-white">User Settings</h2>
        <button
          type="button"
          on:click={closeSettings}
          class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
          aria-label="Close user settings"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12" />
            <path d="M18 6l-12 12" />
          </svg>
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
          {#if authProviderLabel}
            <p class="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              {authProviderLabel}
            </p>
          {/if}
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
                {showPasswordChange ? 'Cancel' : 'Change password'}
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
            {#if !payoutProfileLoaded && payoutProfileLoading}
              <p class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Loading payout details...</p>
            {:else}
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
                {#if !payoutUseBankDetails}
                  <div class="flex items-center justify-between mb-1">
                    <label for="payout-payid" class="block text-[11px] font-black uppercase tracking-[0.2em] text-white">
                      PayID
                    </label>
                    <button
                      type="button"
                      on:click={() => (payoutUseBankDetails = true)}
                      class="text-[10px] font-black uppercase tracking-widest text-orange-400 hover:text-orange-300 transition-colors"
                    >
                      BSB + account no.
                    </button>
                  </div>
                  <input
                    id="payout-payid"
                    type="text"
                    bind:value={payoutPayId}
                    placeholder="Phone or email"
                    class="w-full rounded-xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
                  />
                {:else}
                  <div class="space-y-3">
                    <div>
                      <div class="flex items-center justify-between mb-1">
                        <label for="payout-bsb" class="block text-[11px] font-black uppercase tracking-[0.2em] text-white">
                          BSB
                        </label>
                        <button
                          type="button"
                          on:click={() => (payoutUseBankDetails = false)}
                          class="text-[10px] font-black uppercase tracking-widest text-orange-400 hover:text-orange-300 transition-colors"
                        >
                          PayID
                        </button>
                      </div>
                      <input
                        id="payout-bsb"
                        type="text"
                        inputmode="numeric"
                        bind:value={payoutBsb}
                        maxlength="7"
                        on:input={(event) => (payoutBsb = formatBsbInput((event.currentTarget as HTMLInputElement).value))}
                        placeholder="000-000"
                        class="w-full rounded-xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
                      />
                    </div>
                    <div>
                      <label for="payout-account" class="mb-1 block text-[11px] font-black uppercase tracking-[0.2em] text-white">
                        Account No.
                      </label>
                      <input
                        id="payout-account"
                        type="text"
                        inputmode="numeric"
                        bind:value={payoutAccountNumber}
                        maxlength="9"
                        on:input={(event) => (payoutAccountNumber = onlyDigits((event.currentTarget as HTMLInputElement).value, 9))}
                        placeholder="Account number"
                        class="w-full rounded-xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
                      />
                    </div>
                  </div>
                {/if}
              </div>

              {#if false}
                <div class="space-y-3 pt-2">
                  <label class="flex items-start gap-3 cursor-pointer group">
                    <div class="relative flex items-center pt-0.5">
                      <input
                        type="checkbox"
                        bind:checked={payoutIsHobbyist}
                        on:change={() => (payoutHobbyistInteracted = true)}
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
                          I agree that my referrals are a social/recreational activity and not a business. <a href="/terms" target="_blank" class="text-orange-500/80 hover:text-orange-500 underline decoration-orange-500/30 transition-colors">Terms</a>
                        </p>
                      {/if}
                    </div>
                  </label>
                </div>

                {#if !payoutIsHobbyist && payoutHobbyistInteracted}
                  <div>
                    <label for="payout-abn" class="mb-1 block text-[11px] font-black uppercase tracking-[0.2em] text-white">
                      ABN
                    </label>
                    <input
                      id="payout-abn"
                      type="text"
                      bind:value={payoutAbn}
                      placeholder="Australian Business Number"
                      class="w-full rounded-xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-all"
                    />
                  </div>
                {/if}
              {/if}

              {#if payoutError}
                <p class="text-[10px] font-bold uppercase tracking-widest text-red-400">{payoutError}</p>
              {/if}
              {#if payoutMessage}
                <p class="text-[10px] font-bold uppercase tracking-widest text-green-400">{payoutMessage}</p>
              {/if}
              {#if payoutProfileDirty}
                <button
                  type="button"
                  on:click={savePayoutProfile}
                  disabled={payoutStatus === 'saving'}
                  class="w-full rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {payoutStatus === 'saving' ? 'Saving...' : 'Save'}
                </button>
              {/if}
            {/if}
          </div>
        </div>
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">Notifications</p>
          <div class="mt-4 space-y-4">
            <div>
              <div class="flex items-center justify-between">
                <div class="flex-1 pr-4">
                  <p class="text-[11px] font-black uppercase tracking-[0.2em] text-white">Earnings</p>
                </div>
                {#if isPwaInstalled}
                  <label class="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={notifyApprovedClaims}
                      on:change={handleApprovedClaimsToggle}
                      class="peer sr-only"
                    />
                    <div class="h-5 w-9 rounded-full bg-zinc-800 transition-colors peer-checked:bg-orange-500 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full"></div>
                  </label>
                {:else}
                  <button
                    type="button"
                    on:click={onRequestInstall}
                    disabled={!isMobileScreen}
                    class="rounded-lg bg-zinc-200 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-black hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Install
                  </button>
                {/if}
              </div>
              {#if !isPwaInstalled}
                <p class="mt-0.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Install the Kickback PWA
                </p>
              {/if}
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
            {#if supportSubmitting || supportMessageInput.trim().length > 0}
              <button
                type="button"
                on:click={sendSupportMessage}
                disabled={supportSubmitting}
                class="w-full rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {supportSubmitting ? 'Sending...' : 'Send'}
              </button>
            {/if}
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

  .details-summary-reset::-webkit-details-marker {
    display: none;
  }

  .details-summary-reset::marker {
    content: "";
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

{#if showDeleteInvitationWarning}
  <div class="fixed inset-0 z-[260]">
    <button
      type="button"
      on:click={closeDeleteInvitationWarning}
      class="absolute inset-0 bg-black/70 backdrop-blur-sm"
      aria-label="Close delete invitation warning"
    ></button>
    <div class="absolute left-1/2 top-1/2 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
      <h3 class="text-sm font-black uppercase tracking-[0.2em] text-white">Delete invitation</h3>
      <div class="mt-4 text-sm text-zinc-300 space-y-2">
        <p>This will remove the invitation from your history.</p>
        <p>
          You can still accept a new{' '}
          <span class="text-orange-500 font-semibold">
            {deleteInvitationTarget?.venueName || 'venue'}
          </span>{' '}
          invite later.
        </p>
      </div>
      <button
        type="button"
        on:click={confirmDeleteInvitation}
        class="mt-6 w-full rounded-xl bg-red-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-red-400 transition-colors"
      >
        Delete invitation
      </button>
      <button
        type="button"
        on:click={closeDeleteInvitationWarning}
        class="mt-3 w-full rounded-xl border border-zinc-700 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-zinc-200 hover:border-zinc-500 transition-colors"
      >
        Cancel
      </button>
    </div>
  </div>
{/if}

<button 
  on:click={onNewClaim}
  bind:this={referButtonEl}
  class="fixed h-14 -translate-x-1/2 w-[calc(100%-3rem)] max-w-sm z-50 bg-zinc-900/80 backdrop-blur-xl border border-zinc-700 text-white font-black rounded-2xl flex items-center justify-center gap-3 shadow-2xl active:scale-95 transition-all uppercase text-xs tracking-[0.2em]"
  style="left: calc(50% - (var(--scrollbar-width) / 2)); bottom: calc(2rem + env(safe-area-inset-bottom));"
  in:fly={{ y: 100 }}
>
  Activate Venue
</button>
