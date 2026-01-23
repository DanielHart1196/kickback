<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';
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

  onMount(() => {
    const draft = getDraftFromUrl(window.location.search) ?? getDraftFromStorage(localStorage);
    const amountValue = Number(draft?.amount ?? '');
    pendingKickback =
      Number.isFinite(amountValue) && amountValue > 0 ? (amountValue * 0.05).toFixed(2) : null;
  });

  async function handleAuth() {
    loading = true;
    message = '';

    const params = new URLSearchParams(window.location.search);
    const draft = buildDraftFromParams(params);
    const draftQuery = draftToQuery(draft);
    const redirectUrl = draftQuery ? `https://kkbk.app/?${draftQuery}` : 'https://kkbk.app/';

    saveDraftToStorage(localStorage, draft);

    // 2. Try to sign in
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    let user = signInData?.user ?? null;
    let session = signInData?.session ?? null;

    if (signInError) {
      message = signInError.message;
      // 3. Try to sign up if login fails
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
        loading = false;
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
      window.location.href = draftQuery ? `/?${draftQuery}` : '/';
    }
  }
</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
  <div class="w-full max-w-sm space-y-8">
    
    <div class="text-center">
      <h1 class="text-3xl font-black italic uppercase tracking-tighter">Join Kickback</h1>
      {#if pendingKickback}
        <p class="text-green-500 font-bold mt-2">Sign up to claim your ${pendingKickback} kickback</p>
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
        {loading ? 'Processing...' : 'Continue'}
      </button>

      {#if message}
        <p transition:fade class="text-center text-xs font-bold text-zinc-400 uppercase">{message}</p>
      {/if}
    </form>
    
    <button on:click={() => window.history.back()} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
      Go Back
    </button>
  </div>
</main>
