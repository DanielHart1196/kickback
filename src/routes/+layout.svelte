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
  <title>Kickback</title>
  <meta property="og:title" content="Kickback" />
  <meta property="og:description" content="EAT. DRINK. GET PAID." />
  <meta property="og:image" content="https://kkbk.app/opengraph.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Kickback" />
  <meta name="twitter:description" content="EAT. DRINK. GET PAID." />
  <meta name="twitter:image" content="https://kkbk.app/opengraph.png" />
</svelte:head>

{@render children()}
