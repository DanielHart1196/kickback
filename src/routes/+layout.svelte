<script>
  import "../app.css";
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { env as publicEnv } from '$env/dynamic/public';

  let { children } = $props();
  let fbAppId = publicEnv.PUBLIC_FB_APP_ID;
  const appUrl = (publicEnv.PUBLIC_APP_URL || 'https://kkbk.app').replace(/\/+$/, '');
  const ogImage = `${appUrl}/opengraph.png?v=2`;

  /** @param {string} pathname */
  function isLegalPath(pathname) {
    return pathname === '/terms' || pathname === '/privacy';
  }

  function scrollTopStable() {
    if (typeof window === 'undefined') return;
    const applyTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };
    applyTop();
    requestAnimationFrame(applyTop);
    setTimeout(applyTop, 120);
    setTimeout(applyTop, 260);
  }

  function probeCorner() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return [];
    const points = [
      [1, 1],
      [2, 2],
      [4, 4],
      [8, 8]
    ];
    const result = points.map(([x, y]) => {
      const chain = document.elementsFromPoint(x, y).map((el) => {
        const style = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          id: el.id || '',
          cls: typeof el.className === 'string' ? el.className : '',
          pos: style.position,
          z: style.zIndex,
          pe: style.pointerEvents
        };
      });
      return { point: `${x},${y}`, chain };
    });
    console.log('[kb-probe-corner]', result);
    return result;
  }
  const supabaseOrigin = (() => {
    try {
      const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL;
      return supabaseUrl ? new URL(supabaseUrl).origin : '';
    } catch {
      return '';
    }
  })();

  onMount(() => {
    if (typeof window !== 'undefined') {
      /** @type {any} */ (window).__kbProbeCorner = probeCorner;
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch((error) => {
        console.error('Service worker registration failed:', error);
      });
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete /** @type {any} */ (window).__kbProbeCorner;
      }
    };
  });

  afterNavigate((navigation) => {
    if (typeof window === 'undefined') return;
    const toPath = navigation.to?.url?.pathname ?? window.location.pathname;
    if (isLegalPath(toPath)) {
      scrollTopStable();
      return;
    }
    if (navigation.type === 'popstate') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  });
</script>

<svelte:head>
  {#if supabaseOrigin}
    <link rel="dns-prefetch" href={supabaseOrigin} />
    <link rel="preconnect" href={supabaseOrigin} crossorigin="anonymous" />
  {/if}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="canonical" href="{appUrl}/" />
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
  <meta property="og:url" content="{appUrl}/" />
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
