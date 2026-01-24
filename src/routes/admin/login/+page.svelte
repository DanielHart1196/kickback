<script lang="ts">
  import { supabase } from '$lib/supabase';

  let email = '';
  let password = '';
  let loading = false;
  let message = '';
  let resendMessage = '';
  let showResend = false;
  let mode: 'signup' | 'signin' = 'signup';
  let showPassword = false;

  async function handleAuth() {
    loading = true;
    message = '';
    resendMessage = '';
    showResend = false;

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
          if (!session) {
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
              email,
              password
            });
            if (signInError) {
              message = 'Check your email to confirm your admin access.';
              showResend = true;
              return;
            }
            user = signInData?.user ?? null;
            session = signInData?.session ?? null;
          }
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
        {mode === 'signin' ? 'Admin Sign In' : 'Admin Sign Up'}
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
      <div class="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          bind:value={password}
          placeholder={mode === 'signin' ? 'Password' : 'Create Password'}
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
        {loading ? 'Processing...' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
      </button>

      {#if message}
        <p class="text-center text-xs font-bold text-zinc-400 uppercase">{message}</p>
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
          <p class="text-center text-[10px] font-bold text-zinc-500 uppercase">{resendMessage}</p>
        {/if}
      {/if}
    </form>

    {#if mode === 'signup'}
      <button type="button" on:click={() => { mode = 'signin'; message = ''; }} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
        Already have an account? Sign in
      </button>
    {:else}
      <button type="button" on:click={() => { mode = 'signup'; message = ''; }} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
        New venue owner? Create account
      </button>
    {/if}

    <button on:click={() => window.location.href = '/login'} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
      Back to member login
    </button>
  </div>
</main>
