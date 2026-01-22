<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  
  let last4: string = '';
  let venue: string = '';
  let referrer: string = '';
  let purchaseTime: string = '';
  let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  let errorMessage: string = '';

  let daysActive = 12; // You can hardcode this to test, or calculate it
  const GOAL_DAYS = 30;

  function getDaysAtVenue(venueName: string) {
    // Filter all claims to find only those from this venue
    const venueClaims = claims.filter(c => c.venue === venueName);
    if (venueClaims.length === 0) return 0;

    // Find the oldest claim (the start date)
    const dates = venueClaims.map(c => new Date(c.purchased_at).getTime());
    const firstDate = Math.min(...dates);
    
    const now = new Date().getTime();
    const diffInMs = now - firstDate;
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    
    // Return the days passed, capped at our GOAL_DAYS
    return Math.min(diffInDays + 1, GOAL_DAYS); 
  }

  let isReferrerLocked: boolean = false;
  let isVenueLocked: boolean = false;

  // This tracks if we show the dashboard or the "New Claim" form
  let showForm = false; 

  // This will hold the list of all claims from the database
  let claims: any[] = []; 

  // This will hold the calculated 5% total
  let totalPending: number = 0;

  async function fetchDashboardData() {
    // Safety check: if no one is logged in, don't do anything
    if (!session) return;

    const { data: claimsData, error } = await supabase
      .from('claims')
      .select('*')
      .eq('submitter_id', session.user.id)
      .order('created_at', { ascending: false }); // Show newest first

    if (error) {
      console.error("Error fetching claims:", error.message);
    } else if (claimsData) {
      claims = claimsData;

      // MATH: Calculate 5% of all their submitted bill amounts
      const totalBills = claimsData.reduce((sum, c) => sum + (c.amount || 0), 0);
      totalPending = parseFloat((totalBills * 0.05).toFixed(2));
    }
  }

  let amount: number | null = null;
  const MAX_BILL = 1000;

  function handleInput(e: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    // We cast e.target as an HTMLInputElement so TS knows it has a .value property
    let value = (e.target as HTMLInputElement).value;

    // 1. Prevent more than one decimal point
    if ((value.match(/\./g) || []).length > 1) return;

    // 2. Limit to 2 decimal places
    if (value.includes(".")) {
      const [whole, decimal] = value.split(".");
      if (decimal.length > 2) {
        value = `${whole}.${decimal.slice(0, 2)}`;
      }
    }

    // 3. Enforce Max Cap
    if (parseFloat(value) > MAX_BILL) {
      value = MAX_BILL.toString();
    }

    amount = value === '' ? null : parseFloat(value);
  }

  let showGuestWarning = false;
  let isGuest = false;

  // Logic for the Guest Confirmation
  function confirmGuestSubmit() {
    showGuestWarning = true;
  }

  function proceedAsGuest() {
    isGuest = true;
    showGuestWarning = false;
    submitClaim(); // This calls your existing submit function
  }

  let session: any = null;

  onMount(async () => {
    // 1. Set default time to "Now"
    const now = new Date();
    // This magic line formats it for the HTML datetime-local input
    purchaseTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    const { data } = await supabase.auth.getSession();
    session = data.session;

    // 2. Check URL for pre-fills (e.g., ?venue=BarOne&ref=User123)
    const params = new URLSearchParams(window.location.search);
    if (params.get('venue')) venue = params.get('venue') || '';
    if (params.get('ref')) referrer = params.get('ref') || '';
    const urlAmount = params.get('amount');
    if (urlAmount) amount = parseFloat(urlAmount);

    if (referrer) isReferrerLocked = true;
    if (venue) isVenueLocked = true;

    const urlLast4 = params.get('last4');
      if (urlLast4) {
        last4 = urlLast4;
      } else if (session) {
        // If it's NOT in the URL, try the database profile we built
        const { data: profile } = await supabase
          .from('profiles')
          .select('last_4')
          .eq('id', session.user.id)
          .single();
        
        if (profile?.last_4) last4 = profile.last_4;
      }

      if (session) {
        await fetchDashboardData();
      }

  });

  async function submitClaim() {
    if (!amount || amount <= 0) {
      status = 'error';
      errorMessage = 'Please enter a valid amount';
      return;
    }

    const cleanAmount = parseFloat(Number(amount).toFixed(2));

    if (last4.length !== 4) {
      status = 'error';
      errorMessage = 'Please enter 4 digits';
      return;
    }

    status = 'loading';
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
        if (user) {
        // UPSERT (Update or Insert) the last4 into the profiles table
        await supabase
          .from('profiles')
          .upsert({ 
            id: user.id, 
            last_4: last4, 
            updated_at: new Date().toISOString() 
          });
      }
      const { error } = await supabase
        .from('claims') // Make sure your table is named 'claims' in Supabase
        .insert([{ 
          venue,
          referrer,
          amount: cleanAmount, 
          purchased_at: new Date(purchaseTime).toISOString(),
          last_4: last4,
          created_at: new Date().toISOString(),
          submitter_id: session?.user?.id
        }]);

      if (error) throw error;

      status = 'success';
      amount = null;
      last4 = '';
      if (session) await fetchDashboardData();
      setTimeout(() => {
        if (status === 'success') {
          status = 'idle';
          if (session) showForm = false;
        }
      }, 2000);
    } catch (e: any) {
      status = 'error';
      errorMessage = e.message || 'Connection failed';
      console.error(e);
    }
  }
  $: last4 = last4.replace(/\D/g, '');
  $: kickback = ((Number(amount) ?? 0) * 0.05).toFixed(2);
  $: if (amount !== null && amount !== undefined) {
    const stringAmount = amount.toString();
    if (stringAmount.includes('.') && stringAmount.split('.')[1].length > 2) {
      // Chops the string to two decimals and converts back to number
      amount = parseFloat(stringAmount.slice(0, stringAmount.indexOf('.') + 3));
    }
}

async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error logging out:', error.message);
    } else {
      // Refresh the page to clear the session and go back to Guest mode
      window.location.href = '/'; 
    }
  }

</script>

<main class="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">

  {#if session && !showForm}
  <div class="w-full max-w-sm space-y-10" in:fade>
    <header class="text-center">
      <h1 class="text-4xl font-black tracking-tighter italic uppercase">Kickback</h1>
      <p class="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2">Member Dashboard</p>
    </header>

    <div class="bg-zinc-900 border border-zinc-800 p-8 rounded-[2.5rem] text-center shadow-2xl">
      <p class="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2">Pending Balance</p>
      <div class="flex items-center justify-center gap-3">
        <h2 class="text-6xl font-black text-green-500">${totalPending.toFixed(2)}</h2>
      </div>
      <p class="text-[10px] font-black text-zinc-600 mt-4 uppercase tracking-tighter">● Verifying with bank</p>
    </div>

    <button 
      on:click={() => showForm = true}
      class="w-full bg-white text-black font-black py-5 rounded-[2rem] text-xl uppercase tracking-tight shadow-xl shadow-white/5 active:scale-95 transition-all"
    >
      + New Claim
    </button>

    <div class="space-y-4 mt-12">
      <div class="flex justify-between items-end border-b border-zinc-900 pb-4">
        <h3 class="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">History</h3>
        <p class="text-[10px] font-bold text-zinc-600 uppercase">{claims.length} Claims</p>
      </div>

      {#each claims as claim}
        <details class="group bg-zinc-900/20 border border-zinc-900 rounded-2xl overflow-hidden mb-4">
          <summary class="list-none p-5 flex justify-between items-center cursor-pointer active:bg-zinc-900/50">
            <div>
              <p class="text-xl font-black text-white">+${(claim.amount * 0.05).toFixed(2)}</p>
              <p class="text-[10px] text-zinc-500 font-bold uppercase tracking-tighter">
                {claim.venue} • {new Date(claim.purchased_at).toLocaleDateString()}
              </p>
            </div>
            <div class="text-xs font-black text-zinc-700 group-open:rotate-180 transition-transform">▼</div>
          </summary>

          <div class="px-5 pb-6 pt-2 space-y-6" transition:slide>
            
            <div class="space-y-3">
              <div class="flex justify-between items-end">
                <p class="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Trial Progress at {claim.venue}</p>
                <p class="text-[10px] font-black text-white">
                  {GOAL_DAYS - getDaysAtVenue(claim.venue)} DAYS LEFT
                </p>
              </div>
              
              <div class="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  class="h-full bg-green-500 transition-all duration-1000" 
                  style="width: {(getDaysAtVenue(claim.venue) / GOAL_DAYS) * 100}%"
                ></div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-800/50">
              <div>
                <p class="text-[8px] font-black text-zinc-500 uppercase mb-1">Total Bill</p>
                <p class="text-xs font-bold text-white">${claim.amount.toFixed(2)}</p>
              </div>
              <div>
                <p class="text-[8px] font-black text-zinc-500 uppercase mb-1">Referrer</p>
                <p class="text-xs font-bold text-green-500 uppercase">{claim.referrer || 'Direct'}</p>
              </div>
            </div>

          </div>
        </details>
      {:else}
        <div class="py-12 text-center border-2 border-dashed border-zinc-900 rounded-[2rem]">
          <p class="text-zinc-600 text-xs font-bold uppercase tracking-widest">No activity yet</p>
        </div>
      {/each}
      
      <div class="mt-12 text-center">
        <button 
          on:click={handleSignOut}
          class="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] hover:text-white transition-colors"
        >
          LOGOUT: {session.user.email}
        </button>
      </div>

    <div class="h-16 w-full"></div>

    </div>

    </div>

{:else}
  <div class="w-full max-w-sm space-y-8" in:fly={{ y: 20 }}>
    
    {#if session}
      <button on:click={() => showForm = false} class="text-zinc-600 font-bold text-xs uppercase tracking-widest flex items-center gap-2 mb-4">
        ← Back to Balance
      </button>
    {/if}

  <div class="fixed top-10 left-0 right-0 px-6 z-[100] pointer-events-none">
    {#if status === 'success'}
      <div 
        in:fly={{ y: -20, duration: 400 }} 
        out:fade={{ duration: 300 }}
        class="bg-green-500 border border-green-400 text-white p-4 rounded-2xl text-center text-sm font-black shadow-2xl shadow-green-500/40 pointer-events-auto"
      >
        ✅ CLAIM SUBMITTED SUCCESSFULLY
      </div>
    {:else if status === 'error'}
      <div 
        in:fly={{ y: -20, duration: 400 }} 
        out:fade={{ duration: 300 }}
        class="bg-red-500 border border-red-400 text-white p-4 rounded-2xl text-center text-sm font-black shadow-2xl shadow-red-500/40 pointer-events-auto"
      >
        ⚠️ {errorMessage.toUpperCase()}
      </div>
    {/if}
  </div>

  <div class="w-full max-w-sm space-y-8">
    
    <div class="text-center">
      <h1 class="text-4xl font-black tracking-tighter italic uppercase">Kickback</h1>
      <p class="text-zinc-500 text-sm mt-2">Pilot Program • Claim Portal</p>
    </div>

    <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-2xl">
      <div class="space-y-5">
        
        <div>
          <label for="venue" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Venue</label>
          <input 
            id="venue"
            type="text" 
            bind:value={venue} 
            readonly={isVenueLocked}
            placeholder="Bar Name"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none {isVenueLocked ? 'opacity-50 cursor-not-allowed' : ''}"
          />
        </div>

        <div>
          <label for="referrer" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Referrer ID</label>
          <input 
            id="referrer"
            type="text" 
            bind:value={referrer} 
            readonly={isReferrerLocked}
            placeholder="Who sent you?"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none {isReferrerLocked ? 'opacity-50 cursor-not-allowed' : ''}"
          />
        </div>

        <div class="relative">
          <span class="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 font-bold">$</span>
          <input 
            type="number" 
            step="0.01"
            value={amount}
            on:input={handleInput}
            placeholder="0.00"
            inputmode="decimal"
            class="w-full bg-zinc-800 border-none p-4 pl-8 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none"
          />
        </div>

        {#if (amount ?? 0) >= MAX_BILL}
          <p transition:fade class="text-orange-500 text-[10px] font-bold mt-2 px-2">
            ⚠️ MAXIMUM BILL AMOUNT REACHED (${MAX_BILL})
          </p>
        {/if}

        <div>
          <label for="time" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Time of Purchase</label>
          <input 
            id="time"
            type="datetime-local" 
            bind:value={purchaseTime} 
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-lg focus:ring-2 focus:ring-white outline-none [color-scheme:dark]"
          />
        </div>

        <div>
          <label for="last4" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Card Digits (Last 4)</label>
          <input 
            id="last4"
            type="text" 
            inputmode="numeric"
            pattern="[0-9]*"
            bind:value={last4} 
            placeholder="1234"
            maxlength="4"
            class="w-full bg-zinc-800 border-none p-4 rounded-2xl text-xl font-medium focus:ring-2 focus:ring-white transition-all outline-none"
          />
        </div>

        {#if amount && amount > 0}
          <div transition:slide={{ duration: 300 }} class="flex justify-between items-center px-2 mb-4 text-sm font-bold">
            <span class="text-zinc-500">REWARD (5%)</span>
            <span class="text-green-500">+ ${kickback}</span>
          </div>
        {/if}

        <div class="space-y-4">
          {#if session}
            <button 
              on:click={submitClaim}
              disabled={status === 'loading' || (amount ?? 0) <= 0}
              class="w-full bg-green-500 text-black font-black py-4 rounded-2xl text-lg active:scale-95 transition-all disabled:opacity-50"
            >
              {status === 'loading' ? 'PROCESSING...' : `SUBMIT & CLAIM $${kickback}`}
            </button>
          {:else}
            <button 
              on:click={() => window.location.href = `/login?amount=${amount}&venue=${venue}&ref=${referrer}&last4=${last4}`}
              disabled={status === 'loading' || (amount ?? 0) <= 0}
              class="w-full bg-white text-black font-black py-4 rounded-2xl text-lg active:scale-95 transition-all shadow-xl shadow-white/5"
            >
              SIGN UP & CLAIM ${kickback}
            </button>

            <button on:click={confirmGuestSubmit} type="button" class="w-full py-2 text-zinc-500 font-bold text-xs uppercase tracking-[0.2em]">
              Submit as Guest
            </button>
          {/if}
        </div>

      </div>
    </div>
  </div>
  {#if showGuestWarning}
    <div class="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6" transition:fade>
      
      <div in:fly={{ y: 20, duration: 400 }} class="bg-zinc-900 border border-zinc-800 p-8 rounded-[2rem] w-full max-w-sm text-center shadow-2xl">
        <div class="w-16 h-16 bg-orange-500/10 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="w-8 h-8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" stroke-width="2.5" />
          </svg>
        </div>
        
        <h2 class="text-2xl font-black text-white mb-3 italic uppercase tracking-tighter">Wait a second!</h2>
        
        <p class="text-zinc-400 text-sm leading-relaxed mb-8">
          By submitting as a guest, your friend gets <span class="text-white font-bold">${kickback}</span>, but you'll receive <span class="text-red-400 font-bold">$0.00</span>. 
          <br/><br/>
          Join Kickback to keep 5% for yourself!
        </p>

        <div class="space-y-3">
          <button 
            on:click={() => window.location.href = '/login'}
            class="w-full bg-green-500 text-black font-black py-4 rounded-2xl uppercase tracking-tight"
          >
            Sign Up & Get My ${kickback}
          </button>
          
          <button 
            on:click={proceedAsGuest}
            class="w-full bg-transparent text-zinc-600 font-bold py-2 text-xs uppercase tracking-widest"
          >
            No thanks, continue as guest
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if session}
    <div class="mt-12 text-center">
      <button 
        on:click={handleSignOut}
        class="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] hover:text-white transition-colors"
      >
        LOGOUT: {session.user.email}
      </button>
    </div>
  {/if}

</div> {/if}

{#if session && !showForm}
  <div class="fixed bottom-8 left-0 right-0 px-6 z-50 flex justify-center" in:fly={{ y: 100 }}>
    <button class="w-full max-w-sm bg-zinc-900/80 backdrop-blur-xl border border-zinc-700 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 shadow-2xl active:scale-95 transition-all uppercase text-xs tracking-[0.2em]">
      🤝 Refer a Friend
    </button>
  </div>
{/if}

</main>