<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';

  const MIN_PASSWORD_LENGTH = 6;
  let loading = false;
  let message = '';
  let magicLinkEmail = '';
  let password = '';
  let usePassword = false;
  let magicLinkLoading = false;
  let passwordAuthLoading = false;
  let adminSignupCode = '';
  let showAdminSignupCode = false;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function handleGoogleOAuth() {
    if (showAdminSignupCode && adminSignupCode.trim() !== '3095') {
      message = 'Please enter a valid admin sign-up code';
      return;
    }
    loading = true;
    message = '';

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(window.location.origin + '/admin')}&admin_code=${encodeURIComponent(adminSignupCode)}`
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
    if (!magicLinkEmail) {
      message = 'Please enter your email address';
      return;
    }
    if (!emailPattern.test(magicLinkEmail.trim())) {
      message = 'Please enter a valid email address';
      return;
    }

    magicLinkLoading = true;
    message = '';

    try {
      const accessCheckRes = await fetch('/api/admin/access-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicLinkEmail })
      });
      const accessCheck = await accessCheckRes.json().catch(() => null);
      if (!accessCheckRes.ok || !accessCheck?.ok) {
        message = accessCheck?.error ?? 'Unable to verify admin access';
        return;
      }

      if (accessCheck.requires_code) {
        showAdminSignupCode = true;
        if (adminSignupCode.trim() !== '3095') {
          message = 'Enter admin sign-up code to continue';
          return;
        }
      }

      const { data, error } = await supabase.auth.signInWithOtp({
        email: magicLinkEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(window.location.origin + '/admin')}&email=${encodeURIComponent(magicLinkEmail)}&admin_code=${encodeURIComponent(adminSignupCode)}`
        }
      });

      if (error) {
        message = error.message;
      } else {
        message = 'MAGIC LINK SENT, CHECK YOUR INBOX';
      }
    } catch (error) {
      message = error instanceof Error ? error.message : 'Failed to send magic link';
    } finally {
      magicLinkLoading = false;
    }
  }

  async function handlePasswordAuth() {
    if (!magicLinkEmail) {
      message = 'Please enter your email address';
      return;
    }
    if (!emailPattern.test(magicLinkEmail.trim())) {
      message = 'Please enter a valid email address';
      return;
    }
    if (!password) {
      message = 'Please enter your password';
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      message = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
      return;
    }

    passwordAuthLoading = true;
    message = '';

    try {
      const accessCheckRes = await fetch('/api/admin/access-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicLinkEmail })
      });
      const accessCheck = await accessCheckRes.json().catch(() => null);
      if (!accessCheckRes.ok || !accessCheck?.ok) {
        message = accessCheck?.error ?? 'Unable to verify admin access';
        return;
      }

      if (accessCheck.requires_code) {
        showAdminSignupCode = true;
        if (adminSignupCode.trim() !== '3095') {
          message = 'Enter admin sign-up code to continue';
          return;
        }
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: magicLinkEmail,
        password
      });

      if (error) {
        message = error.message;
      } else {
        window.location.href = '/admin';
      }
    } catch (error) {
      message = error instanceof Error ? error.message : 'Failed to sign in';
    } finally {
      passwordAuthLoading = false;
    }
  }

  async function handleForgotPassword() {
    if (!magicLinkEmail) {
      message = 'Enter your email first';
      return;
    }
    if (!emailPattern.test(magicLinkEmail.trim())) {
      message = 'Please enter a valid email address';
      return;
    }

    passwordAuthLoading = true;
    message = '';

    try {
      const resetRedirectTo = `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(window.location.origin + '/reset-password')}`;
      const { error } = await supabase.auth.resetPasswordForEmail(magicLinkEmail, {
        redirectTo: resetRedirectTo
      });
      if (error) {
        message = error.message;
      } else {
        message = "IF AN ACCOUNT EXISTS FOR THAT EMAIL, WE'LL SEND A RESET LINK";
      }
    } catch (error) {
      message = error instanceof Error ? error.message : 'Failed to send password reset email';
    } finally {
      passwordAuthLoading = false;
    }
  }

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'admin_code_required') {
      message = 'Valid admin sign-up code required for new owner access';
      showAdminSignupCode = true;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session?.user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle();

    const role = profile?.role ?? 'member';
    if (role === 'owner' || role === 'admin') {
      window.location.href = '/admin';
    }
  });
</script>

<main class="min-h-screen bg-black text-white flex flex-col items-center p-6">
  <div class="w-full max-w-sm space-y-5">
    <div class="text-center pt-16 pb-16">
      <div class="min-h-[44px] flex items-center justify-center">
        <h1 class="text-3xl font-black italic uppercase tracking-tighter leading-none whitespace-normal md:whitespace-nowrap">
          Admin Sign In
        </h1>
      </div>
    </div>

    <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl space-y-4 flex flex-col items-center">
      <button
        type="button"
        on:click={handleGoogleOAuth}
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
        bind:value={magicLinkEmail}
        placeholder="Enter your email"
        disabled={magicLinkLoading || passwordAuthLoading}
        on:keydown={(e) => e.key === 'Enter' && (usePassword ? handlePasswordAuth() : handleMagicLink())}
        class="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
      />
      {#if usePassword}
        <input
          type="password"
          bind:value={password}
          placeholder="Enter your password"
          disabled={passwordAuthLoading}
          on:keydown={(e) => e.key === 'Enter' && handlePasswordAuth()}
          class="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
        />
      {/if}
      {#if showAdminSignupCode}
        <input
          type="text"
          bind:value={adminSignupCode}
          placeholder="Admin sign-up code"
          disabled={loading || magicLinkLoading || passwordAuthLoading}
          class="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
        />
      {/if}
      <button
        type="button"
        on:click={usePassword ? handlePasswordAuth : handleMagicLink}
        disabled={magicLinkLoading || passwordAuthLoading}
        class="w-full h-10 rounded-full bg-orange-500 text-black text-[14px] leading-[20px] font-black inline-flex items-center justify-center active:scale-95 transition-all disabled:opacity-50 hover:bg-orange-600"
      >
        {#if usePassword}
          {passwordAuthLoading ? 'SIGNING IN...' : 'SIGN IN'}
        {:else}
          {magicLinkLoading ? 'SENDING...' : 'SEND MAGIC LINK'}
        {/if}
      </button>
      {#if usePassword}
        <button
          type="button"
          on:click={handleForgotPassword}
          disabled={passwordAuthLoading || magicLinkLoading}
          class="text-xs font-semibold text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
        >
          Forgot password?
        </button>
      {/if}
      <button
        type="button"
        on:click={() => {
          usePassword = !usePassword;
          message = '';
          if (!usePassword) password = '';
        }}
        disabled={magicLinkLoading || passwordAuthLoading}
        class="text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
      >
        {usePassword ? 'Use magic link instead' : 'Use a password instead'}
      </button>

      {#if message}
        <p class="text-center text-xs font-bold text-zinc-400 uppercase">{message}</p>
      {/if}
    </div>

    <p class="text-center text-[10px] text-zinc-500 leading-snug">
      By creating an account, you are agreeing to our
      <a href="/terms" class="text-zinc-300 hover:text-white transition-colors">terms of service</a>
      and
      <a href="/privacy" class="text-zinc-300 hover:text-white transition-colors">privacy policy</a>.
    </p>

    <button on:click={() => window.location.href = '/login'} class="w-full text-zinc-600 text-xs font-bold uppercase">
      Back to member login
    </button>
  </div>
</main>
