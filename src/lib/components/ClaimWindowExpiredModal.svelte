<script lang="ts">
  import { fade, fly } from 'svelte/transition';

  export let venue = '';
  export let onDismiss: () => void = () => {};
</script>

<div class="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6" transition:fade>
  <div in:fly={{ y: 20, duration: 400 }} class="bg-zinc-900 border border-zinc-800 p-8 rounded-[2rem] w-full max-w-sm text-center shadow-2xl">
    <div class="w-16 h-16 bg-orange-500/10 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-6">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="w-8 h-8">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" stroke-width="2.5" />
      </svg>
    </div>

    <h2 class="text-2xl font-black text-white mb-3 italic uppercase tracking-tighter">Claim Window Closed</h2>

    <p class="text-zinc-400 text-sm leading-relaxed mb-8">
      This claim is outside the 30-day window for <span class="text-white font-bold">{venue}</span>.
      Recommend {venue} to a friend to keep earning your kickback.
    </p>

    <button
      on:click={onDismiss}
      class="w-full bg-orange-500 text-black font-black py-4 rounded-2xl uppercase tracking-tight"
    >
      Got It
    </button>
  </div>
</div>
