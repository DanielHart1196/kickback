<script lang="ts">
  import { supabase } from '$lib/supabase';
  
  let amount: number | null = null;
  let last4: string = '';
  let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let errorMessage: string = '';

  async function submitClaim() {
    if (!amount || last4.length !== 4) {
      status = 'error';
      errorMessage = 'Please enter a valid amount and 4 digits.';
      return;
    }

    status = 'loading';
    
    try {
      const { error } = await supabase
        .from('claims') // Make sure your table is named 'claims' in Supabase
        .insert([{ 
          amount, 
          last_4: last4,
          created_at: new Date().toISOString()
        }]);

      if (error) throw error;

      status = 'success';
      amount = null;
      last4 = '';
    } catch (e: any) {
      status = 'error';
      errorMessage = e.message || 'Connection failed';
      console.error(e);
    }
  }
</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
  <div class="w-full max-w-sm space-y-8">
    
    <div class="text-center">
      <h1 class="text-4xl font-black tracking-tighter italic uppercase">Kickback</h1>
      <p class="text-zinc-500 text-sm mt-2">Pilot Program • Entry Portal</p>
    </div>

    <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl">
      <div class="space-y-5">
        
        <div>
          <label for="amount" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Total Bill</label>
          <input 
            id="amount"
            type="number" 
            bind:value={amount} 
            placeholder="0.00"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-xl font-medium focus:ring-2 focus:ring-white transition-all outline-none"
          />
        </div>

        <div>
          <label for="last4" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Card Digits (Last 4)</label>
          <input 
            id="last4"
            type="text" 
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

    {#if status === 'success'}
      <div class="bg-green-500/10 border border-green-500/50 text-green-500 p-4 rounded-2xl text-center text-sm font-bold animate-bounce">
        ✅ CLAIM SUBMITTED SUCCESSFULLY
      </div>
    {:else if status === 'error'}
      <div class="bg-red-500/10 border border-red-500/50 text-red-500 p-4 rounded-2xl text-center text-sm font-bold">
        ⚠️ {errorMessage.toUpperCase()}
      </div>
    {/if}

  </div>
</main>