<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchAllClaims } from '$lib/claims/repository';
  import { calculateTotalAmount } from '$lib/claims/utils';
  import type { Claim } from '$lib/claims/types';

  let claims: Claim[] = [];
  let loading = true;

  onMount(async () => {
    try {
      claims = await fetchAllClaims();
    } catch (error) {
      console.error('Error fetching claims:', error);
    } finally {
      loading = false;
    }
  });

  $: totalAmount = calculateTotalAmount(claims);
</script>

<div class="p-4 md:p-10 bg-zinc-950 min-h-screen text-zinc-100 font-sans">
  <div class="max-w-4xl mx-auto mb-10 flex justify-between items-end">
    <div>
      <h1 class="text-zinc-500 uppercase tracking-tighter text-sm font-bold">Kickback Dashboard</h1>
      <div class="text-6xl font-black text-white mt-1">${totalAmount.toFixed(2)}</div>
    </div>
    <div class="text-right">
      <div class="text-zinc-500 text-sm uppercase font-bold">Total Claims</div>
      <div class="text-2xl font-bold">{claims.length}</div>
    </div>
  </div>

  <div class="max-w-4xl mx-auto bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="bg-zinc-800/50 text-zinc-400 text-xs uppercase">
          <th class="p-4 font-semibold">Date/Time</th>
          <th class="p-4 font-semibold text-right">Amount</th>
          <th class="p-4 font-semibold text-center">Last 4</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-zinc-800">
        {#each claims as claim}
          <tr class="hover:bg-zinc-800/30 transition-colors">
            <td class="p-4 text-zinc-400 text-sm">
              {new Date(claim.created_at).toLocaleDateString()} 
              <span class="text-zinc-600 ml-1">{new Date(claim.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </td>
            <td class="p-4 text-right font-mono font-bold text-orange-400">
              ${Number(claim.amount).toFixed(2)}
            </td>
            <td class="p-4 text-center">
              <span class="bg-zinc-800 px-2 py-1 rounded text-xs text-zinc-300">**** {claim.last_4}</span>
            </td>
          </tr>
        {:else}
          {#if !loading}
            <tr>
              <td colspan="3" class="p-10 text-center text-zinc-500 italic">No claims found yet. Go get some!</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</div>

