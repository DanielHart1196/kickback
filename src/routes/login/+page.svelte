<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';
  import { fetchActiveVenues } from '$lib/venues/repository';
  import { calculateKickbackWithRate } from '$lib/claims/utils';
  import { KICKBACK_RATE } from '$lib/claims/constants';
  import { fade } from 'svelte/transition';
  import {
    buildDraftFromParams,
    draftToQuery,
    clearDraftFromStorage,
    getDraftFromStorage,
    getDraftFromUrl,
    saveDraftToStorage
  } from '$lib/claims/draft';
  export let data: { pendingKickback: string | null };

  let loading = false;
  let message = '';
  let pendingKickback: string | null = null;
  let venueRates: { id: string; name: string; short_code?: string | null; kickback_guest?: number | null; logo_url?: string | null }[] = [];
  let email = '';
  let magicLinkLoading = false;
  let venuePromo: { name: string; logo_url: string | null; rate_pct: number } | null = null;
  let promoLogoLoaded = false;
  $: hasPromoOrKickback = !!venuePromo || !!pendingKickback;

  pendingKickback = data?.pendingKickback ?? null;

  onMount(async () => {
    try {
      venueRates = await fetchActiveVenues();
    } catch (error) {
      console.error('Error loading venues:', error);
      venueRates = [];
    }

    const urlDraft = getDraftFromUrl(window.location.search);
    if (urlDraft) {
      const amountValue = Number(urlDraft.amount ?? '');
      const venueCode = urlDraft.venueCode ?? '';
      const venueId =
        urlDraft.venueId ??
        venueRates.find((venue) => (venue.short_code ?? '').toUpperCase() === venueCode.toUpperCase())?.id ??
        '';
      const venueName = urlDraft.venue ?? '';
      const rateFromVenue =
        venueRates.find((venue) => venue.id === venueId)?.kickback_guest ??
        venueRates.find(
          (venue) => venue.name.trim().toLowerCase() === venueName.trim().toLowerCase()
        )?.kickback_guest ??
        KICKBACK_RATE * 100;
      const rate = Number(rateFromVenue) / 100;

      pendingKickback =
        Number.isFinite(amountValue) && amountValue > 0
          ? calculateKickbackWithRate(amountValue, rate).toFixed(2)
          : null;
    } else {
      pendingKickback = null;
    }

    const params = new URLSearchParams(window.location.search);
    const hasVenueParam = params.has('venue') || params.has('venue_id');
    const hasOnlyVenue =
      hasVenueParam &&
      !params.has('ref') &&
      !params.has('amount') &&
      !params.has('last4');
    if (hasOnlyVenue) {
      const venueParam = params.get('venue_id') || params.get('venue') || '';
      let match =
        venueRates.find((v) => v.id === venueParam) ??
        venueRates.find((v) => (v.short_code ?? '').toUpperCase() === venueParam?.toUpperCase()) ??
        venueRates.find((v) => v.name.trim().toLowerCase() === (venueParam ?? '').trim().toLowerCase()) ??
        null;
      if (match) {
        const ratePct = Number(match.kickback_guest ?? KICKBACK_RATE * 100);
        venuePromo = { name: match.name, logo_url: (match as any).logo_url ?? null, rate_pct: ratePct };
      }
    } else {
      venuePromo = null;
    }
    
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) {
      window.location.href = '/';
      return;
    }
  });

  async function handleOAuth(provider: 'google') {
    loading = true;
    message = '';

    const params = new URLSearchParams(window.location.search);
    const draft = buildDraftFromParams(params);
    const draftQuery = draftToQuery(draft);
    const redirectUrl = `${window.location.origin}/auth/callback?redirect_to=/`;
    // Save draft if we have query params
    if (draftQuery) {
      saveDraftToStorage(localStorage, draft);
    } else {
      clearDraftFromStorage(localStorage);
    }

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl
        }
      });
      if (error) {
        message = error.message;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : 'Login failed';
    } finally {
      loading = false;
    }
  }

  async function handleMagicLink() {
    if (!email) {
      message = 'Please enter your email address';
      return;
    }

    magicLinkLoading = true;
    message = '';

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });

      if (error) {
        message = error.message;
      } else {
        message = 'Check your email for the magic link!';
      }
    } catch (error) {
      message = error instanceof Error ? error.message : 'Failed to send magic link';
    } finally {
      magicLinkLoading = false;
    }
  }
  
  function handleGoBack() {
    const before = window.location.href;
    if (window.history.length > 1) {
      window.history.back();
      setTimeout(() => {
        if (window.location.href === before) {
          window.location.href = '/';
        }
      }, 600);
    } else {
      window.location.href = '/';
    }
  }
</script>

<main class="min-h-screen bg-black text-white flex flex-col items-center p-6 pt-16">
  <div class={`w-full max-w-sm ${hasPromoOrKickback ? 'space-y-5 pb-16' : 'space-y-5'}`}>
    <div class={`text-center ${hasPromoOrKickback ? '' : 'pb-16'}`}>
      <div class="min-h-[44px] flex items-center justify-center">
        <h1 class="text-3xl font-black uppercase tracking-tighter leading-none whitespace-normal md:whitespace-nowrap">
          Welcome to <span class="sm:hidden"><br /></span><span class="kickback-wordmark"><span class="text-white">Kick</span><span class="text-orange-500">back</span></span>
        </h1>
      </div>
      {#if venuePromo}
        <div class="mt-5 flex flex-col items-center justify-center gap-5">
          {#if venuePromo.logo_url}
            <img
              src={venuePromo.logo_url}
              alt={venuePromo.name}
              on:load={() => (promoLogoLoaded = true)}
              class="h-48 w-auto max-w-full object-contain rounded-2xl border-2 transition-opacity duration-200 {promoLogoLoaded ? 'border-orange-500/80 opacity-100' : 'border-transparent opacity-0'}"
            />
          {/if}
          <p class="text-xs text-zinc-300 font-semibold text-center">
            Bring a mate to {venuePromo.name} and you'll both get {venuePromo.rate_pct}% cash back on their spend for 30 days
          </p>
        </div>
      {/if}
      {#if pendingKickback}
        <div class="mt-0">
          <p class="text-orange-500 text-xs font-black uppercase">Sign in to claim your ${pendingKickback} kickback</p>
        </div>
      {/if}
    </div>

    <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl space-y-4 flex flex-col items-center">
      <button
        type="button"
        on:click={() => handleOAuth('google')}
        disabled={loading}
        class="google-sso w-fit rounded-full border border-[#747775] bg-white text-[#1F1F1F] text-[14px] leading-[20px] h-10 px-3 inline-flex items-center justify-start gap-[10px] active:scale-95 transition-all disabled:opacity-50"
      >
        <svg aria-hidden="true" viewBox="0 0 48 48" class="h-5 w-5">
          <path fill="#EA4335" d="M24 9.5c3.6 0 6.6 1.4 9 3.8l6.7-6.7C35.8 2.7 30.3.5 24 .5 14.7.5 6.6 5.8 2.7 13.5l7.8 6.1C12.4 13 17.8 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.7-.2-3.3-.5-4.9H24v9.3h12.6c-.6 3.1-2.3 5.7-4.9 7.5l7.5 5.8c4.4-4 6.8-10 6.8-17.7z"/>
          <path fill="#FBBC05" d="M10.5 28.6c-1-3.1-1-6.5 0-9.6l-7.8-6.1C-.3 18.3-.3 29.7 2.7 35.9l7.8-6.1z"/>
          <path fill="#34A853" d="M24 47.5c6.3 0 11.8-2.1 15.7-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.2 2.3-6.2 0-11.6-3.5-13.5-8.5l-7.8 6.1C6.6 42.2 14.7 47.5 24 47.5z"/>
        </svg>
        {loading ? 'Connecting...' : 'Continue with Google'}
      </button>
      
      <div class="w-full flex items-center gap-4">
        <div class="flex-1 h-px bg-zinc-700"></div>
        <span class="text-xs text-zinc-500 uppercase tracking-wider">or</span>
        <div class="flex-1 h-px bg-zinc-700"></div>
      </div>

      <input
        type="email"
        bind:value={email}
        placeholder="Enter your email"
        disabled={magicLinkLoading}
        on:keydown={(e) => e.key === 'Enter' && handleMagicLink()}
        class="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
      />
      <button
        type="button"
        on:click={handleMagicLink}
        disabled={magicLinkLoading}
        class="w-full h-10 rounded-full bg-orange-500 text-black text-[14px] leading-[20px] font-black inline-flex items-center justify-center active:scale-95 transition-all disabled:opacity-50 hover:bg-orange-600"
      >
        {magicLinkLoading ? 'Sending...' : 'SEND MAGIC LINK'}
      </button>

      {#if message}
        <p transition:fade class="text-center text-xs font-bold text-zinc-400 uppercase">{message}</p>
      {/if}
    </div>

    <p class="text-center text-[10px] text-zinc-500 leading-snug">
      By creating an account, you are agreeing to our
      <a href="/terms" class="text-zinc-300 hover:text-white transition-colors">terms of service</a>
      and
      <a href="/privacy" class="text-zinc-300 hover:text-white transition-colors">privacy policy</a>.
    </p>

    <button on:click={handleGoBack} class="w-full text-zinc-600 text-xs font-bold uppercase">
      Go Back
    </button>
  </div>
</main>

<style>
  html[data-fonts="loading"] .kickback-wordmark { visibility: hidden }
  html[data-fonts="loaded"] .kickback-wordmark { visibility: visible }
</style>
