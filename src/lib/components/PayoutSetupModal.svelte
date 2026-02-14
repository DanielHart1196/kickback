<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { supabase } from '$lib/supabase';

  export let userId: string;
  export let onClose: () => void;
  export let onSuccess: () => void = () => {};

  let fullName = '';
  let payId = '';
  let isHobbyist = false;
  let hobbyistConfirmedAt: string | null = null;
  let status: 'idle' | 'saving' | 'success' | 'error' = 'idle';
  let errorMessage = '';
  let successMessage = '';

  async function handleSave() {
    if (!userId) return;

    if (isHobbyist && !hobbyistConfirmedAt) {
      hobbyistConfirmedAt = new Date().toISOString();
    } else if (!isHobbyist) {
      hobbyistConfirmedAt = null;
    }

    status = 'saving';
    errorMessage = '';
    successMessage = '';

    try {
      const trimmedPayId = payId.trim();
      
      if (trimmedPayId) {
        // Check if pay_id is already used by another user
        const { data: existing, error: checkError } = await supabase
          .from('payout_profiles')
          .select('user_id')
          .eq('pay_id', trimmedPayId)
          .neq('user_id', userId)
          .maybeSingle();

        if (checkError) throw checkError;
        if (existing) {
          throw new Error('This PayID is already registered to another user');
        }
      }

      const payload = {
        user_id: userId,
        pay_id: trimmedPayId || null,
        full_name: fullName.trim() || null,
        is_hobbyist: isHobbyist,
        hobbyist_confirmed_at: hobbyistConfirmedAt,
        updated_at: new Date().toISOString()
      };

      console.log('Saving payload:', payload);

      const { error } = await supabase
        .from('payout_profiles')
        .upsert(payload, { onConflict: 'user_id' });

      console.log('Save result:', { error });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      status = 'success';
      successMessage = 'Payout details saved';
      setTimeout(() => {
        onClose();
        // Force a page refresh to ensure data is reloaded
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, 1500);
    } catch (error: any) {
      status = 'error';
      if (error?.code === '23505') {
        errorMessage = 'This PayID is already registered to another user';
      } else {
        errorMessage = error instanceof Error ? error.message : 'Failed to save payout details';
      }
    }
  }
</script>

<div class="fixed inset-0 z-[300] flex items-center justify-center px-6">
  <div 
    class="absolute inset-0 bg-black/80 backdrop-blur-sm" 
    on:click={onClose}
  ></div>

  <div 
    class="relative w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-[2.5rem] p-8 shadow-2xl"
    transition:fly={{ y: 40, duration: 300 }}
  >
    <div class="text-center mb-8">
      <h2 class="text-xl font-black uppercase tracking-widest text-white">Payout Details</h2>
      <p class="mt-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Set up how you'll get paid</p>
    </div>

    <div class="space-y-6">
      <div>
        <label for="modal-full-name" class="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">
          Full Name
        </label>
        <input
          id="modal-full-name"
          type="text"
          bind:value={fullName}
          placeholder="Your legal name"
          class="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm text-white placeholder-zinc-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-all"
        />
      </div>

      <div>
        <label for="modal-payid" class="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">
          PayID
        </label>
        <input
          id="modal-payid"
          type="text"
          bind:value={payId}
          placeholder="Phone or email"
          class="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm text-white placeholder-zinc-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-all"
        />
      </div>

      <label class="flex items-start gap-4 cursor-pointer group pt-2">
        <div class="relative flex items-center pt-1">
          <input
            type="checkbox"
            bind:checked={isHobbyist}
            class="peer h-5 w-5 rounded-lg border-zinc-800 bg-zinc-900 text-orange-500 focus:ring-orange-500/20 focus:ring-offset-0 transition-all cursor-pointer appearance-none border"
          />
          <svg 
            class="absolute h-5 w-5 text-orange-500 opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none p-1" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor" 
            stroke-width="4"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div class="flex-1">
          <p class="text-[11px] font-black uppercase tracking-widest text-white group-hover:text-orange-500 transition-colors">
            I confirm I'm a Hobbyist
          </p>
          <p class="mt-1 text-[10px] leading-relaxed font-bold text-zinc-500 uppercase tracking-tight">
            I agree that my referrals are a social/recreational activity and not a business. 
            <a href="https://kkbk.app/terms" target="_blank" class="text-orange-500/80 hover:text-orange-500 underline decoration-orange-500/30 transition-colors">Terms</a>
          </p>
        </div>
      </label>

      {#if errorMessage}
        <p class="text-[10px] font-black uppercase tracking-widest text-red-500 text-center">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="text-[10px] font-black uppercase tracking-widest text-green-500 text-center">{successMessage}</p>
      {/if}

      <div class="pt-4 space-y-4">
        <button
          type="button"
          on:click={handleSave}
          disabled={status === 'saving'}
          class="w-full rounded-2xl bg-white py-4 text-sm font-black uppercase tracking-widest text-black hover:bg-orange-500 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
        >
          {status === 'saving' ? 'Saving...' : 'Save Details'}
        </button>

        <button
          type="button"
          on:click={onClose}
          class="w-full text-center text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 hover:text-zinc-300 transition-colors pt-2"
        >
          Skip for now
        </button>
      </div>
    </div>
  </div>
</div>
