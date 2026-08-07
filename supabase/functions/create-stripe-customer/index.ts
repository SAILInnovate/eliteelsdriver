import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@13.6.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { user_id, name, phone } = await req.json()

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if customer already exists
    const { data: profile } = await supabase
      .from('passenger_profiles')
      .select('stripe_customer_id')
      .eq('user_id', user_id)
      .single()

    if (profile?.stripe_customer_id && profile.stripe_customer_id !== 'pending_setup') {
      // Already has a Stripe customer — return existing
      return new Response(
        JSON.stringify({ customer_id: profile.stripe_customer_id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create new Stripe customer
    const customer = await stripe.customers.create({
      name: name || undefined,
      phone: phone || undefined,
      metadata: { supabase_user_id: user_id }
    })

    // Save to passenger_profiles
    await supabase
      .from('passenger_profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('user_id', user_id)

    return new Response(
      JSON.stringify({ customer_id: customer.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Error creating Stripe customer:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
