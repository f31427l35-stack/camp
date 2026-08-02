/**
 * Vercel Serverless Function
 * POST /api/initiate-payment
 *
 * Called by the frontend when the user taps "Proceed to Payment".
 * Reads your Sendit credentials from Vercel Environment Variables (never
 * from the frontend) and triggers a real STK push through Sendit.
 *
 * Set these in your Vercel project:
 *   Project -> Settings -> Environment Variables
 *     SENDIT_API_KEY    (from your Sendit dashboard, per linked till/paybill)
 *     SENDIT_BASE_URL   (your Sendit deployment, e.g. https://sendit.vercel.app)
 *
 * FOR TESTING: Sendit's own PLATFORM_ENV is set to sandbox on its side, so
 * this hits Safaricom's sandbox, not real M-Pesa — nothing here needs to
 * change to reflect that; it's entirely a Sendit-side config.
 *
 * NOTE ON ARCHITECTURE (carried over from the Paywave Express integration):
 * Sendit also exposes a real transaction-status endpoint
 * (GET /api/v1/status). That means api/payment-status.js queries Sendit
 * directly on every poll, same pattern as before — see that file and
 * api/sendit-callback.js for how that plays out. One difference from
 * Paywave: Sendit's own STK callback URL points back at Sendit itself
 * (it registers `${SENDIT_BASE_URL}/api/v1/callback/[accountId]` with
 * Safaricom, not a camp URL), so there's no M-Pesa webhook landing here
 * directly — api/sendit-callback.js only matters if you register camp's
 * URL as a Sendit *developer* webhook (a separate, optional feature).
 */

const BASE_URL = process.env.SENDIT_BASE_URL;

function normalizePhoneNumber(phone) {
    // Docs show both 0712345678 and 254712345678 as accepted formats, so
    // minimal normalization is needed — just strip non-digits and ensure
    // a 254-prefixed shape, which is the safest common denominator.
    const digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('254')) return digits;
    if (digits.startsWith('0')) return '254' + digits.slice(1);
    return '254' + digits;
}

export const maxDuration = 30; // seconds — Vercel's default limit vs real STK response times

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { phone_number, amount, reference, name } = req.body || {};

    if (!phone_number || !amount) {
        return res.status(400).json({ success: false, message: 'Missing phone_number or amount' });
    }

    if (!reference) {
        return res.status(400).json({ success: false, message: 'Missing reference' });
    }

    if (!process.env.SENDIT_API_KEY || !BASE_URL) {
        console.error('Missing SENDIT_API_KEY or SENDIT_BASE_URL environment variable');
        return res.status(500).json({ success: false, message: 'Payment provider not configured' });
    }

    const normalizedPhone = normalizePhoneNumber(phone_number);

    try {
        console.log('Calling Sendit:', `${BASE_URL}/api/v1/stkpush`, 'phone:', normalizedPhone, 'amount:', amount, 'reference:', reference);

        const response = await fetch(`${BASE_URL}/api/v1/stkpush`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SENDIT_API_KEY}`
            },
            body: JSON.stringify({
                phone: normalizedPhone,
                amount: Math.round(Number(amount)),
                account_reference: reference,
                transaction_desc: name ? `Contribution — ${name}` : 'Contribution'
            })
        });

        console.log('Sendit response status:', response.status);

        const raw = await response.text();
        console.log('Sendit response body:', raw);

        let body;
        try {
            body = JSON.parse(raw);
        } catch {
            console.error('Sendit returned non-JSON response:', raw);
            return res.status(502).json({ success: false, message: 'Payment provider returned an unexpected response' });
        }

        // Sendit's success shape is { ResponseCode: "0", CheckoutRequestID, ... };
        // failures are { error: "..." }. CheckoutRequestID presence is the real
        // signal of success, same principle as the transaction_request_id check
        // this replaced.
        if (!response.ok || !body.CheckoutRequestID) {
            console.error('Sendit STK push failed:', body);
            return res.status(502).json({
                success: false,
                message: body.error || 'Could not reach payment provider'
            });
        }

        // The frontend polls on transaction_request_id — map Sendit's
        // CheckoutRequestID onto that same field name so index.html needs no
        // changes at all.
        return res.status(200).json({
            success: true,
            reference,
            transaction_request_id: body.CheckoutRequestID,
            checkout_request_id: body.CheckoutRequestID
        });

    } catch (err) {
        console.error('Sendit request error:', err.name, err.message, err.cause || '');
        return res.status(502).json({ success: false, message: 'Could not reach payment provider' });
    }
}
