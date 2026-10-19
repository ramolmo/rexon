/**
 * REXON — Secure Turso proxy (Vercel Serverless Function)
 * With Cross-Origin Resource Sharing (CORS) for GitHub Pages & Custom Domains
 */

function mapArg(arg) {
    if (arg === null || arg === undefined) return { type: 'null' };
    if (typeof arg === 'number') {
        if (Number.isInteger(arg)) return { type: 'integer', value: String(arg) };
        return { type: 'float', value: arg };
    }
    if (typeof arg === 'boolean') return { type: 'integer', value: arg ? '1' : '0' };
    return { type: 'text', value: String(arg) };
}

module.exports = async (req, res) => {
    // Enable CORS for GitHub Pages and any frontend domain
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed. Use POST.' });
        return;
    }

    const fallback_url = 'https://datafow-ramolmoaran.aws-ap-south-1.turso.io';
    const fallback_token = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiI5Mjc5ZWNlZS0wNDg2LTQ4ODktYjQwOS0yYTE4NTFlZjQ1MGQiLCJpYXQiOjE3OTE4NTk3MjAsImtpZCI6Il9KT29GcGFpdkw0ZGNXelY0NlkzemlYMjJwdWJCSWl5VXl5NndRN1N1TVEiLCJyaWQiOiI1YjRkNjY4Ni03ZjczLTRiMWUtYjRlMC05MDFkNTkxZDJmYWEifQ.VVIPLYrvisMV5HrzcWNXQWL3PVXSCDkv1hDl4KrJ5FYWXtD1O1Hd_a09jU8T_nadn9CIk5EDrxUvwDTkCka2CQ';

    const TURSO_URL = process.env.TURSO_URL || fallback_url;
    const TURSO_TOKEN = process.env.TURSO_TOKEN || fallback_token;

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    const sql = body.sql;
    if (!sql || typeof sql !== 'string') {
        res.status(400).json({ error: 'Missing "sql" string in request body.' });
        return;
    }

    const stmt = { sql };
    if (Array.isArray(body.args) && body.args.length > 0) {
        stmt.args = body.args.map(mapArg);
    }

    const cleanUrl = String(TURSO_URL).replace(/\/$/, '');

    try {
        const upstream = await fetch(`${cleanUrl}/v2/pipeline`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TURSO_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                requests: [
                    { type: 'execute', stmt },
                    { type: 'close' }
                ]
            })
        });

        const text = await upstream.text();
        res.status(upstream.status);
        res.setHeader('Content-Type', 'application/json');
        res.send(text);
    } catch (err) {
        res.status(502).json({ error: 'Could not reach the Turso database: ' + (err && err.message ? err.message : 'unknown error') });
    }
};
