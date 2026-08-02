/**
 * Vercel Serverless Function
 * POST /api/sendit-callback
 *
 * OPTIONAL. Sendit's real, verified Safaricom callback URL points back at
 * Sendit itself (it registers its own /api/v1/callback/[accountId] with
 * Safaricom) — so unlike Paywave Express, camp does NOT need this file for
 * the core payment flow to work. api/payment-status.js polling Sendit's
 * /api/v1/status directly is the trusted path, same as it was for Paywave.
 *
 * This file only matters if you separately register this URL as a Sendit
 * *developer* webhook (Dashboard -> Webhooks). If you do that: Sendit's
 * webhook delivery has no documented signature/HMAC verification either,
 * same situation Paywave Express was in — so, same rule as before, this
 * handler deliberately does NOT update any payment status based on what
 * it receives. It only logs, for visibility/debugging alongside the
 * polling path.
 *
 * If Sendit later adds webhook signing, this is the file to update —
 * verify first, then it would be safe to let this also update a store
 * directly rather than just logging.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ status: 'received' });
    }
    console.log('Sendit webhook received (UNVERIFIED — logged only, not trusted):', JSON.stringify(req.body, null, 2));
    // Deliberately no status update here — see the note above.
    res.status(200).json({ status: 'received' });
}
