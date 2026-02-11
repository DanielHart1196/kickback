<script lang="ts">
  function goHome() {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }
</script>

<main class="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
  <div class="w-full max-w-sm space-y-6 text-center">
    <h1 class="text-3xl font-black uppercase tracking-tighter leading-none">
      <span class="kickback-wordmark"><span class="text-white">Kick</span><span class="text-orange-500">back</span></span>
    </h1>

    <div class="space-y-3">
      <h2 class="text-xl font-bold">Table not found.</h2>
      <p class="text-zinc-400">
        Looks like this link has expired or the venue has moved.
      </p>
    </div>

    <div class="mt-2">
      <button
        type="button"
        on:click={goHome}
        class="w-full h-10 rounded-full bg-orange-500 text-black text-[14px] leading-[20px] font-black uppercase inline-flex items-center justify-center active:scale-95 transition-all hover:bg-orange-600"
      >
        Go Home
      </button>
    </div>
  </div>
</main>
