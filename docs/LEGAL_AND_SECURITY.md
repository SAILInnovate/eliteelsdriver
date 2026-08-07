# Clinch Legal & System Design Architecture

## 1. Do we store how long a user has had an account?
**Yes, natively via Supabase Authentication.**
When a user initially signs up via SMS, Supabase creates a unique `auth.users(id)` and stamps it with a `created_at` timestamp. 

While we are not currently displaying this directly in the UI, the data exists in the backend. When building the B2B Trust API or scaling the Trust Graph, we can easily query this date and calculate "Account Age" (e.g., "Active for 4.2 years"). The longer a phone number has been linked to the same account without being banned, the more weight it carries in the Trust Graph algorithm.

---

## 2. What happens when someone breaks their Clinch?
Because Clinch operates exactly like a traditional contract, **breaking a Clinch is technically a breach of contract.** 

Currently, Clinches are binary—they are either `pending` or `clinched` (agreed). 
In Version 2, we will introduce a **"Dispute & Settlement" Engine:**

### The Broken Clinch Workflow:
1. **The Claim:** The Sender taps "Report Broken Promise" in their vault. 
2. **The Freeze:** Both users temporarily have their Trust Graph scores frozen or marked with a warning flag (similar to a pending dispute on a credit report).
3. **The Proof:** Both parties can upload evidence (a screenshot of the Venmo receipt proving they *did* pay the electric bill, or a photo of the damaged camera lens).
4. **Resolution via Gamification:** The recipient has a choice:
   * Settle up and admit fault (lowers their Trust Score slightly, but removes the pending dispute).
   * Contest the claim (triggers an arbitration mode).
   * Ignore it (results in a permanent, severe penalty to their Trust Score, effectively banishing them from the Trust network similar to defaulting on a loan).

---

## 3. Do we provide enough legal security to take action?
**Yes. We are capturing more empirical evidence than DocuSign does on their basic tier.**

Under the **US Electronic Signatures in Global and National Commerce Act (ESIGN)** and the **UK Electronic Communications Act 2000**, electronic signatures are entirely legally binding. A signature doesn't require a physical scribble; it only requires "an electronic sound, symbol, or process, attached to or logically associated with a contract or other record and executed or adopted by a person with the intent to sign the record."

**Here is the exact evidence Clinch captures in the `seal_clinch` RPC database function when a user slides the slider:**
1. **The Terms:** "Sarah pays Dave £150..." (Stored immutably).
2. **Cryptographic Phone Verification:** We verify the SMS token matching the exact Twilio OTP payload against the user's secure JSON Web Token (`auth.jwt() ->> 'phone'`). 
3. **Server-Side Timestamp:** `agreed_at = timezone('utc'::text, now())` cannot be faked or spoofed by changing the time on a Macbook or iPhone.
4. **Server-Side IP Capture:** We bypass the React client and pull the `x-forwarded-for` HTTP header directly at the database level (`agreed_ip = client_ip`), which provides the exact network node the user was on. 
5. **Intent:** The user had to physically click a link, type in an SMS code, and slide an interactive UI element labeled "Agree to Terms." 

If Dave takes Sarah to small claims court in London or New York over the £150, the printed Clinch Certificate containing the Server IP, precise UTC timestamp, and Phone Cryptography is an admissible, self-authenticating electronic record of intent.

---

## 4. Real World Scenarios where Clinch is Disruptive

### The Freelancer Loophole 
* **The Problem:** A freelance graphic designer gets a text: *"Can you design a logo for me by tomorrow? I'll send you $250 on CashApp when it's done."* Normally, the freelancer has zero leverage if the person ghosts them. Sending a formal DocuSign is too aggressive and ruins the "chill" vibe.
* **The Clinch:** The designer texts back: *"Sure, just clinched the terms to you: clinch.to/agree/1234."* The client taps it, slides the slider, and the designer operates with a legally binding digital handshake.

### The Facebook Marketplace Hold
* **The Problem:** Someone messages you on Craigslist: *"I want to buy your couch, but I can't come until Friday. Don't sell it to anyone else!"* They ghost you on Friday, and you lost 3 other buyers.
* **The Clinch:** *"I'm holding it for you. Clinch this agreement that you'll show up by 5pm Friday or forfeit a $20 deposit."* If their Trust Score is 98, you know they are coming. If it's 12, you sell it to the next guy.

### The Shared House (Roommate)
* **The Problem:** "Hey man, can you spot me for the broadband bill this month? I'll get you on the 10th."
* **The Clinch:** You draft a 1-sentence Clinch. It takes 4 seconds. There is no awkward follow-up on the 11th because the Clinch Vault permanently shows the debt is 'clinched' until the roommate settles it.
