import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@13.6.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { user_id } = await req.json()

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the Stripe customer ID
    const { data: profile } = await supabase
      .from('passenger_profiles')
      .select('stripe_customer_id')
      .eq('user_id', user_id)
      .single()

    if (!profile?.stripe_customer_id || profile.stripe_customer_id === 'pending_setup') {
      return new Response(
        JSON.stringify({ error: 'No Stripe customer found. Create customer first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create a SetupIntent — this lets the user save a card/Apple Pay
    // without charging them. The card is saved for future payments.
    const setupIntent = await stripe.setupIntents.create({
      customer: profile.stripe_customer_id,
      payment_method_types: ['card'],
      usage: 'off_session', // Allow charging later without user present
    })

    // Also create an ephemeral key for the native Stripe SDK
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: profile.stripe_customer_id },
      { apiVersion: '2023-10-16' }
    )

    return new Response(
      JSON.stringify({
        setup_intent_client_secret: setupIntent.client_secret,
        ephemeral_key: ephemeralKey.secret,
        customer_id: profile.stripe_customer_id,
        publishable_key: Deno.env.get('STRIPE_PUBLISHABLE_KEY')
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Error creating setup intent:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
