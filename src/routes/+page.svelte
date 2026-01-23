<script lang="ts">
  import { onMount } from 'svelte';
  import type { Session } from '@supabase/supabase-js';
  import { supabase } from '$lib/supabase';
  import { MAX_BILL } from '$lib/claims/constants';
  import {
    calculateKickback,
    calculateTotalPending,
    normalizeAmountInput,
    normalizeLast4,
    parseAmount
  } from '$lib/claims/utils';
  import {
    clearDraftFromStorage,
    draftToQuery,
    getDraftFromStorage,
    getDraftFromUrl
  } from '$lib/claims/draft';
  import { fetchClaimsForUser, insertClaim, upsertProfileLast4 } from '$lib/claims/repository';
  import type { Claim } from '$lib/claims/types';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import ClaimForm from '$lib/components/ClaimForm.svelte';
  import GuestWarningModal from '$lib/components/GuestWarningModal.svelte';
  import ReferralModal from '$lib/components/ReferralModal.svelte';

  let last4 = '';
  let venue = '';
  let referrer = '';
  let purchaseTime = '';
  let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let errorMessage = '';

  let showReferModal = false;

  const registeredBars = ['The Alibi', 'Electric Cure', 'Neon Palms', 'Dive Bar'];

  let isReferrerLocked = false;
  let isVenueLocked = false;
  let showForm = false;

  let claims: Claim[] = [];
  let totalPending = 0;

  let amount: number | null = null;
  let amountInput = '';

  let showGuestWarning = false;

  let session: Session | null = null;

  $: userRefCode = session?.user?.email?.split('@')[0] || 'member';
  $: last4 = normalizeLast4(last4);
  $: amount = parseAmount(amountInput);
  $: kickbackAmount = calculateKickback(Number(amountInput || 0));
  $: kickback = kickbackAmount.toFixed(2);
  $: canSubmit = Boolean(
    (amount ?? 0) > 0 &&
    venue.trim().length > 0 &&
    last4.length === 4 &&
    purchaseTime.trim().length > 0
  );

  async function fetchDashboardData() {
    if (!session) return;

    try {
      claims = await fetchClaimsForUser(session.user.id);
      totalPending = calculateTotalPending(claims);
    } catch (error) {
      console.error('Error fetching claims:', error);
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
    const now = new Date();
    purchaseTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

    const { data } = await supabase.auth.getSession();
    session = data.session;

    const urlDraft = getDraftFromUrl(window.location.search);
    const storedDraft = getDraftFromStorage(localStorage);
    const draft = urlDraft ?? storedDraft;

    if (draft) {
      amountInput = draft.amount ?? '';
      venue = draft.venue || '';
      referrer = draft.ref || '';
      last4 = draft.last4 || '';

      isReferrerLocked = Boolean(referrer);
      isVenueLocked = Boolean(venue);

      clearDraftFromStorage(localStorage);

      if (session && (amount ?? 0) > 0) {
        await submitClaim();
        window.history.replaceState({}, '', '/');
      }
    }

    if (session) {
      if (!last4) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('last_4')
          .eq('id', session.user.id)
          .single();
        if (profile?.last_4) last4 = String(profile.last_4);
      }

      await fetchDashboardData();
    }
  });

  async function submitClaim() {
    if (!amount || amount <= 0) {
      status = 'error';
      errorMessage = 'Please enter a valid amount';
      return;
    }

    const cleanAmount = Number(amount.toFixed(2));

    if (last4.length !== 4) {
      status = 'error';
      errorMessage = 'Please enter 4 digits';
      return;
    }

    status = 'loading';

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await upsertProfileLast4(user.id, last4);
      }

      await insertClaim({
        venue,
        referrer: referrer || null,
        amount: cleanAmount,
        purchased_at: new Date(purchaseTime).toISOString(),
        last_4: last4,
        created_at: new Date().toISOString(),
        submitter_id: session?.user?.id ?? null
      });

      status = 'success';
      amountInput = '';
      if (!session) {
        last4 = '';
      }
      if (session) await fetchDashboardData();
      setTimeout(() => {
        if (status === 'success') {
          status = 'idle';
          if (session) showForm = false;
        }
      }, 2000);
    } catch (e: any) {
      status = 'error';
      errorMessage = e.message || 'Connection failed';
      console.error(e);
    }
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error logging out:', error.message);
    } else {
      window.location.href = '/login';
    }
  }

  function buildLoginUrl(
    draftAmount: number | null,
    draftVenue: string,
    draftReferrer: string,
    draftLast4: string
  ) {
    const query = draftToQuery({
      amount: draftAmount ? draftAmount.toString() : '',
      venue: draftVenue,
      ref: draftReferrer,
      last4: draftLast4
    });
    return query ? `/login?${query}` : '/login';
  }

  $: loginUrl = buildLoginUrl(amount, venue, referrer, last4);

  function hydrateAmountInput(value: string) {
    const normalized = normalizeAmountInput(value, MAX_BILL);
    amountInput = normalized;
  }
</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center p-6">
  {#if session && !showForm}
    <Dashboard
      {claims}
      {totalPending}
      userEmail={session?.user?.email ?? ''}
      onNewClaim={() => showForm = true}
      onLogout={handleSignOut}
      onOpenRefer={() => showReferModal = true}
    />
  {:else}
    <ClaimForm
      {session}
      showBack={Boolean(session)}
      {status}
      {errorMessage}
      {amount}
      {canSubmit}
      bind:amountInput
      maxBill={MAX_BILL}
      {kickback}
      bind:venue
      bind:referrer
      bind:purchaseTime
      bind:last4
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
      <GuestWarningModal kickback={kickback} onProceed={proceedAsGuest} />
    {/if}
  {/if}

  {#if showReferModal}
    <ReferralModal
      {registeredBars}
      userRefCode={userRefCode}
      onClose={() => showReferModal = false}
    />
  {/if}
</main>
