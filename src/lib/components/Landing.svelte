<main class="relative min-h-screen overflow-hidden bg-zinc-950 text-white">
  <div class="absolute inset-0">
    <div class="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-orange-500/20 blur-[160px]"></div>
    <div class="absolute -bottom-48 -left-24 h-[420px] w-[420px] rounded-full bg-amber-400/20 blur-[140px]"></div>
    <div class="absolute right-0 top-16 h-[360px] w-[360px] rounded-full bg-white/5 blur-[120px]"></div>
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_top,#1c1917,transparent_55%)] opacity-70"></div>
  </div>

  <div class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6 pb-16 pt-10">
    <header class="flex items-center justify-between">
      <div class="text-xl font-extrabold uppercase tracking-[0.3em] text-white">
        <span class="text-white">Kick</span><span class="text-orange-500">back</span>
      </div>
      <a
        href="/admin/login"
        class="text-[11px] font-semibold uppercase tracking-[0.25em] text-zinc-400 hover:text-white transition-colors"
      >
        Venue Owners
      </a>
    </header>

    <section class="mt-14 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
      <div class="space-y-7">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-400">
          Claims Portal for bar tabs
        </p>
        <h1 class="text-4xl font-extrabold uppercase tracking-tight text-white sm:text-5xl lg:text-6xl">
          Turn every round into a kickback.
        </h1>
        <p class="text-base text-zinc-300 sm:text-lg">
          Submit a claim in seconds and watch your venue balance climb. Owners approve with
          Square-powered auto-checks and weekly payouts.
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <a
            href="/login"
            class="inline-flex items-center justify-center rounded-2xl bg-orange-500 px-6 py-4 text-sm font-bold uppercase tracking-[0.2em] text-black shadow-xl shadow-orange-500/30 transition-transform active:scale-95"
          >
            Start Earning
          </a>
          <a
            href="/login"
            class="inline-flex items-center justify-center rounded-2xl border border-zinc-700 px-6 py-4 text-sm font-bold uppercase tracking-[0.2em] text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            Sign In
          </a>
        </div>
        <div class="flex flex-wrap gap-4 text-xs uppercase tracking-[0.25em] text-zinc-500">
          <span>5% kickback baseline</span>
          <span>Auto-claims ready</span>
          <span>Mobile-first</span>
        </div>
      </div>

      <div class="space-y-4">
        <div class="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur">
          <p class="text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-500">
            How it works
          </p>
          <div class="mt-4 space-y-5">
            <div class="flex items-start gap-4">
              <div class="text-3xl font-extrabold text-orange-500">01</div>
              <div>
                <p class="text-sm font-bold uppercase tracking-[0.2em] text-white">
                  Submit a claim
                </p>
                <p class="text-sm text-zinc-400">
                  Pick your venue, add your referrer code, and confirm the last 4.
                </p>
              </div>
            </div>
            <div class="flex items-start gap-4">
              <div class="text-3xl font-extrabold text-orange-500">02</div>
              <div>
                <p class="text-sm font-bold uppercase tracking-[0.2em] text-white">
                  Auto-verify
                </p>
                <p class="text-sm text-zinc-400">
                  Square-connected venues match payments automatically for fast approvals.
                </p>
              </div>
            </div>
            <div class="flex items-start gap-4">
              <div class="text-3xl font-extrabold text-orange-500">03</div>
              <div>
                <p class="text-sm font-bold uppercase tracking-[0.2em] text-white">
                  Watch it stack
                </p>
                <p class="text-sm text-zinc-400">
                  Track balances, referrals, and venue totals in your dashboard.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-3xl border border-zinc-800 bg-black/60 p-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-500">
            For venues
          </p>
          <p class="mt-3 text-base font-semibold text-white">
            Owners manage kickback rates, payouts, and Square auto-claims from the admin dashboard.
          </p>
          <a
            href="/admin/login"
            class="mt-5 inline-flex items-center justify-center rounded-2xl border border-orange-500 px-5 py-3 text-xs font-bold uppercase tracking-[0.25em] text-orange-400 hover:text-black hover:bg-orange-500 transition-colors"
          >
            Owner Login
          </a>
        </div>
      </div>
    </section>
  </div>
</main>
