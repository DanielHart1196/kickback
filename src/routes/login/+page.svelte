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
    getDraftFromStorage,
    getDraftFromUrl,
    saveDraftToStorage
  } from '$lib/claims/draft';

  let email = '';
  let password = '';
  let loading = false;
  let message = '';
  let pendingKickback: string | null = null;
  let mode: 'signup' | 'signin' = 'signup';
  let venueRates: { id: string; name: string; kickback_guest?: number | null }[] = [];

  onMount(async () => {
    try {
      venueRates = await fetchActiveVenues();
    } catch (error) {
      console.error('Error loading venues:', error);
      venueRates = [];
    }

    const draft = getDraftFromUrl(window.location.search) ?? getDraftFromStorage(localStorage);
    const amountValue = Number(draft?.amount ?? '');
    const venueId = draft?.venueId ?? '';
    const venueName = draft?.venue ?? '';
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
  });

  async function handleAuth() {
    loading = true;
    message = '';

    const params = new URLSearchParams(window.location.search);
    const draft = buildDraftFromParams(params);
    const draftQuery = draftToQuery(draft);
    const redirectUrl = draftQuery ? `https://kkbk.app/?${draftQuery}` : 'https://kkbk.app/';

    saveDraftToStorage(localStorage, draft);

    try {
      let user = null;
      let session = null;

      if (mode === 'signin') {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          message = signInError.message;
          return;
        }
        user = signInData?.user ?? null;
        session = signInData?.session ?? null;
      } else {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            // IMPORTANT: This tells Supabase where to send them after email confirmation
            emailRedirectTo: redirectUrl
          }
        });

        if (signUpError) {
          message = signUpError.message;
          return;
        }
        user = signUpData?.user ?? null;
        session = signUpData?.session ?? null;
        message = "Check your email to confirm!";
      }

      // 4. Ensure session is persisted, then sync profile if user exists
      if (session) {
        await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
      }

      if (user) {
        const profilePayload: { id: string; updated_at: string; last_4?: string } = {
          id: user.id,
          updated_at: new Date().toISOString()
        };
        if (draft.last4) profilePayload.last_4 = draft.last4;
        await supabase.from('profiles').upsert(profilePayload);
      }

      // 5. Final Redirect (only when session is established)
      if (session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user?.id ?? '')
          .maybeSingle();
        const role = profile?.role ?? 'member';
        if (role === 'owner' || role === 'admin') {
          window.location.href = '/admin';
        } else {
          window.location.href = draftQuery ? `/?${draftQuery}` : '/';
        }
      }
    } catch (error) {
      message = error instanceof Error ? error.message : 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
  <div class="w-full max-w-sm space-y-8">
    
    <div class="text-center">
      <h1 class="text-3xl font-black italic uppercase tracking-tighter">
        {mode === 'signin' ? 'Welcome Back' : 'Join Kickback'}
      </h1>
      {#if pendingKickback}
        <p class="text-orange-500 font-bold mt-2">Sign up to claim your ${pendingKickback} kickback</p>
      {:else}
        <p class="text-zinc-500 mt-2">Start earning 5% on every round.</p>
      {/if}
    </div>

    <form class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl space-y-4" on:submit|preventDefault={handleAuth}>
      <input 
        type="email" 
        bind:value={email} 
        placeholder="Email" 
        class="w-full bg-zinc-800 border-none p-4 rounded-2xl outline-none focus:ring-2 focus:ring-white"
      />
      <input 
        type="password" 
        bind:value={password} 
        placeholder="Create Password" 
        class="w-full bg-zinc-800 border-none p-4 rounded-2xl outline-none focus:ring-2 focus:ring-white"
      />
      
      <button 
        type="submit"
        disabled={loading || !email || !password}
        class="w-full bg-white text-black font-black py-4 rounded-2xl uppercase tracking-tight active:scale-95 transition-all disabled:opacity-50"
      >
        {loading ? 'Processing...' : mode === 'signin' ? 'Sign In' : 'Continue'}
      </button>

      {#if message}
        <p transition:fade class="text-center text-xs font-bold text-zinc-400 uppercase">{message}</p>
      {/if}
    </form>

    {#if mode === 'signup'}
      <button type="button" on:click={() => { mode = 'signin'; message = ''; }} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
        Already have an account? Sign in
      </button>
    {:else}
      <button type="button" on:click={() => { mode = 'signup'; message = ''; }} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
        New here? Join Kickback
      </button>
    {/if}
    
    <button on:click={() => window.history.back()} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
      Go Back
    </button>
  </div>
</main>

