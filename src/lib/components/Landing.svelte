<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';

  const CONTACT_MESSAGE_MAX_LENGTH = 500;
  let contactEmail = '';
  let contactVenue = '';
  let contactMessage = '';
  let contactSubmitting = false;
  let contactStatus: string | null = null;
  let marqueeDragX = 0;
  let marqueeVelocityX = 0;
  let marqueeDragging = false;
  let marqueePointerId: number | null = null;
  let marqueeStartX = 0;
  let marqueeStartDragX = 0;
  let marqueeLastPointerX = 0;
  let marqueeLastPointerTime = 0;
  let marqueeInertiaFrame = 0;
  let marqueeLastFrameTime = 0;
  let marqueeGroupEl: HTMLDivElement | null = null;
  let marqueeLoopWidth = 0;
  let marqueeResizeObserver: ResizeObserver | null = null;

  async function navigateToLogin(event: MouseEvent) {
    event.preventDefault();
    await goto('/login', { noScroll: false, keepFocus: false });
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, 120);
  }

  function handleContactMessageInput(event: Event & { currentTarget: HTMLTextAreaElement }) {
    const next = String(event.currentTarget.value ?? '');
    contactMessage = next.slice(0, CONTACT_MESSAGE_MAX_LENGTH);
    if (contactStatus) contactStatus = null;
  }

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
          message: contactMessage.trim() || undefined
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

  function stopMarqueeInertia() {
    if (marqueeInertiaFrame) {
      cancelAnimationFrame(marqueeInertiaFrame);
      marqueeInertiaFrame = 0;
    }
  }

  function normalizeMarqueeDrag(value: number): number {
    if (!marqueeLoopWidth || !Number.isFinite(value)) return value;
    const span = marqueeLoopWidth;
    let wrapped = ((value % span) + span) % span;
    if (wrapped > span / 2) wrapped -= span;
    return wrapped;
  }

  function measureMarqueeLoopWidth() {
    if (!marqueeGroupEl) return;
    const width = marqueeGroupEl.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width <= 0) return;
    marqueeLoopWidth = width;
    marqueeDragX = normalizeMarqueeDrag(marqueeDragX);
  }

  function runMarqueeInertia() {
    stopMarqueeInertia();
    marqueeLastFrameTime = performance.now();
    const tick = (now: number) => {
      if (marqueeDragging) {
        marqueeInertiaFrame = 0;
        return;
      }
      const dt = Math.max(0.001, (now - marqueeLastFrameTime) / 1000);
      marqueeLastFrameTime = now;
      marqueeDragX = normalizeMarqueeDrag(marqueeDragX + marqueeVelocityX * dt);
      const friction = Math.pow(0.9, dt * 60);
      marqueeVelocityX *= friction;
      if (Math.abs(marqueeVelocityX) < 4) {
        marqueeVelocityX = 0;
        marqueeInertiaFrame = 0;
        return;
      }
      marqueeInertiaFrame = requestAnimationFrame(tick);
    };
    marqueeInertiaFrame = requestAnimationFrame(tick);
  }

  function onMarqueePointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stopMarqueeInertia();
    marqueeDragging = true;
    marqueePointerId = event.pointerId;
    marqueeStartX = event.clientX;
    marqueeStartDragX = marqueeDragX;
    marqueeLastPointerX = event.clientX;
    marqueeLastPointerTime = performance.now();
    marqueeVelocityX = 0;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture?.(event.pointerId);
  }

  function onMarqueePointerMove(event: PointerEvent) {
    if (!marqueeDragging) return;
    if (marqueePointerId !== null && event.pointerId !== marqueePointerId) return;
    const delta = event.clientX - marqueeStartX;
    marqueeDragX = normalizeMarqueeDrag(marqueeStartDragX + delta);
    const now = performance.now();
    const dtMs = Math.max(1, now - marqueeLastPointerTime);
    const instantVelocity = ((event.clientX - marqueeLastPointerX) / dtMs) * 1000;
    marqueeVelocityX = marqueeVelocityX * 0.55 + instantVelocity * 0.45;
    marqueeLastPointerX = event.clientX;
    marqueeLastPointerTime = now;
  }

  function endMarqueeDrag(event?: PointerEvent) {
    if (!marqueeDragging) return;
    if (event && marqueePointerId !== null && event.pointerId !== marqueePointerId) return;
    marqueeDragging = false;
    marqueePointerId = null;
    runMarqueeInertia();
  }

  onDestroy(() => {
    stopMarqueeInertia();
    marqueeResizeObserver?.disconnect();
    marqueeResizeObserver = null;
  });

  onMount(() => {
    measureMarqueeLoopWidth();
    requestAnimationFrame(measureMarqueeLoopWidth);
    setTimeout(measureMarqueeLoopWidth, 120);

    if (typeof ResizeObserver !== 'undefined') {
      marqueeResizeObserver = new ResizeObserver(() => {
        measureMarqueeLoopWidth();
      });
      if (marqueeGroupEl) {
        marqueeResizeObserver.observe(marqueeGroupEl);
      }
    }

    const handleResize = () => measureMarqueeLoopWidth();
    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });
</script>

<main class="relative min-h-screen overflow-hidden bg-black text-white">
  <header class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-5">
    <a href="/" aria-label="Go to home" class="inline-flex items-center">
      <img
        src="/branding/kickback-wordmark.svg"
        alt="Kickback"
        class="h-7 w-auto select-none"
        loading="eager"
        decoding="sync"
      />
    </a>
    <a
      href="/login"
      data-sveltekit-preload-code="viewport"
      data-sveltekit-preload-data="hover"
      on:click={navigateToLogin}
      class="inline-flex items-center justify-center rounded-full bg-white px-5 h-10 text-xs font-black uppercase text-black shadow-lg shadow-black/20 transition-transform transition-colors active:scale-95 hover:bg-zinc-200"
    >
      Sign In
    </a>
  </header>
  <div class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-12 md:px-12 pb-16 pt-10">

    <section class="mt-14 grid gap-12 grid-cols-1 items-start">
      <div class="space-y-10">
        <h1 class="text-4xl font-extrabold uppercase tracking-tight text-white text-center sm:text-5xl lg:text-6xl">
          <span class="sm:hidden">
            <span class="whitespace-nowrap">BRING A MATE</span><br /><span class="text-white">GET 5%<br />FOR 30 DAYS</span>
          </span>
          <span class="hidden sm:inline">
            BRING A MATE <br /><span class="text-white">GET 5% FOR 30 DAYS</span>
          </span>
        </h1>
        <div class="flex justify-center">
            <a
              href="/login"
              data-sveltekit-preload-code="viewport"
              data-sveltekit-preload-data="hover"
              on:click={navigateToLogin}
              class="inline-flex items-center justify-center rounded-full bg-orange-500 px-8 py-3 text-lg font-black uppercase text-black transition-colors active:scale-95 hover:bg-orange-600"
            >
              Join
            </a>
        </div>
      </div>

      <div class="space-y-4">
        <div class="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 md:px-6 lg:px-6 xl:px-6 backdrop-blur -mx-6 md:mx-auto md:max-w-xl lg:max-w-2xl xl:max-w-3xl">
          <div class="mt-4 space-y-10 pb-4 mx-auto max-w-[36rem]">
            <div class="flex items-center gap-4">
              <div class="w-16 md:w-20 shrink-0 flex items-center justify-center">
                <img src="/icons/screenshot.svg" alt="screenshot" class="w-14 h-14 md:w-16 md:h-16" />
              </div>
              <div>
                <p class="text-base font-extrabold uppercase text-white">
                  Share
                </p>
                <p class="text-sm text-zinc-400">
                  Recommend your favourite spots to your mates with a QR code/link.
                </p>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <div class="w-16 md:w-20 shrink-0 flex items-center justify-center">
                <img src="/icons/beers.svg" alt="beers" class="w-14 h-14 md:w-16 md:h-16" />
              </div>
              <div>
                <p class="text-base font-extrabold uppercase text-white">
                  Earn
                </p>
                <p class="text-sm text-zinc-400">
                  You both get a 5% kickback on anything they spend for the next 30 days.
                </p>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <div class="w-16 md:w-20 shrink-0 flex items-center justify-center">
                <img src="/icons/cash-note.svg" alt="cash note" class="w-14 h-14 md:w-16 md:h-16" />
              </div>
              <div>
                <p class="text-base font-extrabold uppercase text-white">
                  Cash
                </p>
                <p class="text-sm text-zinc-400">
                  No points. No credits. <br class="sm:hidden" />Real money sent to your bank account every week.
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Venues marquee: drop images into `static/venues/` (e.g. platform3095.jpg) -->
        <div
          class="venue-marquee !my-8"
          style={`--marquee-drag-x: ${marqueeDragX}px;`}
          on:pointerdown={onMarqueePointerDown}
          on:pointermove={onMarqueePointerMove}
          on:pointerup={endMarqueeDrag}
          on:pointercancel={endMarqueeDrag}
        >
          <div class="marquee-track">
            <div class="marquee-track-inner">
              <div class="marquee-group" bind:this={marqueeGroupEl}>
                <img src="/venues/platform3095-black.jpg" alt="platform3095" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/barpic-logo.jpg" alt="barpic" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/probros-logo.png" alt="pro bros" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/platform3095-black.jpg" alt="platform3095" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/barpic-logo.jpg" alt="barpic" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/probros-logo.png" alt="pro bros" class="marquee-img" loading="eager" decoding="sync" />
              </div>
              <div class="marquee-group" aria-hidden="true">
                <img src="/venues/platform3095-black.jpg" alt="platform3095" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/barpic-logo.jpg" alt="barpic" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/probros-logo.png" alt="pro bros" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/platform3095-black.jpg" alt="platform3095" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/barpic-logo.jpg" alt="barpic" class="marquee-img" loading="eager" decoding="sync" />
                <img src="/venues/probros-logo.png" alt="pro bros" class="marquee-img" loading="eager" decoding="sync" />
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-3xl border border-zinc-800 bg-black/60 p-6 -mx-6 md:mx-0">
          <div class="flex items-center justify-between gap-3">
            <p class="text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-500">
              For venues
            </p>
            <a
              href="/admin/login"
              data-sveltekit-preload-code="viewport"
              data-sveltekit-preload-data="hover"
              class="inline-flex items-center justify-center rounded-full bg-white px-5 h-10 text-xs font-black uppercase text-black shadow-lg shadow-black/20 transition-transform transition-colors active:scale-95 hover:bg-zinc-200"
            >
              Sign In
            </a>
          </div>
          <p class="mt-3 text-lg font-black uppercase text-white">
            TURN YOUR<span class="sm:hidden"><br /></span> <span class="text-orange-500 font-black">REGULARS</span><span class="sm:hidden"><br /></span> INTO YOUR<span class="sm:hidden"><br /></span> <span class="text-orange-500 font-black">MARKETING TEAM</span>
          </p>
          <form
            class="mt-5 space-y-4"
            on:submit={handleContactSubmit}
          >
            <div>
              <label for="contact-email" class="mb-1 block text-xs font-bold uppercase text-zinc-400">
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
              <label for="contact-venue" class="mb-1 block text-xs font-bold uppercase text-zinc-400">
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
              <div class="mb-1 flex items-center justify-between gap-3">
                <label for="contact-message" class="block text-xs font-bold uppercase text-zinc-400">
                  Message <span class="text-zinc-600">(optional)</span>
                </label>
                {#if contactMessage.length > 0}
                  <p class="text-[10px] font-bold text-zinc-500 whitespace-nowrap">
                    {contactMessage.length}/{CONTACT_MESSAGE_MAX_LENGTH}
                  </p>
                {/if}
              </div>
              <textarea
                id="contact-message"
                name="message"
                rows="3"
                bind:value={contactMessage}
                maxlength={CONTACT_MESSAGE_MAX_LENGTH}
                on:input={handleContactMessageInput}
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
              class="w-full inline-flex items-center justify-center rounded-full bg-orange-500 px-8 py-3 text-lg font-black uppercase text-black transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-orange-600"
            >
              {contactSubmitting ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </section>

    <footer class="mt-16 flex flex-wrap items-center justify-center gap-6 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500">
      <a
        href="/terms"
        class="hover:text-white transition-colors"
      >
        Terms
      </a>
      <a
        href="/privacy"
        class="hover:text-white transition-colors"
      >
        Privacy
      </a>
    </footer>
  </div>
</main>

<style>
/* Venues marquee */
.venue-marquee {
  width: calc(100% + 3rem);
  margin-left: -1.5rem;
  margin-right: -1.5rem;
  overflow: clip;
  touch-action: pan-y;
  cursor: grab;
  user-select: none;
  mask-image: linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%);
  z-index: 1;
}
.venue-marquee:active {
  cursor: grabbing;
}
.marquee-track {
  display: flex;
  gap: 0;
  align-items: center;
  width: max-content;
  animation: marquee-left 40s linear infinite;
}
.marquee-track-inner {
  display: flex;
  align-items: center;
  transform: translate3d(var(--marquee-drag-x, 0px), 0, 0);
  will-change: transform;
}
.marquee-group {
  display: flex;
  gap: 2rem;
  align-items: center;
  padding-right: 2rem;
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

@media (min-width: 768px) {
  .venue-marquee {
    width: 100%;
    margin-left: 0;
    margin-right: 0;
  }
}
</style>
