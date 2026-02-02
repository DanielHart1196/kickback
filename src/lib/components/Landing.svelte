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

<main class="relative min-h-screen overflow-hidden bg-zinc-950 text-white">
  <header class="flex items-center justify-between">
    <div class="text-4xl font-black tracking-tighter italic uppercase select-none">
      <span class="text-white">Kick</span><span class="text-orange-500">back</span>
    </div>
    <a
      href="/login"
      class="inline-flex items-center justify-center rounded-full bg-white px-5 py-2 text-xs font-black uppercase tracking-[0.2em] text-black shadow-lg shadow-black/20 transition-transform active:scale-95"
    >
      Sign In
    </a>
  </header>
  <div class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6 pb-16 pt-10">

    <section class="mt-14 grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
      <div class="space-y-10">
        <h1 class="text-4xl font-extrabold uppercase tracking-tight text-white text-center sm:text-5xl lg:text-6xl">
          EAT. DRINK. <br /> GET PAID.
        </h1>
        <div class="flex justify-center">
          <a
            href="/login"
            class="inline-flex items-center justify-center rounded-full bg-orange-500 px-8 py-3 text-lg font-black uppercase tracking-tight text-black transition-transform active:scale-95"
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

        <div class="rounded-3xl border border-zinc-800 bg-black/60 p-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-500">
            For venues
          </p>
          <p class="mt-3 text-lg font-extrabold uppercase tracking-[0.2em] text-white">
            TURN YOUR<br />
            <span class="text-orange-500">REGULARS</span><br />
            INTO YOUR<br />
            <span class="text-orange-500">MARKETING TEAM</span>
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
              class="w-full rounded-2xl border border-orange-500 px-5 py-3 text-xs font-bold uppercase tracking-[0.25em] text-orange-400 transition-colors hover:bg-orange-500 hover:text-black disabled:opacity-50 disabled:cursor-not-allowed"
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
