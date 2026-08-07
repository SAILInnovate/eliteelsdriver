import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@12.5.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Connect to Stripe using the Platform Secret Key
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: '2022-11-15',
    httpClient: Stripe.createFetchHttpClient(),
})

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // 1. Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // 2. Initialize Supabase Client
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? ''
        )

        // 3. Authenticate the Driver making the request
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('No authorization header')

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
            authHeader.replace('Bearer ', '')
        )
        if (userError || !user) throw new Error('Unauthorized')

        // 4. Find the driver record in DB
        const { data: driver, error: driverError } = await supabaseClient
            .from('active_drivers')
            .select('id, stripe_account_id')
            .eq('user_id', user.id)
            .single()

        // It's possible the driver didn't hit Go Online to save a record yet.
        // Ensure they have a record first, or create an ad-hoc row (we assume they created it in step 0)
        if (driverError) {
            throw new Error('Driver profile not found. Complete Step 0 setup first.')
        }

        let accountId = driver.stripe_account_id

        // 5. Create a new Stripe Connect Express Account if they don't have one
        if (!accountId) {
            const account = await stripe.accounts.create({
                type: 'express',
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true },
                },
                business_type: 'individual',
            })
            accountId = account.id

            // Save the precise Stripe Account ID back into active_drivers
            const { error: updateError } = await supabaseClient
                .from('active_drivers')
                .update({ stripe_account_id: accountId })
                .eq('user_id', user.id)

            if (updateError) throw new Error('Failed to attach Stripe Account to database profile.')
        }

        // 6. Generate the Stripe Onboarding Link (AccountLink)
        const accountLink = await stripe.accountLinks.create({
            account: accountId,
            refresh_url: 'clinch://dashboard',
            return_url: 'clinch://onboarding/?success=true',
            type: 'account_onboarding',
        })

        // 7. Return the URL to Capacitor
        return new Response(JSON.stringify({ url: accountLink.url }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
