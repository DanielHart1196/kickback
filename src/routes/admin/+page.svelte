<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { slide } from 'svelte/transition';
  import { replaceState } from '$app/navigation';
  import { supabase } from '$lib/supabase';
  import { fetchClaimsForVenueId, updateClaimStatus, updateClaimWithSquareMatch } from '$lib/claims/repository';
  import { calculateKickbackWithRate, calculateTotalAmount } from '$lib/claims/utils';
  import { matchClaimsToSquarePayments, type SquareClaimMatch } from '$lib/claims/match';
  import type { Claim, ClaimStatus } from '$lib/claims/types';
  import type { Venue } from '$lib/venues/types';
  import { buildVenueBase, generateVenueCode } from '$lib/venues/code';
  import { dev } from '$app/environment';
  import {
    PUBLIC_SQUARE_APP_ID_PROD,
    PUBLIC_SQUARE_APP_ID_SANDBOX
  } from '$env/static/public';

  let claims: Claim[] = [];
  let loading = true;
  let venue: Venue | null = null;
  let venueName = '';
  let guestRate = '5';
  let referrerRate = '5';
  let billingEmail = '';
  let billingFirstName = '';
  let billingLastName = '';
  let billingPhone = '';
  let billingCompany = '';
  let billingCountryCode = 'AU';
  let billingState = 'VIC';
  let billingPostalCode = '3095';
  let billingCity = 'Eltham';
  let billingAddress = '';
  let paymentMethods: string[] = ['gateway'];
  let selectedPaymentMethod = 'gateway';
  const showHelloClever = true;
  const paymentMethodOptions = [
    { id: 'payto', label: 'PayTo (Auto Debit)' },
    { id: 'gateway', label: 'Invoice + Online Payment' }
  ];
  $: paymentMethods = ['gateway'];
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
  let squareMatches: SquareClaimMatch[] = [];
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
  type PayToAgreement = {
    id: string;
    pay_id: string;
    pay_id_type: string;
    payer_name: string;
    limit_amount: number;
    description: string;
    external_id: string | null;
    payment_agreement_type: string;
    agreement_start_date: string;
    frequency: string;
    status: string | null;
    payment_agreement_id: string | null;
    client_transaction_id: string | null;
    created_at: string;
    last_status_at: string | null;
  };
  let payToAgreement: PayToAgreement | null = null;
  let payToPayId = '';
  let payToPayerName = '';
  let payToLimitAmount = '';
  let payToDescription = 'Weekly Kickback settlement';
  let payToType = 'OTHER_SERVICE';
  let payToSaving = false;
  let payToLoading = false;
  let payToError = '';
  let payToSuccess = '';
  let adminUserId = '';
  let zeptoDebtorName = 'Test Debtor';
  let zeptoDebtorIdValue = '123456-12345678';
  const zeptoCreditorName = 'Kickback';
  const zeptoCreditorIdType = 'bban';
  const zeptoCreditorIdValue = '067873-21919407';
  let zeptoDescription = 'Kickback PayTo agreement';
  const zeptoPaymentType = 'variable';
  const zeptoPaymentFrequency = 'weekly';
  let zeptoPaymentAmount = '';
  let zeptoPaymentMaxAmount = '200';
  let zeptoSandboxSimulate = 'debtor_accept';
  let zeptoSandboxDelay = '5';
  let zeptoAliasStatus: 'idle' | 'checking' | 'valid' | 'invalid' = 'idle';
  let zeptoAliasMessage = '';
  let zeptoAliasValidatedValue = '';
  let zeptoAgreementSaving = false;
  let zeptoAgreementError = '';
  let zeptoAgreementSuccess = '';
  type ZeptoAgreementSummary = {
    uid: string;
    state: string | null;
    last_event_type: string | null;
    updated_at: string | null;
    created_at?: string | null;
  };
  type ZeptoAgreementDetails = {
    uid?: string | null;
    state?: string | null;
    description?: string | null;
    created_at?: string | null;
    payment_terms?: {
      frequency?: string | null;
      max_amount?: number | null;
    } | null;
  };
  let zeptoAgreements: ZeptoAgreementSummary[] = [];
  let zeptoAgreementsLoading = false;
  let zeptoAgreementsError = '';
  let zeptoSelectedAgreementUid = '';
  let zeptoHasAgreement = false;
  let selectedZeptoAgreement: ZeptoAgreementSummary | null = null;
  let zeptoAgreementOverride: { uid: string; state: string } | null = null;
  let zeptoSelectedMaxAmount = '';
  let zeptoAgreementDetails: ZeptoAgreementDetails | null = null;
  let zeptoAgreementDetailsLoading = false;
  let zeptoAgreementDetailsError = '';

  function isAgreementActive(state: string | null | undefined): boolean {
    if (!state) return true;
    return state !== 'cancelled' && state !== 'canceled';
  }
  let zeptoActionReason = 'customer_requested';
  let zeptoActionNarrative = '';
  const zeptoActionNarrativeLimit = 140;
  let zeptoAmendDescription = '';
  let zeptoAmendMaxAmount = '';
  let zeptoActionLoading = false;
  let zeptoActionError = '';
  let zeptoActionSuccess = '';
  type PaymentRequest = {
    id: string;
    amount: number;
    description: string | null;
    order_id: string;
    payment_id: string | null;
    redirect_url: string | null;
    status: string | null;
    week_start: string | null;
    week_end: string | null;
    claim_count: number | null;
    total_claim_amount: number | null;
    platform_fee_amount: number | null;
    kickback_amount: number | null;
    created_at: string;
  };
  let latestPaymentRequest: PaymentRequest | null = null;
  let gatewayCreating = false;
  let gatewayLoading = false;
  let gatewayError = '';
  let gatewaySuccess = '';
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
        if (showHelloClever) {
          await fetchPayToAgreement();
          await fetchLatestPaymentRequest();
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
    const squareStatus = url.searchParams.get('square');
    const reason = url.searchParams.get('reason');
    const merchant = url.searchParams.get('merchant');

    if (squareStatus === 'connected') {
      squareBanner = {
        type: 'success',
        message: merchant ? `Square connected (merchant ${merchant}).` : 'Square connected.'
      };
    } else if (squareStatus === 'error') {
      squareBanner = {
        type: 'error',
        message: reason ? `Square connection failed: ${decodeURIComponent(reason)}.` : 'Square connection failed.'
      };
    }

    if (squareStatus) {
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
      let attempt = 0;
      while (attempt < 3) {
        attempt += 1;
        try {
          const [locationsResponse, linksResponse] = await Promise.all([
            fetch(`/api/square/locations?venue_id=${encodeURIComponent(venue.id)}`),
            fetch(`/api/square/location-links?venue_id=${encodeURIComponent(venue.id)}`)
          ]);
          const locationsPayload = await locationsResponse.json().catch(() => null);
          const linksPayload = await linksResponse.json().catch(() => null);
          if (!locationsResponse.ok) {
            squareLocationsError = locationsPayload?.error ?? 'Failed to load Square locations.';
          } else if (!linksResponse.ok) {
            squareLocationsError = linksPayload?.error ?? 'Failed to load Square location links.';
          } else {
            squareLocations = (locationsPayload?.locations ?? []) as {
              id: string;
              name: string;
              status?: string;
            }[];
            const linkedIds = new Set<string>(linksPayload?.location_ids ?? []);
            squareLocationIds = linkedIds;
            squareLocationsError = '';
            return;
          }
        } catch (error) {
          console.error('Error loading Square locations:', error);
          squareLocationsError = 'Failed to load Square locations.';
        }

        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 300));
        }
      }
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

  async function fetchPayToAgreement() {
    if (!venue?.id) return;
    payToLoading = true;
    payToError = '';
    try {
      const { data, error } = await supabase
        .from('venue_payment_agreements')
        .select('*')
        .eq('venue_id', venue.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const latest = data?.[0] ?? null;
      payToAgreement = latest;
      if (latest) {
        payToPayId = latest.pay_id ?? '';
        payToPayerName = latest.payer_name ?? '';
        payToLimitAmount = latest.limit_amount != null ? String(latest.limit_amount) : '';
        payToDescription = latest.description ?? '';
        payToType = latest.payment_agreement_type ?? 'RETAIL';
      }
    } catch (error) {
      console.error('Error loading PayTo agreement:', error);
      payToError = 'Failed to load PayTo agreement.';
    } finally {
      payToLoading = false;
    }
  }

  async function fetchLatestPaymentRequest() {
    if (!venue?.id) return;
    gatewayLoading = true;
    gatewayError = '';
    try {
      const { data, error } = await supabase
        .from('venue_payment_requests')
        .select('*')
        .eq('venue_id', venue.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      latestPaymentRequest = (data?.[0] as PaymentRequest) ?? null;
    } catch (error) {
      console.error('Error loading payment request:', error);
      gatewayError = 'Failed to load payment request.';
    } finally {
      gatewayLoading = false;
    }
  }

  function getNextWednesdayLabel(): string {
    const timeZone = 'Australia/Sydney';
    const weekdayIndex: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6
    };
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    });
    const now = new Date();
    const parts = formatter.formatToParts(now);
    const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const today = {
      year: Number(mapped.year),
      month: Number(mapped.month),
      day: Number(mapped.day),
      weekday: weekdayIndex[mapped.weekday as string] ?? 0
    };
    const targetDay = 3;
    const todayUtc = new Date(Date.UTC(today.year, today.month - 1, today.day));
    let diff = (targetDay - today.weekday + 7) % 7;
    if (diff === 0) diff = 7;
    const targetUtc = new Date(todayUtc.getTime() + diff * 24 * 60 * 60 * 1000);
    return `${targetUtc.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone
    })} (AET)`;
  }

  async function handleCreatePayToAgreement() {
    if (!venue?.id || payToSaving) return;
    payToSaving = true;
    payToError = '';
    payToSuccess = '';
    try {
    const payIdValue = payToPayId.trim();
    const payerValue = payToPayerName.trim();
    const descriptionValue = payToDescription.trim() || 'Weekly Kickback settlement';
    const limitValue = Number(payToLimitAmount);
    if (!payIdValue || !payerValue || !descriptionValue || !Number.isFinite(limitValue) || limitValue <= 0) {
      payToError = 'Enter payer name, PayID, and a weekly limit.';
      return;
    }
    const payload = {
      venue_id: venue.id,
      pay_id: payIdValue,
      payer_name: payerValue,
      limit_amount: limitValue,
      description: descriptionValue,
      payment_agreement_type: payToType,
      external_id: venue.id
    };
      const response = await fetch('/api/helloclever/payto/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const errorPayload = data?.error ?? 'Failed to create PayTo agreement.';
        payToError = typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload);
        return;
      }
      payToAgreement = data?.agreement ?? null;
      payToSuccess = 'PayTo agreement created.';
    } catch (error) {
      console.error('Error creating PayTo agreement:', error);
      payToError = 'Failed to create PayTo agreement.';
    } finally {
      payToSaving = false;
    }
  }

  async function saveBillingDetails(): Promise<boolean> {
    if (!venue?.id) return false;
    const payload = {
      billing_email: billingEmail.trim() || null,
      billing_contact_first_name: billingFirstName.trim() || null,
      billing_contact_last_name: billingLastName.trim() || null,
      billing_phone: billingPhone.trim() || null,
      billing_company: billingCompany.trim() || null,
      billing_country_code: billingCountryCode.trim() || null,
      billing_state: billingState.trim() || null,
      billing_postal_code: billingPostalCode.trim() || null,
      billing_city: billingCity.trim() || null,
      billing_address: billingAddress.trim() || null
    };
    const { error } = await supabase.from('venues').update(payload).eq('id', venue.id);
    if (error) {
      gatewayError = error.message;
      return false;
    }
    venue = { ...venue, ...payload };
    return true;
  }

  async function handleCreatePaymentLink() {
    if (!venue?.id || gatewayCreating) return;
    gatewayCreating = true;
    gatewayError = '';
    gatewaySuccess = '';
    try {
      const descriptionValue = 'Weekly Kickback invoice';
      const saved = await saveBillingDetails();
      if (!saved) {
        return;
      }
      const response = await fetch('/api/helloclever/gateway/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venue.id,
          description: descriptionValue
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const errorPayload = data?.error ?? 'Failed to create payment link.';
        gatewayError = typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload);
        return;
      }
      latestPaymentRequest = data?.payment_request ?? null;
      gatewaySuccess = 'Payment link created.';
    } catch (error) {
      console.error('Error creating payment link:', error);
      gatewayError = 'Failed to create payment link.';
    } finally {
      gatewayCreating = false;
    }
  }

  $: billingDetailsReady = Boolean(
    billingFirstName.trim() &&
    billingLastName.trim() &&
    billingPhone.trim() &&
    billingEmail.trim() &&
    billingCountryCode.trim() &&
    billingPostalCode.trim() &&
    billingCity.trim() &&
    billingAddress.trim()
  );

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
      adminUserId = user?.id ?? '';
      if (!user) return;

    const { data: directVenues, error: directError } = await supabase
      .from('venues')
      .select(
        'id, name, short_code, logo_url, kickback_guest, kickback_referrer, payment_methods, billing_email, billing_contact_first_name, billing_contact_last_name, billing_phone, billing_company, billing_country_code, billing_state, billing_postal_code, billing_city, billing_address, active, created_by'
      )
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
        .select(
          'id, name, short_code, logo_url, kickback_guest, kickback_referrer, payment_methods, billing_email, billing_contact_first_name, billing_contact_last_name, billing_phone, billing_company, billing_country_code, billing_state, billing_postal_code, billing_city, billing_address, active'
        )
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
    paymentMethods = ['gateway'];
    selectedPaymentMethod = 'gateway';
    billingEmail = venue?.billing_email ?? userEmail ?? '';
    billingFirstName = venue?.billing_contact_first_name ?? '';
    billingLastName = venue?.billing_contact_last_name ?? '';
    billingPhone = venue?.billing_phone ?? '';
    billingCompany = venue?.billing_company ?? '';
    billingCountryCode = venue?.billing_country_code ?? 'AU';
      billingState = venue?.billing_state ?? 'VIC';
      billingPostalCode = venue?.billing_postal_code ?? '3095';
      billingCity = venue?.billing_city ?? 'Eltham';
      billingAddress = venue?.billing_address ?? '';
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
        short_code: shortCode,
        payment_methods: paymentMethods,
        billing_email: billingEmail.trim() || user.email,
        billing_contact_first_name: billingFirstName.trim() || null,
        billing_contact_last_name: billingLastName.trim() || null,
        billing_phone: billingPhone.trim() || null,
        billing_company: billingCompany.trim() || null,
        billing_country_code: billingCountryCode.trim() || null,
        billing_state: billingState.trim() || null,
        billing_postal_code: billingPostalCode.trim() || null,
        billing_city: billingCity.trim() || null,
        billing_address: billingAddress.trim() || null
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
        short_code: shortCode,
        payment_methods: paymentMethods,
        billing_email: billingEmail.trim() || null,
        billing_contact_first_name: billingFirstName.trim() || null,
        billing_contact_last_name: billingLastName.trim() || null,
        billing_phone: billingPhone.trim() || null,
        billing_company: billingCompany.trim() || null,
        billing_country_code: billingCountryCode.trim() || null,
        billing_state: billingState.trim() || null,
        billing_postal_code: billingPostalCode.trim() || null,
        billing_city: billingCity.trim() || null,
        billing_address: billingAddress.trim() || null
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

  function isAliasIdentifier(type: string): boolean {
    return ['alias_phone', 'alias_email', 'alias_abn', 'alias_organisation_identifier'].includes(type);
  }

  function detectDebtorIdentifierType(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.includes('-')) return 'bban';
    if (trimmed.includes('@')) return 'alias_email';
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 11) return 'alias_abn';
    if (digits.length >= 8) return 'alias_phone';
    return null;
  }

  function normalizeAmount(value: string): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async function fetchZeptoAgreements() {
    if (!venue?.id) return;
    zeptoAgreementsLoading = true;
    zeptoAgreementsError = '';
    try {
      const response = await fetch(
        `/api/zepto/payto/agreements?venue_id=${encodeURIComponent(venue.id)}`
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to load agreements.');
      }
      zeptoAgreements = payload?.agreements ?? [];
      zeptoHasAgreement = zeptoAgreements.length > 0;
      if (zeptoHasAgreement) {
        zeptoSelectedAgreementUid = zeptoAgreements[0]?.uid ?? '';
      }
      if (zeptoSelectedAgreementUid) {
        await fetchZeptoAgreementDetails(zeptoSelectedAgreementUid);
      }
      if (zeptoAgreementOverride) {
        const matched = zeptoAgreements.find(
          (agreement) =>
            agreement.uid === zeptoAgreementOverride?.uid &&
            agreement.state === zeptoAgreementOverride?.state
        );
        if (matched) {
          zeptoAgreementOverride = null;
        }
      }
    } catch (error) {
      console.error('Error loading Zepto agreements:', error);
      zeptoAgreementsError = 'Failed to load agreements.';
    } finally {
      zeptoAgreementsLoading = false;
    }
  }

  async function fetchZeptoAgreementDetails(uid: string) {
    if (!venue?.id || !uid) return;
    zeptoAgreementDetailsLoading = true;
    zeptoAgreementDetailsError = '';
    try {
      const response = await fetch(
        `/api/zepto/payto/agreements/${encodeURIComponent(uid)}?venue_id=${encodeURIComponent(venue.id)}`
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to load agreement details.');
      }
      zeptoAgreementDetails = payload?.agreement ?? null;
      zeptoHasAgreement = isAgreementActive(zeptoAgreementDetails?.state ?? null);
    } catch (error) {
      console.error('Error loading Zepto agreement details:', error);
      zeptoAgreementDetailsError = 'Failed to load agreement details.';
      zeptoAgreementDetails = null;
    } finally {
      zeptoAgreementDetailsLoading = false;
    }
  }

  async function runZeptoAgreementAction(
    action: 'cancel' | 'suspend' | 'reactivate' | 'amend' | 'recall'
  ) {
    if (!zeptoSelectedAgreementUid) {
      zeptoActionError = 'Select an agreement first.';
      return;
    }
    zeptoActionError = '';
    zeptoActionSuccess = '';

    let payload: Record<string, unknown> = { venue_id: venue?.id ?? null };
    if (action === 'cancel' || action === 'suspend') {
        payload = {
          ...payload,
          reason: zeptoActionReason,
          narrative: zeptoActionNarrative.trim().slice(0, zeptoActionNarrativeLimit) || undefined
        };
    }
      if (action === 'amend') {
        const changes: Record<string, unknown> = {};
        const maxAmount = normalizeAmount(zeptoAmendMaxAmount);
        if (maxAmount != null && maxAmount > 0) {
          changes.payment_terms = { max_amount: Math.round(maxAmount * 100) };
        }
      if (Object.keys(changes).length === 0) {
        zeptoActionError = 'Add a description or max amount to amend.';
        return;
      }
      payload = { ...payload, changes };
    }

    zeptoActionLoading = true;
    try {
      const response = await fetch(`/api/zepto/payto/agreements/${zeptoSelectedAgreementUid}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const errorPayload = result?.error ?? result;
        zeptoActionError =
          typeof errorPayload === 'string'
            ? errorPayload
            : errorPayload?.title ?? JSON.stringify(errorPayload ?? 'Action failed.');
        return;
      }
      if (action === 'suspend' || action === 'reactivate') {
        const nextState = action === 'suspend' ? 'suspended' : 'active';
        zeptoAgreements = zeptoAgreements.map((agreement) =>
          agreement.uid === zeptoSelectedAgreementUid
            ? { ...agreement, state: nextState, updated_at: new Date().toISOString() }
            : agreement
        );
        zeptoAgreementOverride = zeptoSelectedAgreementUid
          ? { uid: zeptoSelectedAgreementUid, state: nextState }
          : null;
      }
      if (action === 'cancel') {
        zeptoAgreements = zeptoAgreements.map((agreement) =>
          agreement.uid === zeptoSelectedAgreementUid
            ? { ...agreement, state: 'cancelled', updated_at: new Date().toISOString() }
            : agreement
        );
        zeptoAgreementOverride = zeptoSelectedAgreementUid
          ? { uid: zeptoSelectedAgreementUid, state: 'cancelled' }
          : null;
        zeptoHasAgreement = false;
      }
      zeptoActionSuccess = `Action ${action} submitted.`;
      await fetchZeptoAgreements();
      if (zeptoSelectedAgreementUid) {
        await fetchZeptoAgreementDetails(zeptoSelectedAgreementUid);
      }
    } catch (error) {
      console.error('Zepto action failed:', error);
      zeptoActionError = 'Action failed.';
    } finally {
      zeptoActionLoading = false;
    }
  }

  function buildZeptoUid(): string {
    const suffix =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `kickback_${Date.now()}_${suffix}`;
  }

  async function validateZeptoAlias() {
    zeptoAliasStatus = 'checking';
    zeptoAliasMessage = '';
    try {
      const response = await fetch('/api/zepto/alias-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: detectedDebtorType,
          value: zeptoDebtorIdValue.trim(),
          requester: {
            id: adminUserId || venue?.id || 'admin'
          }
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        zeptoAliasStatus = 'invalid';
        const errorPayload = payload?.error ?? payload;
        zeptoAliasMessage =
          typeof errorPayload === 'string'
            ? errorPayload
            : errorPayload?.title ?? JSON.stringify(errorPayload ?? 'Alias validation failed.');
        return;
      }
      zeptoAliasStatus = 'valid';
      zeptoAliasMessage = 'PayID validated.';
      zeptoAliasValidatedValue = zeptoDebtorIdValue.trim();
    } catch (error) {
      console.error('Zepto alias validation failed:', error);
      zeptoAliasStatus = 'invalid';
      zeptoAliasMessage = 'Alias validation failed.';
    }
  }

  async function handleCreateZeptoAgreement() {
    zeptoAgreementError = '';
    zeptoAgreementSuccess = '';
    if (!venue?.id) {
      zeptoAgreementError = 'Select a venue before creating an agreement.';
      return;
    }

    const debtorValue = zeptoDebtorIdValue.trim();
    const creditorValue = zeptoCreditorIdValue.trim();
    const missing = [];
    if (!zeptoDebtorName.trim()) missing.push('Debtor name');
    if (!debtorValue) missing.push('Debtor account identifier');
    if (!detectedDebtorType) missing.push('Debtor identifier type');
    if (!zeptoCreditorName.trim()) missing.push('Creditor name');
    if (!creditorValue) missing.push('Creditor account identifier');
    if (!zeptoDescription.trim()) missing.push('Description');
    if (missing.length > 0) {
      zeptoAgreementError = `Missing: ${missing.join(', ')}`;
      return;
    }

    if (detectedDebtorType && isAliasIdentifier(detectedDebtorType)) {
      if (zeptoAliasStatus !== 'valid' || zeptoAliasValidatedValue !== debtorValue) {
        zeptoAgreementError = 'Validate the PayID before creating the agreement.';
        return;
      }
    }

    const paymentTerms: Record<string, unknown> = {
      type: zeptoPaymentType,
      frequency: zeptoPaymentFrequency
    };
    const amount = normalizeAmount(zeptoPaymentAmount);
    const maxAmount = normalizeAmount(zeptoPaymentMaxAmount);

    if (zeptoPaymentType === 'fixed' || zeptoPaymentType === 'balloon') {
      if (amount == null || amount <= 0) {
        zeptoAgreementError = 'Enter a fixed amount for fixed payment terms.';
        return;
      }
      paymentTerms.amount = Math.round(amount * 100);
    } else {
      if (maxAmount == null || maxAmount <= 0) {
        zeptoAgreementError = 'Enter a max amount for variable payment terms.';
        return;
      }
      paymentTerms.max_amount = Math.round(maxAmount * 100);
    }


    const payload: Record<string, unknown> = {
      venue_id: venue.id,
      uid: buildZeptoUid(),
      purpose: 'retail',
      description: zeptoDescription.trim(),
      debtor: {
        party_name: zeptoDebtorName.trim(),
        account_identifier: {
          type: detectedDebtorType,
          value: debtorValue
        }
      },
      creditor: {
        party_name: zeptoCreditorName,
        ultimate_party_name: zeptoCreditorName,
        account_identifier: {
          type: zeptoCreditorIdType,
          value: creditorValue
        }
      },
      payment_terms: paymentTerms,
      sandbox: {
        simulate: zeptoSandboxSimulate,
        delay: Math.max(0, Number(zeptoSandboxDelay) || 0)
      }
    };

    zeptoAgreementSaving = true;
    try {
      const response = await fetch('/api/zepto/payto/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const errorPayload = result?.error ?? result;
        zeptoAgreementError =
          typeof errorPayload === 'string'
            ? errorPayload
            : errorPayload?.title ?? JSON.stringify(errorPayload ?? 'Failed to create agreement.');
        return;
      }
      zeptoAgreementSuccess = `Agreement created (${result?.agreement?.uid ?? payload.uid}).`;
      zeptoSelectedAgreementUid = result?.agreement?.uid ?? payload.uid;
      zeptoHasAgreement = true;
      await fetchZeptoAgreements();
    } catch (error) {
      console.error('Zepto agreement create failed:', error);
      zeptoAgreementError = 'Failed to create agreement.';
    } finally {
      zeptoAgreementSaving = false;
    }
  }

  $: detectedDebtorType = detectDebtorIdentifierType(zeptoDebtorIdValue);
  $: selectedZeptoAgreement =
    zeptoAgreements.find((agreement) => agreement.uid === zeptoSelectedAgreementUid) ?? null;
  $: selectedZeptoAgreementState =
    selectedZeptoAgreement && zeptoAgreementOverride?.uid === selectedZeptoAgreement.uid
      ? zeptoAgreementOverride.state
      : zeptoAgreementDetails?.state ?? selectedZeptoAgreement?.state ?? null;
  function formatAmount(amount: number): string {
    const fixed = amount.toFixed(2);
    return fixed.endsWith('.00') ? fixed.slice(0, -3) : fixed;
  }

  $: {
    if (zeptoAgreementDetails?.payment_terms) {
      const maxAmountCents =
        typeof zeptoAgreementDetails.payment_terms.max_amount === 'number'
          ? zeptoAgreementDetails.payment_terms.max_amount
          : null;
      zeptoSelectedMaxAmount = maxAmountCents != null ? formatAmount(maxAmountCents / 100) : '';
    } else {
      zeptoSelectedMaxAmount = '';
    }
    if (!zeptoAmendMaxAmount && zeptoSelectedMaxAmount) {
      zeptoAmendMaxAmount = zeptoSelectedMaxAmount;
    }
  }
  $: if (!detectedDebtorType || !isAliasIdentifier(detectedDebtorType)) {
    zeptoAliasStatus = 'idle';
    zeptoAliasMessage = '';
    zeptoAliasValidatedValue = '';
  }

  $: if (zeptoAliasValidatedValue && zeptoDebtorIdValue.trim() !== zeptoAliasValidatedValue) {
    zeptoAliasStatus = 'idle';
    zeptoAliasMessage = '';
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

  function formatIsoDate(value: string | null | undefined): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  }

  function formatIsoDateMinusOneDay(value: string | null | undefined): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const adjusted = new Date(parsed.getTime() - 24 * 60 * 60 * 1000);
    return adjusted.toISOString().slice(0, 10);
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
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        await supabase.auth.signOut();
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
    const selectedIds = new Set(selectedClaimIds);
    const pendingClaims = claims.filter(
      (claim) => claim.id && selectedIds.has(claim.id) && getClaimStatus(claim) === 'pending'
    );
    const result = matchClaimsToSquarePayments(pendingClaims, payments, 5);
    squareMatches = result.matches;
    squareUnmatchedClaimIds = result.unmatchedClaimIds;
    const matchedIds = new Set(result.matches.map((match) => match.claimId));
    const unmatchedIds = new Set(result.unmatchedClaimIds);
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
            <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
              Billing Email
              <input
                type="email"
                bind:value={billingEmail}
                placeholder="billing@venue.com"
                class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white w-full md:w-72"
              />
            </label>
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
            {#if squareConnected && squareLocationsLoaded && !squareLocationsError && squareLocations.length !== 1}
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
    <section class="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p class="text-xs font-black uppercase tracking-widest text-zinc-500">Payment Methods</p>
          <p class="text-sm font-bold text-white mt-2">
            Select at least one to enable claims for this venue.
          </p>
        </div>
      </div>

      <div class="mt-6">
        <div class="grid gap-2">
          {#each paymentMethodOptions as option}
            <label class={`flex items-center gap-3 text-xs font-bold uppercase tracking-widest ${option.id === 'payto' ? 'text-zinc-600' : 'text-zinc-300'}`}>
              <input
                type="radio"
                value={option.id}
                bind:group={selectedPaymentMethod}
                class="h-3.5 w-3.5 accent-blue-500"
                disabled={option.id === 'payto'}
              />
              <span>{option.label}</span>
            </label>
          {/each}
        </div>
      </div>

      {#if showHelloClever && selectedPaymentMethod === 'payto'}
        <div class="mt-8 border-t border-zinc-800 pt-6">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p class="text-xs font-black uppercase tracking-widest text-zinc-500">PayTo Agreement</p>
              <p class="text-sm font-bold text-white mt-2">
                Weekly payments start {getNextWednesdayLabel()} at noon.
              </p>
            </div>
            {#if payToAgreement}
              <span class="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Status: {payToAgreement.status ?? 'unknown'}
              </span>
            {/if}
          </div>

          <div class="mt-6 grid gap-4 md:grid-cols-2">
            <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
              Payer Name
              <input
                type="text"
                bind:value={payToPayerName}
                placeholder="Venue owner name"
                class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-base font-bold text-white"
              />
            </label>
            <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
              PayID (Email, Phone, or ABN)
              <input
                type="text"
                bind:value={payToPayId}
                placeholder="owner@example.com"
                class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-base font-bold text-white"
              />
            </label>
            <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
              Weekly Limit (AUD)
              <input
                type="number"
                min="0"
                step="0.01"
                bind:value={payToLimitAmount}
                placeholder="500"
                class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-base font-bold text-white"
              />
            </label>
            <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
              Description
              <input
                type="text"
                bind:value={payToDescription}
                placeholder="Weekly Kickback settlement"
                class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-base font-bold text-white"
              />
            </label>
          </div>

          <div class="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              on:click={handleCreatePayToAgreement}
              disabled={!venue || payToSaving || payToLoading}
              class="bg-white text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight disabled:opacity-50"
            >
              {payToSaving ? 'Creating...' : 'Create PayTo Agreement'}
            </button>
            {#if payToLoading}
              <span class="text-xs font-bold uppercase tracking-widest text-zinc-500">Loading...</span>
            {/if}
            {#if payToError}
              <span class="text-xs font-bold uppercase tracking-widest text-red-400">{payToError}</span>
            {/if}
            {#if payToSuccess}
              <span class="text-xs font-bold uppercase tracking-widest text-green-400">{payToSuccess}</span>
            {/if}
          </div>

          {#if payToAgreement}
            <div class="mt-5 bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-xs font-bold uppercase tracking-widest text-zinc-400 space-y-2">
              <div>Agreement ID: <span class="text-zinc-200">{payToAgreement.payment_agreement_id ?? 'Pending'}</span></div>
              <div>Transaction ID: <span class="text-zinc-200">{payToAgreement.client_transaction_id ?? 'Pending'}</span></div>
              <div>Limit: <span class="text-zinc-200">${Number(payToAgreement.limit_amount ?? 0).toFixed(2)}</span></div>
            </div>
          {/if}
        </div>
        {/if}

      {#if showHelloClever && selectedPaymentMethod === 'gateway'}
        <div class="mt-8 border-t border-zinc-800 pt-6">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p class="text-xs font-black uppercase tracking-widest text-zinc-500">Invoice + Online Payment</p>
              <p class="text-sm font-bold text-white mt-2">
                Creates last week&#39;s invoice (approved claims + platform fee).
              </p>
            </div>
            {#if latestPaymentRequest}
              <span class="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Status: {latestPaymentRequest.status ?? 'unknown'}
              </span>
            {/if}
          </div>

          <div class="mt-6 space-y-4">
            <div class="border border-zinc-800 rounded-xl p-4 bg-zinc-950">
              <p class="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Gateway Billing Details
              </p>
              <div class="mt-3 grid gap-3 md:grid-cols-2">
                <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                  First Name
                  <input
                    type="text"
                    bind:value={billingFirstName}
                    placeholder="Clever"
                    class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
                  />
                </label>
                <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                  Last Name
                  <input
                    type="text"
                    bind:value={billingLastName}
                    placeholder="Hello"
                    class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
                  />
                </label>
                <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                  Phone
                  <input
                    type="tel"
                    bind:value={billingPhone}
                    placeholder="+61412345678"
                    class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
                  />
                </label>
                <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                  Company
                  <input
                    type="text"
                    bind:value={billingCompany}
                    placeholder="Venue Pty Ltd"
                    class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
                  />
                </label>
                <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                  Country Code
                  <input
                    type="text"
                    bind:value={billingCountryCode}
                    placeholder="AU"
                    class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
                  />
                </label>
                <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                  State
                  <input
                    type="text"
                    bind:value={billingState}
                    placeholder="VIC"
                    class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
                  />
                </label>
                <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                  Postal Code
                  <input
                    type="text"
                    bind:value={billingPostalCode}
                    placeholder="3095"
                    class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
                  />
                </label>
                <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                  City
                  <input
                    type="text"
                    bind:value={billingCity}
                    placeholder="Eltham"
                    class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
                  />
                </label>
              </div>
              <label class="mt-3 flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                Address
                <input
                  type="text"
                  bind:value={billingAddress}
                  placeholder="388 George Street"
                  class="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-white"
                />
              </label>
            </div>

            <label class="flex flex-col gap-2 text-xs font-black uppercase tracking-widest text-zinc-500 md:col-span-2">
              Description
            </label>
          </div>

          <div class="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              on:click={handleCreatePaymentLink}
              disabled={!venue || gatewayCreating || gatewayLoading || !billingDetailsReady}
              class="bg-white text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight disabled:opacity-50"
            >
              {gatewayCreating ? 'Creating...' : 'Create Payment Link'}
            </button>
            {#if !billingDetailsReady}
              <span class="text-xs font-bold uppercase tracking-widest text-zinc-500">
                Add billing details to enable payment links.
              </span>
            {/if}
            {#if gatewayLoading}
              <span class="text-xs font-bold uppercase tracking-widest text-zinc-500">Loading...</span>
            {/if}
            {#if gatewayError}
              <span class="text-xs font-bold uppercase tracking-widest text-red-400">{gatewayError}</span>
            {/if}
            {#if gatewaySuccess}
              <span class="text-xs font-bold uppercase tracking-widest text-green-400">{gatewaySuccess}</span>
            {/if}
          </div>

          {#if latestPaymentRequest}
            <div class="mt-5 bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-xs font-bold uppercase tracking-widest text-zinc-400 space-y-2">
              <div>
                Week:
                <span class="text-zinc-200">
                  {formatIsoDate(latestPaymentRequest.week_start) || 'n/a'}
                </span>
                {#if latestPaymentRequest.week_end}
                  <span class="text-zinc-500">
                    {' '}
                    - {formatIsoDateMinusOneDay(latestPaymentRequest.week_end)}
                  </span>
                {/if}
              </div>
              <div>
                Amount: <span class="text-zinc-200">${Number(latestPaymentRequest.amount ?? 0).toFixed(2)}</span>
              </div>
              {#if latestPaymentRequest.redirect_url}
                <div>
                  Link:
                  <a
                    href={latestPaymentRequest.redirect_url}
                    class="text-orange-400 underline underline-offset-2"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open payment link
                  </a>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
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
              class="inline-flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-black text-zinc-300 hover:text-white transition-colors uppercase tracking-tight disabled:opacity-50"
            >
              {squareChecking ? 'Checking...' : 'Auto-check Square'}
            </button>
          {:else}
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
          {/if}
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

