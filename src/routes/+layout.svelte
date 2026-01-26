<script>
  import "../app.css";
  import favicon from '$lib/assets/favicon.png';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch((error) => {
        console.error('Service worker registration failed:', error);
      });
    }
  });
</script>

<svelte:head>
  <link rel="icon" href="{favicon}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#0b0b0b" />
</svelte:head>

{@render children()}
