<script>
  let { status, error } = $props();
  const is404 = status === 404;
  const title = is404 ? '404 — Page Not Found' : 'Something went wrong';
  const detail = is404 ? 'The page you’re looking for doesn’t exist.' : (error?.message ?? 'Please try again.');
</script>

<svelte:head>
  <title>{title} · Kickback</title>
</svelte:head>

<main class="min-h-screen bg-black text-white flex items-center justify-center p-6">
  <div class="w-full max-w-xl">
    <div class="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 text-center">
      <div class="kickback-wordmark text-5xl md:text-6xl text-orange-500">Kickback</div>
      <h1 class="mt-6 text-2xl md:text-4xl font-black">{title}</h1>
      <p class="mt-3 text-zinc-400 text-sm md:text-base">{detail}</p>

      <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a href="/" class="bg-orange-500 text-black font-black px-6 py-3 rounded-xl uppercase tracking-tight">
          Go Home
        </a>
        <a href="/?refer=" class="bg-zinc-800 text-white font-black px-6 py-3 rounded-xl uppercase tracking-tight border border-zinc-700">
          Claim Portal
        </a>
      </div>

      <p class="mt-6 text-zinc-600 text-xs font-bold uppercase tracking-widest">EAT. DRINK. GET PAID.</p>
    </div>
  </div>
</main>
