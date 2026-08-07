import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@13.6.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
  const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  let event: Stripe.Event

  try {
    if (endpointSecret && sig) {
      event = stripe.webhooks.constructEvent(body, sig, endpointSecret)
    } else {
      // Fallback for local dev without webhook signing
      event = JSON.parse(body)
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Handle SetupIntent succeeded — card saved
  if (event.type === 'setup_intent.succeeded') {
    const setupIntent = event.data.object as Stripe.SetupIntent
    const customerId = setupIntent.customer as string
    const paymentMethodId = setupIntent.payment_method as string

    if (paymentMethodId) {
      try {
        // Fetch the payment method to get card details
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId)
        const card = pm.card

        if (card && customerId) {
          // Set as default payment method on customer
          await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: paymentMethodId }
          })

          // Save card info to passenger_profiles
          const { error } = await supabase
            .from('passenger_profiles')
            .update({
              card_brand: card.brand,
              card_last4: card.last4,
              default_payment_method_id: paymentMethodId
            })
            .eq('stripe_customer_id', customerId)

          if (error) {
            console.error('Failed to update passenger profile:', error)
          } else {
            console.log(`Card saved for customer ${customerId}: ${card.brand} ****${card.last4}`)
          }
        }
      } catch (err) {
        console.error('Error processing setup_intent.succeeded:', err)
      }
    }
  }

  // Handle payment method detached
  if (event.type === 'payment_method.detached') {
    const pm = event.data.object as Stripe.PaymentMethod
    // Clear card info if this was the saved card
    await supabase
      .from('passenger_profiles')
      .update({ card_brand: null, card_last4: null, default_payment_method_id: null })
      .eq('default_payment_method_id', pm.id)
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  })
})
