/**
 * Vercel Serverless Function
 * GET /api/payment-status?transaction_request_id=XXXXXXXX
 *
 * Polled by the frontend every few seconds after initiating a payment.
 *
 * Same architecture as the Paywave Express integration this replaced:
 * this calls Sendit's own GET /api/v1/status endpoint directly on every
 * poll, rather than relying on a webhook having already updated a local
 * store. Two reasons this is still the safer design here:
 *
 *   1. If camp were to register its own URL as a Sendit developer webhook,
 *      that webhook has no documented signature verification either — same
 *      "anyone who finds the URL could fake it" problem Paywave Express
 *      had. Querying Sendit directly, authenticated with our own API key,
 *      has no such hole. (Sendit's *real* Safaricom callback is verified
 *      and trusted, but it terminates at Sendit itself, not at camp.)
 *   2. It sidesteps the in-memory-store cross-function reliability problem
 *      entirely for the thing that matters most (final success/failure).
 */

const BASE_URL = process.env.SENDIT_BASE_URL;

function mapStatus(senditStatus) {
    // Sendit returns lowercase 'success' | 'failed' | 'pending' — different
    // vocabulary from Paywave Express's 'completed'/'cancelled', but the
    // three-state shape is the same.
    switch (String(senditStatus || '').toLowerCase()) {
        case 'success':
            return 'SUCCESS';
        case 'failed':
            return 'FAILED';
        case 'pending':
        default:
            return 'PENDING';
    }
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
    }

    const { transaction_request_id } = req.query;

    if (!transaction_request_id) {
        return res.status(400).json({ status: 'ERROR', message: 'Missing transaction_request_id' });
    }

    if (!process.env.SENDIT_API_KEY || !BASE_URL) {
        console.error('Missing SENDIT_API_KEY or SENDIT_BASE_URL environment variable');
        return res.status(500).json({ status: 'ERROR', message: 'Payment provider not configured' });
    }

    try {
        const response = await fetch(
            `${BASE_URL}/api/v1/status?checkout_request_id=${encodeURIComponent(transaction_request_id)}`,
            {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${process.env.SENDIT_API_KEY}` }
            }
        );

        const raw = await response.text();
        console.log('Sendit status raw response:', raw);
        let body;
        try {
            body = JSON.parse(raw);
        } catch {
            console.error('Sendit status returned non-JSON response:', raw);
            // Report PENDING rather than FAILED on a parse hiccup — a
            // transient/malformed response here shouldn't be mistaken for
            // an actual payment failure. The frontend will just poll again.
            return res.status(200).json({ status: 'PENDING' });
        }

        if (!response.ok) {
            // Includes the 404 "transaction not found" case, which can happen
            // briefly right after initiate-payment if there's any replication
            // lag on Sendit's side — treat the same as a transient PENDING
            // rather than surfacing it as a failure.
            console.error('Sendit status call failed:', body);
            return res.status(200).json({ status: 'PENDING' });
        }

        return res.status(200).json({
            status: mapStatus(body.status),
            receipt: body.receipt,
            amount: body.amount
        });

    } catch (err) {
        console.error('Sendit status request error:', err);
        // Network hiccup talking to the provider — report PENDING so the
        // frontend keeps polling rather than giving up on a transient blip.
        return res.status(200).json({ status: 'PENDING' });
    }
}
