<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  let email = '';
  let password = '';
  let loading = false;
  let message = '';
  let pendingAmount: string | null = null;

  onMount(() => {
    // Grab the amount from the URL so we don't lose it!
    const params = new URLSearchParams(window.location.search);
    pendingAmount = params.get('amount');
  });

  async function handleAuth() {
  loading = true;
  message = '';

  const params = new URLSearchParams(window.location.search);
  const l4 = params.get('last4') || '';

  // 1. Try to sign in
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

  let user = signInData?.user;

  if (signInError) {
    // 2. If login fails, try to sign up
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
    
    if (signUpError) {
      message = signUpError.message;
      loading = false;
      return;
    }
    user = signUpData?.user;
    message = "Account created!";
  }

  // 3. NEW: If we have a user and a last4, save it to the profiles table RIGHT NOW
  if (user && l4) {
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ 
        id: user.id, 
        last_4: l4, 
        updated_at: new Date().toISOString() 
      });
    
    if (profileError) console.error("Profile sync error:", profileError.message);
  }

  // 4. Redirect back
  const amt = params.get('amount') || '';
  const vn = params.get('venue') || '';
  const rf = params.get('ref') || '';
  window.location.href = `/?amount=${amt}&venue=${vn}&ref=${rf}&last4=${l4}`;
}
</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
  <div class="w-full max-w-sm space-y-8">
    
    <div class="text-center">
      <h1 class="text-3xl font-black italic uppercase tracking-tighter">Join Kickback</h1>
      {#if pendingAmount}
        <p class="text-green-500 font-bold mt-2">Finish claiming your ${((Number(pendingAmount) * 0.05).toFixed(2))} reward</p>
      {:else}
        <p class="text-zinc-500 mt-2">Start earning 5% on every round.</p>
      {/if}
    </div>

    <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl space-y-4">
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
        on:click={handleAuth}
        disabled={loading || !email || !password}
        class="w-full bg-white text-black font-black py-4 rounded-2xl uppercase tracking-tight active:scale-95 transition-all disabled:opacity-50"
      >
        {loading ? 'Processing...' : 'Continue'}
      </button>

      {#if message}
        <p transition:fade class="text-center text-xs font-bold text-zinc-400 uppercase">{message}</p>
      {/if}
    </div>
    
    <button on:click={() => window.history.back()} class="w-full text-zinc-600 text-xs font-bold uppercase tracking-widest">
      ← Go Back
    </button>
  </div>
</main>