import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@12.5.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    // CORS Preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? ''
        )

        // Authenticate the Rider making the request
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('No authorization header')

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
            authHeader.replace('Bearer ', '')
        )
        if (userError || !user) throw new Error('Unauthorized')

        // Parse the payload requested by the Capacitor App
        const { rideId, currentBid } = await req.json()
        if (!rideId || !currentBid) throw new Error('Missing rideId or currentBid amount')

        // Amount needs to be in pence (£12 -> 1200)
        const amountPence = Math.round(Number(currentBid) * 100);

        // 1. Fetch the Ride Request from Supabase to ensure it exists and get driver ID
        const { data: ride, error: rideError } = await supabaseClient
            .from('ride_requests')
            .select('assigned_driver_id, current_bid')
            .eq('id', rideId)
            .single()

        if (rideError || !ride) throw new Error('Ride not found')

        // Validate the amount matches what was bid in the database
        if (Math.round(ride.current_bid * 100) !== amountPence) {
            throw new Error(`Amount mismatch. Database Expects: ${ride.current_bid}`);
        }

        // 2. Fetch the Driver's Stripe Connect Account ID
        const { data: driver, error: driverError } = await supabaseClient
            .from('active_drivers')
            .select('stripe_account_id')
            .eq('id', ride.assigned_driver_id)
            .single()

        if (driverError || !driver || !driver.stripe_account_id) {
            throw new Error('Driver has not set up Stripe Payouts.')
        }

        // 3. Create the Direct Charge PaymentIntent
        // Massive Benefit: Because we use "stripeAccount", this makes the DRIVER 
        // the true Merchant of Record. If the rider initiates a fraudulent chargeback, it hits the Driver.
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountPence,
            currency: 'gbp',
            // Automatic Payment Methods support Apple Pay and Google Pay instantly on native sheets
            automatic_payment_methods: { enabled: true },
        }, {
            // The crucial step: Perform this action ON BEHALF of the driver directly
            stripeAccount: driver.stripe_account_id
        })

        // 4. Return the secure client secret to the frontend Capacitor Native Sheet
        return new Response(
            JSON.stringify({
                clientSecret: paymentIntent.client_secret,
                stripeAccount: driver.stripe_account_id // Capacitor Stripe plugin needs this too
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
