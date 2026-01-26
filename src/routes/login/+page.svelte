<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';
  import { fetchActiveVenues } from '$lib/venues/repository';
  import { calculateKickbackWithRate } from '$lib/claims/utils';
  import { KICKBACK_RATE } from '$lib/claims/constants';
  import { fade } from 'svelte/transition';
  import { generateReferralCode, normalizeReferralCode } from '$lib/referrals/code';
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
  let resendMessage = '';
  let showResend = false;
  let pendingKickback: string | null = null;
  let mode: 'signup' | 'signin' = 'signup';
  let venueRates: { id: string; name: string; short_code?: string | null; kickback_guest?: number | null }[] = [];
  let showPassword = false;

  async function isReferralCodeAvailable(code: string, userId?: string): Promise<boolean> {
    const normalized = normalizeReferralCode(code);
    const { data, error } = await supabase.from('profiles').select('id').ilike('referral_code', normalized);
    if (error) throw error;
    if (!data || data.length === 0) return true;
    if (userId) return data.every((row) => row.id === userId);
    return false;
  }

  async function generateUniqueReferralCode(userId: string): Promise<string> {
    for (let i = 0; i < 20; i += 1) {
      const code = generateReferralCode(4);
      if (await isReferralCodeAvailable(code, userId)) return code;
    }
    return generateReferralCode(4);
  }

  onMount(async () => {
    try {
      venueRates = await fetchActiveVenues();
    } catch (error) {
      console.error('Error loading venues:', error);
      venueRates = [];
    }

    const draft = getDraftFromUrl(window.location.search) ?? getDraftFromStorage(localStorage);
    const amountValue = Number(draft?.amount ?? '');
    const venueCode = draft?.venueCode ?? '';
    const venueId =
      draft?.venueId ??
      venueRates.find((venue) => (venue.short_code ?? '').toUpperCase() === venueCode.toUpperCase())?.id ??
      '';
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
    resendMessage = '';
    showResend = false;

    const params = new URLSearchParams(window.location.search);
    const draft = buildDraftFromParams(params);
    const draftQuery = draftToQuery(draft);
    const redirectUrl = draftQuery ? `https://kkbk.app/?${draftQuery}` : 'https://kkbk.app/';

    saveDraftToStorage(localStorage, draft);

    try {
      let user = null;
      let session = null;

      let isSignup = false;

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
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password
          });
          if (signInError) {
            message = signUpError.message;
            return;
          }
          user = signInData?.user ?? null;
          session = signInData?.session ?? null;
        } else {
          user = signUpData?.user ?? null;
          session = signUpData?.session ?? null;
          isSignup = Boolean(user);
          if (!session) {
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
              email,
              password
            });
            if (signInError) {
              message = 'Check your email to confirm!';
              showResend = true;
              return;
            }
            user = signInData?.user ?? null;
            session = signInData?.session ?? null;
          }
        }
      }

      // 4. Ensure session is persisted, then sync profile if user exists
      if (session) {
        await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
      }

      if (user) {
        const profilePayload: { id: string; updated_at: string; last_4?: string; referral_code?: string } = {
          id: user.id,
          updated_at: new Date().toISOString()
        };
        if (draft.last4) profilePayload.last_4 = draft.last4;
        if (isSignup) {
          try {
            profilePayload.referral_code = await generateUniqueReferralCode(user.id);
          } catch (error) {
            console.error('Failed to generate referral code:', error);
          }
        }
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

  async function handleResend() {
    resendMessage = '';
    if (!email) {
      resendMessage = 'Enter your email above to resend.';
      return;
    }

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email
    });

    resendMessage = error ? error.message : 'Confirmation email sent.';
  }
</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
  <div class="w-full max-w-sm space-y-8">
    
    <div class="text-center">
      <h1 class="text-3xl font-black italic uppercase tracking-tighter">
        {#if mode === 'signin'}
          Welcome Back
        {:else}
          Join <span class="text-white">Kick</span><span class="text-orange-500">back</span>
        {/if}
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
      <div class="relative">
        <input 
          type={showPassword ? 'text' : 'password'} 
          bind:value={password} 
          placeholder="Create Password" 
          class="w-full bg-zinc-800 border-none p-4 pr-16 rounded-2xl outline-none focus:ring-2 focus:ring-white"
        />
        <button
          type="button"
          on:click={() => (showPassword = !showPassword)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors"
        >
          {#if showPassword}
            <svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M6.8 6.8C4.2 8.4 2 12 2 12s4 6 10 6c2.1 0 3.9-.6 5.4-1.6" />
              <path d="M9.9 4.2C10.6 4.1 11.3 4 12 4c6 0 10 6 10 6s-.9 1.4-2.4 2.9" />
            </svg>
          {/if}
        </button>
      </div>
      
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
      {#if showResend}
        <button
          type="button"
          on:click={handleResend}
          class="w-full text-zinc-500 text-[10px] font-bold uppercase tracking-[0.3em] hover:text-white transition-colors"
        >
          Resend confirmation email
        </button>
        {#if resendMessage}
          <p transition:fade class="text-center text-[10px] font-bold text-zinc-500 uppercase">{resendMessage}</p>
        {/if}
      {/if}
    </form>

    {#if mode === 'signup'}
      <p class="text-center text-[10px] text-zinc-500 leading-snug">
        By creating an account, you are agreeing to our
        <a href="/terms" class="text-zinc-300 hover:text-white transition-colors">terms of service</a>
        and
        <a href="/privacy" class="text-zinc-300 hover:text-white transition-colors">privacy policy</a>.
      </p>
      <button type="button" on:click={() => { mode = 'signin'; message = ''; }} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
        Already have an account? Sign in
      </button>
    {:else}
      <button type="button" on:click={() => { mode = 'signup'; message = ''; }} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
        New here? Join <span class="text-white">Kick</span><span class="text-orange-500">back</span>
      </button>
    {/if}
    
    <button on:click={() => window.history.back()} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
      Go Back
    </button>
  </div>
</main>

