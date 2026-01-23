<script lang="ts">
  import { supabase } from '$lib/supabase';

  let email = '';
  let password = '';
  let loading = false;
  let message = '';
  let mode: 'signup' | 'signin' = 'signup';

  async function handleAuth() {
    loading = true;
    message = '';

    try {
      let user = null;
      let session = null;

      if (mode === 'signin') {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
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
            emailRedirectTo: `${window.location.origin}/admin`
          }
        });
        if (signUpError) {
          message = signUpError.message;
          return;
        }
        user = signUpData?.user ?? null;
        session = signUpData?.session ?? null;
        if (!session) {
          message = 'Check your email to confirm your admin access.';
          return;
        }
      }

      if (session) {
        await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
      }

      if (user) {
        await supabase.from('profiles').upsert({
          id: user.id,
          role: 'owner',
          updated_at: new Date().toISOString()
        });
      }

      if (session) {
        window.location.href = '/admin';
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
        {mode === 'signin' ? 'Owner Access' : 'Create Owner Access'}
      </h1>
      <p class="text-zinc-500 mt-2">Pilot admin login for venue owners.</p>
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
        placeholder={mode === 'signin' ? 'Password' : 'Create Password'}
        class="w-full bg-zinc-800 border-none p-4 rounded-2xl outline-none focus:ring-2 focus:ring-white"
      />

      <button
        type="submit"
        disabled={loading || !email || !password}
        class="w-full bg-white text-black font-black py-4 rounded-2xl uppercase tracking-tight active:scale-95 transition-all disabled:opacity-50"
      >
        {loading ? 'Processing...' : mode === 'signin' ? 'Sign In' : 'Create Owner Account'}
      </button>

      {#if message}
        <p class="text-center text-xs font-bold text-zinc-400 uppercase">{message}</p>
      {/if}
    </form>

    {#if mode === 'signup'}
      <button type="button" on:click={() => { mode = 'signin'; message = ''; }} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
        Already have access? Sign in
      </button>
    {:else}
      <button type="button" on:click={() => { mode = 'signup'; message = ''; }} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
        New venue owner? Create access
      </button>
    {/if}

    <button on:click={() => window.location.href = '/login'} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
      Back to member login
    </button>
  </div>
</main>
