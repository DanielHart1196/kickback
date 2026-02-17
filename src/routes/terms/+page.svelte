<svelte:head>
  <title>Kickback - Terms of Service</title>
</svelte:head>

<main class="min-h-screen bg-zinc-950 text-white px-6 py-16">
  <div class="mx-auto w-full max-w-3xl space-y-10">
    <header class="space-y-3">
      <p class="text-xs font-bold uppercase tracking-[0.3em] text-zinc-500"><a href="/">KICKBACK</a></p>
      <h1 class="text-4xl font-black uppercase tracking-tight">Terms of Service</h1>
      <p class="text-sm text-zinc-400">Last Updated: February 2026</p>
    </header>

    <section class="space-y-6 text-sm leading-relaxed text-zinc-300">
      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">1. The Kickback Service</h2>
        <p>
          Kickback provides a platform for users to receive referral rewards for qualifying transactions at participating venues. Kickback is not a bank, financial institution, or stored value facility. By using the Kickback website or Progressive Web App (PWA),
          you agree to these terms.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">2. Eligibility and Account</h2>
        <ul class="list-disc pl-5 space-y-2">
          <li>You must be at least 18 years of age to use this service.</li>
          <li>You may be required to verify your identity before receiving payouts.</li>
          <li>You are responsible for maintaining the security of your account and any activity that occurs under it.</li>
          <li>We may suspend or terminate your account at any time for breach of these terms.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">3. Referrals and Payouts</h2>
        <p><strong>Verification:</strong> All referral claims are subject to verification by Kickback and the participating venue.</p>
        <p>
          <strong>Right to Void:</strong> Kickback and its partner venues reserve the right to void,
          cancel, or refuse any reward or payout where we reasonably suspect misuse of the service, fraud, breach of these Terms,
          or conduct inconsistent with the intended purpose of the platform. This includes, but is not limited to, cases where we suspect:
        </p>
        <ul class="list-disc pl-5 space-y-2">
          <li>Self-referrals.</li>
          <li>Gaming the system or exploitation of technical bugs.</li>
          <li>Breaches of venue "House Rules" or RSA (Responsible Service of Alcohol) directions.</li>
        </ul>
        <p>
          <strong>Claim and payout timeline:</strong> Claims must be submitted within 24 hours of the time of purchase. 
          Approved claims from the preceding week (Monday to Sunday) are typically paid out on Wednesday.
        </p>
        <p>
          <strong>Tax:</strong> Users are solely responsible for determining and meeting any tax obligations arising from rewards 
          received through Kickback. Kickback does not provide tax advice and makes no representations regarding the tax treatment of any payments.
        </p>
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
          <strong>Fraud:</strong> Any attempt to create fake accounts, submit false claims, or perform unspecified fraudulent behaviour will result
          in the immediate forfeiture of all pending funds. We reserve the right to recover funds paid in error or obtained through fraud.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">5. Venue Relationship</h2>
        <p>
          Kickback is a facilitator. We are not responsible for the quality of service, food, or drink provided by partner venues.
          Venues reserve the right to refuse a Kickback reward if it conflicts with their legal obligations (e.g., RSA)
          or if they have reached their promotional capacity.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">6. Limitation of Liability</h2>
        <p>To the maximum extent permitted by the Australian Consumer Law:</p>
        <ul class="list-disc pl-5 space-y-2">
          <li>Kickback is provided "as is" without warranties of any kind.</li>
          <li>We are not liable for any loss of profits, data, or indirect damages arising from your use of the platform or any technical outages.</li>
          <li>Nothing in these terms excludes, restricts or modifies any rights you may have under the Australian Consumer Law which cannot lawfully be excluded.</li>
        </ul>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">7. Privacy</h2>
        <p>
          Your personal information is handled in accordance with our <a href="/privacy" class="text-orange-500 hover:underline">Privacy Policy</a>.

          By using Kickback, you consent to the collection, use, and disclosure of your information as described in that policy, 
          including the sharing of limited transaction and referral data with participating venues for verification purposes.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">8. Amendments</h2>
        <p>
          We may update these terms at any time. Your continued use of the Kickback website or PWA after changes are posted
          constitutes acceptance of the new terms.
        </p>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">9. Governing Law</h2>
        <p>These terms are governed by the laws of Victoria, Australia.</p>
      </div>
      <div class="space-y-3">
        <h2 class="text-lg font-bold text-white">Contact</h2>
        <p>Questions? Email us at <a href="mailto:support@kkbk.app" class="text-orange-500 hover:underline">support@kkbk.app</a></p>
      </div>
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
