<script>
  import { onMount } from 'svelte';
  import { pwaStore, init, promptInstall } from '$lib/stores/pwaStore.js';
  let installing = false;
  let installMessage = '';

  async function onInstall() {
    installing = true;
    await promptInstall();
    installing = false;
    if (!$pwaStore.isStandalone && !$pwaStore.deferredPrompt) {
      installMessage = 'Use browser menu → Install app';
    } else {
      installMessage = '';
    }
  }

  onMount(() => {
    init();
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) {
          navigator.serviceWorker
            .register('/service-worker.js')
            .catch(() => {});
        }
      });
    }
  });
</script>

{#if !$pwaStore.isStandalone && !$pwaStore.installed}
  <button
    type="button"
    on:click={onInstall}
    class="mt-3 w-full rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-zinc-200 transition-colors"
  >
    {installing ? 'Installing...' : 'Install Kickback'}
  </button>
  {#if installMessage}
    <p class="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{installMessage}</p>
  {/if}
{:else if !$pwaStore.isStandalone && $pwaStore.installed}
  <p class="mt-3 text-[11px] font-bold uppercase tracking-widest text-zinc-400">Kickback installed</p>
{:else if $pwaStore.manualInstall}
  <p class="mt-3 text-[11px] font-bold uppercase tracking-widest text-zinc-400">Manual Install: Add to Home Screen from Safari</p>
{:else}
  <p class="mt-3 text-[11px] font-bold uppercase tracking-widest text-zinc-400">Install Kickback for quicker access</p>
{/if}
