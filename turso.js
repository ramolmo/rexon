/**
 * REXON — Secure Turso proxy (Vercel Serverless Function)
 * ---------------------------------------------------------
 * The browser NEVER talks to Turso directly anymore. All database queries
 * go through this endpoint, and the TURSO_TOKEN lives ONLY in the
 * server environment (Vercel Dashboard -> Project Settings -> Environment
 * Variables). It is never shipped to browsers, so it cannot be stolen
 * from "View Source".
 *
 * Required env vars (Vercel dashboard):
 *   TURSO_URL    e.g. https://datafow-ramolmoaran.aws-ap-south-1.turso.io
 *   TURSO_TOKEN  a database token from the Turso dashboard
 *
 * POST /api/turso  with JSON body: { "sql": "SELECT ...", "args": [...] }
 * Responds with the raw Turso /v2/pipeline JSON so the existing
 * client-side result parsing keeps working unchanged.
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
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed. Use POST.' });
        return;
    }

    const TURSO_URL = process.env.TURSO_URL;
    const TURSO_TOKEN = process.env.TURSO_TOKEN;

    if (!TURSO_URL || !TURSO_TOKEN) {
        res.status(500).json({
            error: 'Turso is not configured on the server. Ask the admin to set TURSO_URL and TURSO_TOKEN in the Vercel project Environment Variables and redeploy.'
        });
        return;
    }

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
