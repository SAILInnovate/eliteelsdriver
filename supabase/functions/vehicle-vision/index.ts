// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function extractOutputText(responsePayload) {
    if (responsePayload?.output_text) return responsePayload.output_text

    const output = responsePayload?.output || []
    for (const item of output) {
        const content = item?.content || []
        for (const block of content) {
            if (typeof block?.text === 'string') return block.text
            if (typeof block?.output_text === 'string') return block.output_text
        }
    }

    return ''
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Missing authorization header.')

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? ''
        )

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
            authHeader.replace('Bearer ', '')
        )

        if (authError || !user) throw new Error('Unauthorized')

        const { plateImage, frontImage, backImage, sideImage } = await req.json()

        if (!plateImage || !frontImage || !backImage || !sideImage) {
            throw new Error('Missing one or more required vehicle images.')
        }

        const openAiKey = Deno.env.get('OPENAI_API_KEY')
        if (!openAiKey) {
            throw new Error('OPENAI_API_KEY is not configured for vehicle-vision.')
        }

        const prompt = [
            'You are a strict vehicle extraction service.',
            'Read the supplied plate photo and vehicle photos.',
            'Return ONLY valid JSON with this exact shape:',
            '{',
            '  "brand": "string",',
            '  "model": "string",',
            '  "color": "string",',
            '  "license_plate": "string",',
            '  "vehicle_type": "standard|electric|estate|suv|van|other"',
            '}',
            'If unsure, use empty strings for unknown fields.'
        ].join(' ')

        const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${openAiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4.1-mini',
                input: [
                    {
                        role: 'user',
                        content: [
                            { type: 'input_text', text: prompt },
                            { type: 'input_image', image_url: plateImage },
                            { type: 'input_image', image_url: frontImage },
                            { type: 'input_image', image_url: backImage },
                            { type: 'input_image', image_url: sideImage },
                        ],
                    },
                ],
                max_output_tokens: 300,
            }),
        })

        if (!openAiResponse.ok) {
            const errorText = await openAiResponse.text()
            throw new Error(`OpenAI call failed: ${errorText}`)
        }

        const openAiPayload = await openAiResponse.json()
        const outputText = extractOutputText(openAiPayload)

        if (!outputText) throw new Error('No AI output returned from vehicle vision model.')

        let parsedVehicle
        try {
            parsedVehicle = JSON.parse(outputText)
        } catch (_error) {
            throw new Error('AI output was not valid JSON.')
        }

        return new Response(
            JSON.stringify({
                vehicle: {
                    brand: parsedVehicle?.brand || '',
                    model: parsedVehicle?.model || '',
                    color: parsedVehicle?.color || '',
                    license_plate: parsedVehicle?.license_plate || '',
                    vehicle_type: parsedVehicle?.vehicle_type || '',
                },
            }),
            {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        )
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
