<script lang="ts">
  let contactEmail = '';
  let contactVenue = '';
  let contactMessage = '';
  let contactSubmitting = false;
  let contactStatus: string | null = null;

  async function handleContactSubmit(e: Event) {
    e.preventDefault();
    contactStatus = null;
    contactSubmitting = true;
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: contactEmail,
          venue: contactVenue,
          message: contactMessage || undefined
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || res.statusText || 'Something went wrong');
      }
      contactStatus = 'success';
      contactEmail = '';
      contactVenue = '';
      contactMessage = '';
    } catch (err) {
      contactStatus = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      contactSubmitting = false;
    }
  }
</script>

<main class="relative min-h-screen overflow-hidden bg-black text-white">
    <header class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-5">
    <div class="kickback-wordmark text-4xl tracking-tighter uppercase select-none">
      <span class="text-white">Kick</span><span class="text-orange-500">back</span>
    </div>
    <a
      href="/login"
      class="inline-flex items-center justify-center rounded-full bg-white px-5 py-2 text-xs font-black uppercase tracking-[0.2em] text-black shadow-lg shadow-black/20 transition-transform transition-colors active:scale-95 hover:bg-zinc-200"
    >
      Sign In
    </a>
  </header>
  <div class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-12 md:px-12 pb-16 pt-10">

    <section class="mt-14 grid gap-12 grid-cols-1 items-start">
      <div class="space-y-10">
        <h1 class="text-4xl font-extrabold uppercase tracking-tight text-white text-center sm:text-5xl lg:text-6xl">
          EAT. DRINK. <br /> GET PAID.
        </h1>
        <div class="flex justify-center">
          <a
            href="/login"
            class="inline-flex items-center justify-center rounded-full bg-orange-500 px-8 py-3 text-lg font-black uppercase tracking-tight text-black transition-transform active:scale-95 hover-lift"
          >
            Join
          </a>
        </div>
      </div>

      <div class="space-y-4">
        <div class="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur">
          <div class="mt-4 space-y-10 pb-4">
            <div class="flex items-start gap-4">
              <div class="text-3xl font-extrabold text-orange-500">01</div>
              <div>
                <p class="text-base font-extrabold uppercase tracking-[0.2em] text-white">
                  Share
                </p>
                <p class="text-sm text-zinc-400">
                  Recommend your favourite spots to your mates with a QR code/link.
                </p>
              </div>
            </div>
            <div class="flex items-start gap-4">
              <div class="text-3xl font-extrabold text-orange-500">02</div>
              <div>
                <p class="text-base font-extrabold uppercase tracking-[0.2em] text-white">
                  Earn
                </p>
                <p class="text-sm text-zinc-400">
                  You both get a 5% kickback on anything they spend for the next 30 days.
                </p>
              </div>
            </div>
            <div class="flex items-start gap-4">
              <div class="text-3xl font-extrabold text-orange-500">03</div>
              <div>
                <p class="text-base font-extrabold uppercase tracking-[0.2em] text-white">
                  Cash
                </p>
                <p class="text-sm text-zinc-400">
                  No points. No credits.<br />Just cash.
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Venues marquee: drop images into `static/venues/` (e.g. platform3095.jpg) -->
        <div class="venue-marquee !my-8 [mask-image:_linear_gradient(to_right,transparent_0,_black_10%,_black_90%,transparent_100%)]">
          <div class="marquee-track">
            <div class="marquee-group">
              <img src="/venues/platform3095-black.jpg" alt="platform3095" class="marquee-img" />
              <img src="/venues/barpic-logo.jpg" alt="barpic" class="marquee-img" />
              <img src="/venues/pro-bros.avif" alt="pro bros" class="marquee-img" />
              <img src="/venues/platform3095-black.jpg" alt="platform3095" class="marquee-img" />
              <img src="/venues/barpic-logo.jpg" alt="barpic" class="marquee-img" />
              <img src="/venues/pro-bros.avif" alt="pro bros" class="marquee-img" />
            </div>
            <div class="marquee-group" aria-hidden="true">
              <img src="/venues/platform3095-black.jpg" alt="platform3095" class="marquee-img" />
              <img src="/venues/barpic-logo.jpg" alt="barpic" class="marquee-img" />
              <img src="/venues/pro-bros.avif" alt="pro bros" class="marquee-img" />
              <img src="/venues/platform3095-black.jpg" alt="platform3095" class="marquee-img" />
              <img src="/venues/barpic-logo.jpg" alt="barpic" class="marquee-img" />
              <img src="/venues/pro-bros.avif" alt="pro bros" class="marquee-img" />
            </div>
          </div>
        </div>

        <div class="rounded-3xl border border-zinc-800 bg-black/60 p-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-500">
            For venues
          </p>
          <p class="mt-3 text-lg font-black uppercase tracking-[0.2em] text-white">
            TURN YOUR<br />
            <span class="text-orange-500 font-black">REGULARS</span><br />
            INTO YOUR<br />
            <span class="text-orange-500 font-black">MARKETING TEAM</span>
          </p>
          <form
            class="mt-5 space-y-4"
            on:submit={handleContactSubmit}
          >
            <div>
              <label for="contact-email" class="mb-1 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                Email
              </label>
              <input
                id="contact-email"
                type="email"
                name="email"
                required
                bind:value={contactEmail}
                class="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                placeholder="you@venue.com"
              />
            </div>
            <div>
              <label for="contact-venue" class="mb-1 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                Venue name
              </label>
              <input
                id="contact-venue"
                type="text"
                name="venue"
                required
                bind:value={contactVenue}
                class="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                placeholder="Your venue"
              />
            </div>
            <div>
              <label for="contact-message" class="mb-1 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                Message <span class="text-zinc-600">(optional)</span>
              </label>
              <textarea
                id="contact-message"
                name="message"
                rows="3"
                bind:value={contactMessage}
                class="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                placeholder="Tell us a bit about your venue..."
              ></textarea>
            </div>
            {#if contactStatus}
              <p class="text-sm {contactStatus === 'success' ? 'text-green-400' : 'text-red-400'}">
                {contactStatus === 'success' ? 'Thanks — we\'ll be in touch.' : contactStatus}
              </p>
            {/if}
            <button
              type="submit"
              disabled={contactSubmitting}
              class="w-full inline-flex items-center justify-center rounded-full bg-orange-500 px-8 py-3 text-lg font-black uppercase tracking-tight text-black transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed hover-lift"
            >
              {contactSubmitting ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </section>

    <footer class="mt-16 flex flex-wrap items-center justify-center gap-6 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500">
      <a
        href="https://kkbk.app/terms"
        class="hover:text-white transition-colors"
      >
        Terms
      </a>
      <a
        href="https://kkbk.app/privacy"
        class="hover:text-white transition-colors"
      >
        Privacy
      </a>
    </footer>
  </div>
</main>

<style>
@media (hover: hover) and (pointer: fine) {
  .hover-lift:hover {
    transform: translateY(-4px) scale(1.02);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.6);
  }
}

/* Venues marquee */
.venue-marquee {
  width: 100vw;
  position: relative;
  left: 50%;
  margin-left: -50vw;
  overflow: hidden;
  mask-image: linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%);
  z-index: 1;
}
.marquee-track {
  display: flex;
  gap: 2rem;
  align-items: center;
  width: max-content;
  animation: marquee-left 40s linear infinite;
}
.marquee-group {
  display: flex;
  gap: 2rem;
  align-items: center;
}
.marquee-img {
  width: 134px;
  height: 134px;
  object-fit: contain;
  opacity: 1;
  filter: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

@keyframes marquee-left {
  0% { transform: translateX(0%); }
  100% { transform: translateX(-50%); }
}

/* Slow down on reduced motion */
@media (prefers-reduced-motion: reduce) {
  .marquee-track { animation-duration: 0s; }
}
</style>
