<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { supabase } from '$lib/supabase';

  export let userId: string;
  export let onClose: () => void;
  export let onSuccess: () => void = () => {};

  let fullName = '';
  let payId = '';
  let bsb = '';
  let accountNumber = '';
  let useBankDetails = false;
  let payoutMethod: 'payid' | 'bank' = 'payid';
  let status: 'idle' | 'saving' | 'success' | 'error' = 'idle';
  let errorMessage = '';
  let successMessage = '';
  let loadingExisting = false;

  function onlyDigits(value: string, maxLen: number) {
    return value.replace(/\D/g, '').slice(0, maxLen);
  }

  function formatBsbInput(value: string) {
    const digits = onlyDigits(value, 6);
    if (digits.length <= 3) return digits;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  async function loadExistingDetails() {
    if (!userId) return;
    loadingExisting = true;
    errorMessage = '';
    try {
      const { data, error } = await supabase
        .from('payout_profiles')
        .select('full_name, pay_id, bsb, account_number, payout_method')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return;

      fullName = data.full_name ?? '';
      payId = data.pay_id ?? '';
      bsb = formatBsbInput(data.bsb ?? '');
      accountNumber = onlyDigits(data.account_number ?? '', 9);

      const hasBank = Boolean((data.bsb ?? '').trim() || (data.account_number ?? '').trim());
      useBankDetails = data.payout_method === 'bank' || hasBank;
      payoutMethod = useBankDetails ? 'bank' : 'payid';
    } catch (error) {
      console.error('Failed to load existing payout details:', error);
    } finally {
      loadingExisting = false;
    }
  }

  onMount(() => {
    void loadExistingDetails();
  });

  async function handleSave() {
    if (!userId) return;

    status = 'saving';
    errorMessage = '';
    successMessage = '';

    try {
      const trimmedPayId = payId.trim();

      if (!useBankDetails && trimmedPayId) {
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

      payoutMethod = useBankDetails ? 'bank' : 'payid';
      const payload = {
        user_id: userId,
        pay_id: trimmedPayId || null,
        bsb: onlyDigits(bsb, 6) || null,
        account_number: onlyDigits(accountNumber, 9) || null,
        payout_method: payoutMethod,
        full_name: fullName.trim() || null,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('payout_profiles')
        .upsert(payload, { onConflict: 'user_id' });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      status = 'success';
      successMessage = 'Payout details saved';
      setTimeout(() => {
        onSuccess();
        onClose();
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
    class="absolute inset-0 bg-black/60 backdrop-blur-sm" 
    on:click={onClose}
    transition:fade={{ duration: 260 }}
  ></div>

  <div transition:fade={{ duration: 220 }}>
    <div 
      class="relative w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-[2.5rem] p-8 shadow-2xl"
      transition:fly={{ y: 40, duration: 420, easing: cubicOut }}
    >
    <div class="text-center mb-8">
      <h2 class="text-xl font-black uppercase tracking-widest text-white">Payout Details</h2>
      <p class="mt-2 text-sm font-semibold text-zinc-500">Set up how you'll get paid</p>
    </div>

    <div class="space-y-0">
      <div>
        <label for="modal-full-name" class="block text-[10px] font-black uppercase tracking-widest text-zinc-500">
          Full Name
        </label>
        <div class="h-2"></div>
        <input
          id="modal-full-name"
          type="text"
          bind:value={fullName}
          placeholder="Your legal name"
          class="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm text-white placeholder-zinc-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-all"
        />
      </div>

      <div class="h-6"></div>

      <div class="space-y-0">
        {#if !useBankDetails}
          <div class="flex items-center justify-between min-h-[18px]">
            <label class="block text-[10px] font-black uppercase tracking-widest text-zinc-500">
              PayID
            </label>
            <button
              type="button"
              on:click={() => (useBankDetails = !useBankDetails)}
              class="text-[10px] font-black uppercase tracking-widest text-orange-500/80 hover:text-orange-500 underline decoration-orange-500/30 transition-colors"
            >
              BSB + account no.
            </button>
          </div>
          <div class="h-2"></div>
          <input
            id="modal-payid"
            type="text"
            bind:value={payId}
            placeholder="Phone or email"
            class="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm text-white placeholder-zinc-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-all"
          />
        {:else}
          <div class="space-y-0">
            <div>
              <div class="flex items-center justify-between min-h-[18px]">
                <label for="modal-bsb" class="block text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  BSB
                </label>
                <button
                  type="button"
                  on:click={() => (useBankDetails = !useBankDetails)}
                  class="text-[10px] font-black uppercase tracking-widest text-orange-500/80 hover:text-orange-500 underline decoration-orange-500/30 transition-colors"
                >
                  PayID
                </button>
              </div>
              <div class="h-2"></div>
              <input
                id="modal-bsb"
                type="text"
                inputmode="numeric"
                bind:value={bsb}
                maxlength="7"
                on:input={(event) => (bsb = formatBsbInput((event.currentTarget as HTMLInputElement).value))}
                placeholder="000-000"
                class="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm text-white placeholder-zinc-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-all"
              />
            </div>
            <div class="h-4"></div>
            <div>
              <label for="modal-account" class="block text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Account No.
              </label>
              <div class="h-2"></div>
              <input
                id="modal-account"
                type="text"
                inputmode="numeric"
                bind:value={accountNumber}
                maxlength="9"
                on:input={(event) => (accountNumber = onlyDigits((event.currentTarget as HTMLInputElement).value, 9))}
                placeholder="Account number"
                class="w-full rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm text-white placeholder-zinc-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-all"
              />
            </div>
          </div>
        {/if}
      </div>

      <div class="h-6"></div>

      {#if errorMessage}
        <p class="text-[10px] font-black uppercase tracking-widest text-red-500 text-center">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="text-[10px] font-black uppercase tracking-widest text-green-500 text-center">{successMessage}</p>
      {/if}

      <div class="h-4"></div>

      <div class="space-y-4">
        <button
          type="button"
          on:click={handleSave}
          disabled={status === 'saving' || loadingExisting}
          class="w-full rounded-2xl bg-white py-4 text-sm font-black uppercase tracking-widest text-black hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
        >
          {loadingExisting ? 'Loading...' : status === 'saving' ? 'Saving...' : 'Save Details'}
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
</div>
