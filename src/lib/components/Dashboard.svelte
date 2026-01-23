<script lang="ts">
  import { fade, fly, slide } from 'svelte/transition';
  import { GOAL_DAYS } from '$lib/claims/constants';
  import { calculateKickback, getDaysAtVenue } from '$lib/claims/utils';
  import type { Claim } from '$lib/claims/types';

  export let claims: Claim[] = [];
  export let totalPending = 0;
  export let userEmail = '';
  export let onNewClaim: () => void = () => {};
  export let onLogout: () => void = () => {};
  export let onOpenRefer: () => void = () => {};
</script>

<div class="w-full max-w-sm space-y-10" in:fade>
  <header class="text-center">
    <h1 class="text-4xl font-black tracking-tighter italic uppercase">Kickback</h1>
    <p class="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2">Member Dashboard</p>
  </header>

  <div class="bg-zinc-900 border border-zinc-800 p-8 rounded-[2.5rem] text-center shadow-2xl">
    <p class="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2">Pending Balance</p>
    <div class="flex items-center justify-center gap-3">
      <h2 class="text-6xl font-black text-green-500">${totalPending.toFixed(2)}</h2>
    </div>
  </div>

  <button 
    on:click={onNewClaim}
    class="w-full bg-white text-black font-black py-5 rounded-[2rem] text-xl uppercase tracking-tight shadow-xl shadow-white/5 active:scale-95 transition-all"
  >
    + New Claim
  </button>

  <div class="space-y-4 mt-12">
    <div class="flex justify-between items-end border-b border-zinc-900 pb-4">
      <h3 class="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">History</h3>
      <p class="text-xs font-bold text-zinc-600 uppercase">{claims.length} Claims</p>
    </div>

    {#each claims as claim}
      <details class="group bg-zinc-900/20 border border-zinc-900 rounded-2xl overflow-hidden mb-4">
        <summary class="list-none p-5 flex justify-between items-center cursor-pointer active:bg-zinc-900/50">
          <div>
            <p class="text-xl font-black text-white">+${calculateKickback(claim.amount).toFixed(2)}</p>
              <p class="text-xs text-zinc-500 font-bold uppercase tracking-tighter">
                {claim.venue} - {new Date(claim.purchased_at).toLocaleDateString()} {new Date(claim.purchased_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
          </div>
          <div class="text-xs font-black text-zinc-700 group-open:rotate-180 transition-transform">v</div>
        </summary>

        <div class="px-5 pb-6 pt-2 space-y-6" transition:slide>
          
          <div class="space-y-3">
            <div class="flex justify-between items-end">
              <p class="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Trial Progress at {claim.venue}</p>
                <p class="text-xs font-black text-white">
                  {GOAL_DAYS - getDaysAtVenue(claims, claim.venue)} DAYS LEFT
                </p>
              </div>
            
            <div class="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                class="h-full bg-green-500 transition-all duration-1000" 
                style="width: {(getDaysAtVenue(claims, claim.venue) / GOAL_DAYS) * 100}%"
              ></div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-800/50">
            <div>
              <p class="text-[9px] font-black text-zinc-500 uppercase mb-1">Total Bill</p>
              <p class="text-xs font-bold text-white">${claim.amount.toFixed(2)}</p>
            </div>
            <div>
              <p class="text-[9px] font-black text-zinc-500 uppercase mb-1">Referrer</p>
              <p class="text-xs font-bold text-green-500 uppercase">{claim.referrer || 'Direct'}</p>
            </div>
            <div>
              <p class="text-[9px] font-black text-zinc-500 uppercase mb-1">Card Last 4</p>
              <p class="text-xs font-bold text-white">**** {claim.last_4}</p>
            </div>
            <div>
              <p class="text-[9px] font-black text-zinc-500 uppercase mb-1">Referrer Earned</p>
              <p class="text-xs font-bold text-white">+${calculateKickback(claim.amount).toFixed(2)}</p>
            </div>
          </div>
        </div>
      </details>
    {:else}
      <div class="py-12 text-center border-2 border-dashed border-zinc-900 rounded-[2rem]">
        <p class="text-zinc-600 text-xs font-bold uppercase tracking-widest">No activity yet</p>
      </div>
    {/each}
    
    <div class="mt-12 text-center">
      <button 
        on:click={onLogout}
        class="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] hover:text-white transition-colors"
      >
        LOGOUT: {userEmail}
      </button>
    </div>

    <div class="h-16 w-full"></div>
  </div>
</div>

<div class="fixed bottom-8 left-0 right-0 px-6 z-50 flex justify-center" in:fly={{ y: 100 }}>
  <button 
    on:click={onOpenRefer}
    class="w-full max-w-sm bg-zinc-900/80 backdrop-blur-xl border border-zinc-700 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 shadow-2xl active:scale-95 transition-all uppercase text-xs tracking-[0.2em]">
    Refer a Friend
  </button>
</div>
