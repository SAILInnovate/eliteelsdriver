import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { amount, user_id } = await req.json();

    if (!amount || amount < 10) {
      return new Response(
        JSON.stringify({ error: 'Minimum top-up is £10' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const NOWPAYMENTS_API_KEY = Deno.env.get('NOWPAYMENTS_API_KEY');
    if (!NOWPAYMENTS_API_KEY) {
      throw new Error('NOWPayments API key not configured');
    }

    // Determine API base URL (sandbox vs production)
    const apiBase = Deno.env.get('NOWPAYMENTS_SANDBOX') === 'true'
      ? 'https://api-sandbox.nowpayments.io'
      : 'https://api.nowpayments.io';

    const orderId = `topup_${user_id}_${Date.now()}`;

    // Create NOWPayments invoice
    const invoiceRes = await fetch(`${apiBase}/v1/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key': NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_amount: amount,
        price_currency: 'gbp',
        order_id: orderId,
        order_description: `Elite ELS Credit Top-Up — £${amount}`,
        ipn_callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/crypto-webhook`,
        success_url: 'eliteels://topup-success',
        cancel_url: 'eliteels://topup-cancel',
      }),
    });

    if (!invoiceRes.ok) {
      const errBody = await invoiceRes.text();
      console.error('NOWPayments error:', errBody);
      throw new Error('Failed to create crypto invoice');
    }

    const invoice = await invoiceRes.json();

    // Store the pending top-up for tracking
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    await supabaseAdmin.from('crypto_topups').insert({
      user_id,
      order_id: orderId,
      nowpayments_invoice_id: invoice.id,
      amount_gbp: amount,
      status: 'waiting',
    });

    return new Response(
      JSON.stringify({
        invoice_url: invoice.invoice_url,
        invoice_id: invoice.id,
        order_id: orderId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Crypto top-up error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
