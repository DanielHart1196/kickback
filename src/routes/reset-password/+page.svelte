<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';

  const MIN_PASSWORD_LENGTH = 6;
  let password = '';
  let confirmPassword = '';
  let saving = false;
  let message = '';
  let status: 'idle' | 'success' | 'error' = 'idle';

  onMount(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      await goto('/login');
    }
  });

  async function handleUpdatePassword() {
    if (!password) {
      status = 'error';
      message = 'Enter a new password';
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      status = 'error';
      message = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
      return;
    }
    if (password !== confirmPassword) {
      status = 'error';
      message = 'Passwords do not match';
      return;
    }

    saving = true;
    status = 'idle';
    message = '';

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      status = 'success';
      message = 'Password updated. Redirecting...';
      setTimeout(() => {
        void goto('/');
      }, 900);
    } catch (error) {
      status = 'error';
      message = error instanceof Error ? error.message : 'Failed to update password';
    } finally {
      saving = false;
    }
  }
</script>

<main class="min-h-screen bg-black text-white flex items-center justify-center p-6">
  <div class="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
    <h1 class="text-lg font-black uppercase tracking-[0.2em] text-white">Set New Password</h1>
    <p class="mt-2 text-xs text-zinc-500 uppercase">Use at least {MIN_PASSWORD_LENGTH} characters.</p>

    <div class="mt-5 space-y-3">
      <input
        type="password"
        bind:value={password}
        placeholder="New password"
        disabled={saving}
        class="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
      />
      <input
        type="password"
        bind:value={confirmPassword}
        placeholder="Confirm new password"
        disabled={saving}
        on:keydown={(e) => e.key === 'Enter' && handleUpdatePassword()}
        class="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
      />
      <button
        type="button"
        on:click={handleUpdatePassword}
        disabled={saving}
        class="w-full h-10 rounded-full bg-orange-500 text-black text-[14px] leading-[20px] font-black inline-flex items-center justify-center active:scale-95 transition-all disabled:opacity-50 hover:bg-orange-600"
      >
        {saving ? 'UPDATING...' : 'UPDATE PASSWORD'}
      </button>
      {#if message}
        <p class={`text-center text-xs font-bold uppercase ${status === 'error' ? 'text-red-400' : 'text-zinc-400'}`}>
          {message}
        </p>
      {/if}
    </div>
  </div>
</main>
