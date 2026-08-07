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

    const { ride_id } = await req.json()

    if (!ride_id) {
      return new Response(
        JSON.stringify({ error: 'ride_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the ride details
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('passenger_id, final_calculated_price, status')
      .eq('id', ride_id)
      .single()

    if (rideError || !ride) {
      return new Response(
        JSON.stringify({ error: 'Ride not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!ride.final_calculated_price || ride.final_calculated_price <= 0) {
      return new Response(
        JSON.stringify({ error: 'No price calculated for this ride' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the passenger's Stripe customer & credits
    const { data: profile } = await supabase
      .from('passenger_profiles')
      .select('stripe_customer_id, available_credits')
      .eq('user_id', ride.passenger_id)
      .single()

    if (!profile?.stripe_customer_id) {
      return new Response(
        JSON.stringify({ error: 'Passenger has no payment method' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const totalPence = Math.round(ride.final_calculated_price * 100) // Convert £ to pence
    let amountToCharge = totalPence
    let creditsUsed = 0

    // Deduct credits first if available
    if (profile.available_credits > 0) {
      const creditsPence = Math.round(profile.available_credits * 100)
      creditsUsed = Math.min(creditsPence, totalPence)
      amountToCharge = totalPence - creditsUsed

      // Deduct credits from profile
      const newCredits = (profile.available_credits * 100 - creditsUsed) / 100
      await supabase
        .from('passenger_profiles')
        .update({ available_credits: newCredits })
        .eq('user_id', ride.passenger_id)
    }

    let paymentIntent = null

    // Only charge card if there's a remaining balance after credits
    if (amountToCharge > 0) {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountToCharge,
        currency: 'gbp',
        customer: profile.stripe_customer_id,
        off_session: true, // Charge without user being present
        confirm: true,
        description: `Elite ride ${ride_id}`,
        metadata: {
          ride_id,
          credits_used_pence: creditsUsed.toString()
        }
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_pence: totalPence,
        credits_used_pence: creditsUsed,
        card_charged_pence: amountToCharge,
        payment_intent_id: paymentIntent?.id || null,
        status: paymentIntent?.status || 'covered_by_credits'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Error charging ride:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
