<svelte:head>
  <title>Terms of Service</title>
</svelte:head>

<main class="min-h-screen bg-zinc-950 text-white px-6 py-16">
  <div class="mx-auto w-full max-w-3xl space-y-10">
    <header class="space-y-3">
      <p class="text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">Kickback</p>
      <h1 class="text-4xl font-black uppercase tracking-tight">Terms of Service</h1>
      <p class="text-sm text-zinc-400">Last Updated: February 2026</p>
    </header>

    <section class="space-y-6 text-sm leading-relaxed text-zinc-300">
      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">1. The Kickback Service</h2>
        <p>
          Kickback provides a platform for users to receive referral rewards (the "Kickback")
          for qualifying transactions at participating venues. By using the Kickback Progressive Web App (PWA),
          you agree to these terms.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">2. Eligibility and Account</h2>
        <ul class="list-disc pl-5 space-y-2">
          <li>You must be at least 18 years of age to use this service, as it involves licensed hospitality venues.</li>
          <li>You are responsible for maintaining the security of your account and any activity that occurs under it.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">3. Referrals and Payouts</h2>
        <p><strong>Verification:</strong> All referral claims are subject to verification by Kickback and the participating Venue.</p>
        <p>
          <strong>The "Kill Switch" (Right to Void):</strong> Kickback and its partner Venues reserve the absolute right to void,
          cancel, or refuse any payout or discount at their sole discretion. This includes, but is not limited to, cases where we suspect:
        </p>
        <ul class="list-disc pl-5 space-y-2">
          <li>Self-referrals or "looping" (referring yourself).</li>
          <li>Gaming the system or exploitation of technical bugs.</li>
          <li>Breaches of Venue "House Rules" or RSA (Responsible Service of Alcohol) directions.</li>
        </ul>
        <p>
          <strong>No Vested Right:</strong> A Kickback is a discretionary reward, not a guaranteed debt or wage.
          No entitlement to payment exists until a transaction is fully cleared and approved.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">4. User Conduct</h2>
        <p>
          <strong>Anti-Spam:</strong> You must not promote your referral links via unsolicited messages (Spam).
          This is a breach of the Spam Act 2003 (Cth) and will result in an immediate ban.
        </p>
        <p>
          <strong>Fraud:</strong> Any attempt to create fake accounts or use "bot" traffic will result
          in the immediate forfeiture of all pending funds.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">5. Venue Relationship</h2>
        <p>
          Kickback is a facilitator. We are not responsible for the quality of service, food, or drink provided by partner Venues.
          Venues reserve the right to refuse a Kickback promotion if it conflicts with their legal obligations (e.g., RSA)
          or if they have reached their promotional capacity.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">6. Limitation of Liability</h2>
        <p>To the maximum extent permitted by the Australian Consumer Law:</p>
        <ul class="list-disc pl-5 space-y-2">
          <li>Kickback is provided "as is" without warranties of any kind.</li>
          <li>We are not liable for any loss of profits, data, or indirect damages arising from your use of the platform or any technical outages.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">7. Privacy</h2>
        <p>
          Your data is handled according to the Privacy Act 1988 (Cth).
          We only share necessary transaction data with venues to verify your Kickback.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">8. Amendments</h2>
        <p>
          We may update these terms at any time. Your continued use of the PWA after changes are posted
          constitutes acceptance of the new terms.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">9. Governing Law</h2>
        <p>These terms are governed by the laws of Victoria, Australia.</p>
      </div>
    </section>

    <section class="space-y-4 text-sm leading-relaxed text-zinc-300">
      <h2 class="text-lg font-bold text-white">Contact</h2>
      <p>Questions? Email us at support@kkbk.app.</p>
    </section>
  </div>
  <div class="mt-6 text-center">
    <button
      type="button"
      on:click={() => {
        const url = typeof window !== 'undefined' ? window.location.href : '';
        if (typeof window !== 'undefined') {
          window.history.back();
          setTimeout(() => {
            if (window.location.href === url) {
              window.location.href = '/';
            }
          }, 100);
        }
      }}
      class="text-zinc-600 text-xs font-bold uppercase tracking-widest hover:text-white transition-colors"
    >
      Go Back
    </button>
  </div>
</main>
