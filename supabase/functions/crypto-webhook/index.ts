import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'node:crypto';

serve(async (req) => {
  // NOWPayments sends POST with payment data + signature in header
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const IPN_SECRET = Deno.env.get('NOWPAYMENTS_IPN_SECRET');
    if (!IPN_SECRET) throw new Error('IPN secret not configured');

    const receivedSig = req.headers.get('x-nowpayments-sig');
    const body = await req.text();
    const params = JSON.parse(body);

    // Verify HMAC-SHA512 signature
    if (receivedSig) {
      const sortedParams = JSON.stringify(params, Object.keys(params).sort());
      const hmac = createHmac('sha512', IPN_SECRET);
      hmac.update(sortedParams);
      const computedSig = hmac.digest('hex');

      if (computedSig !== receivedSig) {
        console.error('Invalid IPN signature');
        return new Response('Invalid signature', { status: 401 });
      }
    }

    console.log('Crypto webhook received:', JSON.stringify({
      payment_id: params.payment_id,
      payment_status: params.payment_status,
      order_id: params.order_id,
      price_amount: params.price_amount,
      price_currency: params.price_currency,
      pay_amount: params.pay_amount,
      pay_currency: params.pay_currency,
    }));

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Update the crypto_topups record
    const orderId = params.order_id;
    await supabaseAdmin
      .from('crypto_topups')
      .update({
        status: params.payment_status,
        pay_currency: params.pay_currency,
        pay_amount: params.pay_amount,
        nowpayments_payment_id: params.payment_id?.toString(),
        updated_at: new Date().toISOString(),
      })
      .eq('order_id', orderId);

    // Only credit the account on confirmed/finished
    if (params.payment_status === 'confirmed' || params.payment_status === 'finished') {
      // Extract user_id from order_id format: "topup_{userId}_{timestamp}"
      const userId = orderId.split('_')[1];
      const amount = parseFloat(params.price_amount);

      if (userId && amount > 0) {
        // Check if already credited (idempotency)
        const { data: topup } = await supabaseAdmin
          .from('crypto_topups')
          .select('credited')
          .eq('order_id', orderId)
          .single();

        if (!topup?.credited) {
          // Credit the user
          const { data: profile } = await supabaseAdmin
            .from('passenger_profiles')
            .select('credits')
            .eq('user_id', userId)
            .single();

          const currentCredits = profile?.credits || 0;
          const newCredits = currentCredits + amount;

          await supabaseAdmin
            .from('passenger_profiles')
            .update({ credits: newCredits })
            .eq('user_id', userId);

          // Mark as credited
          await supabaseAdmin
            .from('crypto_topups')
            .update({ credited: true })
            .eq('order_id', orderId);

          console.log(`Credited £${amount} to user ${userId}. New balance: £${newCredits}`);
        } else {
          console.log(`Order ${orderId} already credited — skipping`);
        }
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Crypto webhook error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
