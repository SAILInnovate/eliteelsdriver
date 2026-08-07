// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER") ?? "";

// For securing manual triggers if needed via HTTP
const API_SECRET = Deno.env.get("CRON_SECRET") ?? "";

serve(async (req) => {
    // Basic auth check to prevent random triggers if we open this map
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${API_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

        // Calculate timestamp exactly 24 hours from right now
        const tomorrow = new Date();
        tomorrow.setHours(tomorrow.getHours() + 24);

        // Let's grab a window: anything due between 23h50m and 24h10m from now
        // This handles slight cron scheduling variances
        const windowStart = new Date(tomorrow.getTime() - 10 * 60000).toISOString();
        const windowEnd = new Date(tomorrow.getTime() + 10 * 60000).toISOString();

        // Query the database securely using the Admin Key
        // We look for:
        // 1. Pending or Clinched deals (not rejected/expired)
        // 2. Due Date is inside our 24h window
        // 3. Sent by a PRO User
        const { data: upcomingDeals, error } = await supabase
            .from('clinches')
            .select(`
                id,
                terms,
                sender_name,
                recipient_phone,
                sender_id,
                status,
                due_date,
                user_subscriptions!inner ( tier )
            `)
            .in('status', ['pending', 'clinched'])
            .gte('due_date', windowStart)
            .lte('due_date', windowEnd)
            .eq('user_subscriptions.tier', 'pro');

        if (error) {
            console.error("Database query error:", error);
            throw error;
        }

        if (!upcomingDeals || upcomingDeals.length === 0) {
            return new Response("No PRO clinches due tomorrow in this window.", { status: 200 });
        }

        console.log(`Found ${upcomingDeals.length} reminders to send.`);

        // Process all SMS via Twilio using basic fetch instead of importing heavy SDK
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`); // Basic Auth Encoding

        let sentCount = 0;

        for (const deal of upcomingDeals) {
            const friendlyName = deal.sender_name || 'Someone';
            // Determine vocabulary based on if it was sealed yet.
            const preamble = deal.status === 'clinched'
                ? `Friendly reminder from Clinch+`
                : `Pending handhake reminder`;

            const messageBody = `⏳ ${preamble}: Your agreement with ${friendlyName} is due tomorrow.\n\nTerms: "${deal.terms}"`;

            // Build the URL-encoded payload for Twilio
            const formBody = new URLSearchParams();
            formBody.append('To', deal.recipient_phone);
            formBody.append('From', TWILIO_PHONE_NUMBER);
            formBody.append('Body', messageBody);

            try {
                const smsResponse = await fetch(twilioUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: formBody.toString(),
                });

                if (smsResponse.ok) {
                    console.log(`✅ Sent SMS Reminder to ${deal.recipient_phone} for deal ${deal.id}`);
                    sentCount++;
                } else {
                    const errorData = await smsResponse.text();
                    console.error(`❌ Twilio Error sending to ${deal.recipient_phone}:`, errorData);
                }
            } catch (sendError) {
                console.error(`Fetch exception to Twilio for deal ${deal.id}:`, sendError);
            }
        }

        return new Response(JSON.stringify({
            success: true,
            attempted: upcomingDeals.length,
            sent: sentCount
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
        console.error("Cron Error:", err);
        return new Response(`Cron Error: ${err.message}`, { status: 500 });
    }
});
