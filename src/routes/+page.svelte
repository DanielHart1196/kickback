<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  
  let amount: number | null = null;
  let last4: string = '';
  let venue: string = '';
  let referrer: string = '';
  let purchaseTime: string = '';
  let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let errorMessage: string = '';

  let isReferrerLocked: boolean = false;
  let isVenueLocked: boolean = false;

  onMount(async () => {
    // 1. Set default time to "Now"
    const now = new Date();
    // This magic line formats it for the HTML datetime-local input
    purchaseTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    // 2. Check URL for pre-fills (e.g., ?venue=BarOne&ref=User123)
    const params = new URLSearchParams(window.location.search);
    if (params.get('venue')) venue = params.get('venue') || '';
    if (params.get('ref')) referrer = params.get('ref') || '';

    // 3. Logic for Locking Referrer
    // We'll need a Supabase query here later to check if this user + bar exists.
    // For now, if it comes from a QR code, we'll lock it.
    if (referrer) isReferrerLocked = true;
    if (venue) isVenueLocked = true;
  });

  async function submitClaim() {
    if (!amount || amount <= 0) {
      status = 'error';
      errorMessage = 'Please enter a valid amount';
      return;
    }

    const cleanAmount = Math.round(amount * 100) / 100;

    if (last4.length !== 4) {
      status = 'error';
      errorMessage = 'Please enter 4 digits';
      return;
    }

    status = 'loading';
    
    try {
      const { error } = await supabase
        .from('claims') // Make sure your table is named 'claims' in Supabase
        .insert([{ 
          venue,
          referrer,
          amount: cleanAmount, 
          purchased_at: new Date(purchaseTime).toISOString(),
          last_4: last4,
          created_at: new Date().toISOString()
        }]);

      if (error) throw error;

      status = 'success';
      amount = null;
      last4 = '';
      setTimeout(() => {
        if (status === 'success') {
          status = 'idle';
        }
      }, 4000);
    } catch (e: any) {
      status = 'error';
      errorMessage = e.message || 'Connection failed';
      console.error(e);
    }
  }
  $: last4 = last4.replace(/\D/g, '');
</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">

  <div class="fixed top-10 left-0 right-0 px-6 z-[100] pointer-events-none">
    {#if status === 'success'}
      <div 
        in:fly={{ y: -20, duration: 400 }} 
        out:fade={{ duration: 300 }}
        class="bg-green-500 border border-green-400 text-white p-4 rounded-2xl text-center text-sm font-black shadow-2xl shadow-green-500/40 pointer-events-auto"
      >
        ✅ CLAIM SUBMITTED SUCCESSFULLY
      </div>
    {:else if status === 'error'}
      <div 
        in:fly={{ y: -20, duration: 400 }} 
        out:fade={{ duration: 300 }}
        class="bg-red-500 border border-red-400 text-white p-4 rounded-2xl text-center text-sm font-black shadow-2xl shadow-red-500/40 pointer-events-auto"
      >
        ⚠️ {errorMessage.toUpperCase()}
      </div>
    {/if}
  </div>

  <div class="w-full max-w-sm space-y-8">
    
    <div class="text-center">
      <h1 class="text-4xl font-black tracking-tighter italic uppercase">Kickback</h1>
      <p class="text-zinc-500 text-sm mt-2">Pilot Program • Claim Portal</p>
    </div>

    <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl">
      <div class="space-y-5">
        
        <div>
          <label for="venue" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Venue</label>
          <input 
            id="venue"
            type="text" 
            bind:value={venue} 
            readonly={isVenueLocked}
            placeholder="Bar Name"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none {isVenueLocked ? 'opacity-50 cursor-not-allowed' : ''}"
          />
        </div>

        <div>
          <label for="referrer" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Referrer ID</label>
          <input 
            id="referrer"
            type="text" 
            bind:value={referrer} 
            readonly={isReferrerLocked}
            placeholder="Who sent you?"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none {isReferrerLocked ? 'opacity-50 cursor-not-allowed' : ''}"
          />
        </div>

        <div>
          <label for="amount" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Total Bill</label>
          <input 
            id="amount"
            type="number" 
            min="0"
            step="0.01"
            bind:value={amount} 
            placeholder="10.00"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-xl font-medium focus:ring-2 focus:ring-white transition-all outline-none"
          />
        </div>

        <div>
          <label for="time" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Time of Purchase</label>
          <input 
            id="time"
            type="datetime-local" 
            bind:value={purchaseTime} 
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none [color-scheme:dark]"
          />
        </div>

        <div>
          <label for="last4" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Card Digits (Last 4)</label>
          <input 
            id="last4"
            type="text" 
            inputmode="numeric"
            pattern="[0-9]*"
            bind:value={last4} 
            placeholder="1234"
            maxlength="4"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-xl font-medium focus:ring-2 focus:ring-white transition-all outline-none"
          />
        </div>

        <button 
          on:click={submitClaim}
          disabled={status === 'loading'}
          class="w-full bg-white text-black font-black p-4 rounded-2xl hover:bg-zinc-200 active:scale-95 transition-all disabled:opacity-50"
        >
          {status === 'loading' ? 'PROCESSING...' : 'SUBMIT CLAIM'}
        </button>

      </div>
    </div>
  </div>
</main>