<script>
  import "../app.css";
  import favicon from '$lib/assets/favicon.png';
  import { onMount } from 'svelte';
  import { env as publicEnv } from '$env/dynamic/public';

  let { children } = $props();
  let fbAppId = publicEnv.PUBLIC_FB_APP_ID;
  const ogImage = 'https://kkbk.app/opengraph.png?v=2';
  const supabaseOrigin = (() => {
    try {
      const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL;
      return supabaseUrl ? new URL(supabaseUrl).origin : '';
    } catch {
      return '';
    }
  })();

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch((error) => {
        console.error('Service worker registration failed:', error);
      });
    }
  });
</script>

<svelte:head>
  {#if supabaseOrigin}
    <link rel="dns-prefetch" href={supabaseOrigin} />
    <link rel="preconnect" href={supabaseOrigin} crossorigin="anonymous" />
  {/if}
  <link rel="icon" href="{favicon}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="canonical" href="https://kkbk.app/" />
  <meta name="theme-color" content="#0b0b0b" />
  <title>Kickback</title>
  <meta property="og:title" content="Kickback" />
  <meta property="og:description" content="EAT. DRINK. GET PAID." />
  <meta property="og:image" content="{ogImage}" />
  <meta property="og:image:secure_url" content="{ogImage}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Kickback — EAT. DRINK. GET PAID." />
  <meta property="og:url" content="https://kkbk.app/" />
  <meta property="og:site_name" content="Kickback" />
  <meta property="og:type" content="website" />
  {#if fbAppId}
    <meta property="fb:app_id" content="{fbAppId}" />
  {/if}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Kickback" />
  <meta name="twitter:description" content="EAT. DRINK. GET PAID." />
  <meta name="twitter:image" content="{ogImage}" />
  <meta name="twitter:image:alt" content="Kickback — EAT. DRINK. GET PAID." />
</svelte:head>

{@render children()}
