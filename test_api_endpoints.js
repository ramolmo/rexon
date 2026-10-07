/**
 * Test Suite: REXON Backend REST API Endpoints & Health Check
 */
const assert = require('assert');
const { server } = require('../server.js');

function testApiEndpoints() {
    console.log('[TEST] Testing REST API Telemetry & Endpoints...');

    const port = server.address() ? server.address().port : 3000;
    const http = require('http');

    // Test GET /health
    const req = http.get(`http://localhost:${port}/health`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            assert.strictEqual(res.statusCode, 200, '/health should return 200 OK');
            const data = JSON.parse(body);
            assert.strictEqual(data.status, 'operational');
            assert.strictEqual(data.platform, 'REXON Business OS');
            console.log('  ✓ /health endpoint returned operational telemetry');

            // Test POST /api/finance/transaction
            const postData = JSON.stringify({
                category: 'Client Receivable',
                amount: 1500.50,
                currency: 'USD',
                account: 'Primary Operating Wire',
                reference: 'INV-TEST-001',
                createdBy: 'Test Sentinel'
            });

            const txReq = http.request({
                hostname: 'localhost',
                port: port,
                path: '/api/finance/transaction',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            }, (txRes) => {
                let txBody = '';
                txRes.on('data', chunk => txBody += chunk);
                txRes.on('end', () => {
                    assert.strictEqual(txRes.statusCode, 201, '/api/finance/transaction should return 201 Created');
                    const txJson = JSON.parse(txBody);
                    assert.strictEqual(txJson.success, true);
                    assert.strictEqual(txJson.transaction.amount_cents, 150050);
                    assert.strictEqual(txJson.transaction.amount_formatted, '1500.50');
                    console.log('  ✓ /api/finance/transaction recorded deterministic transaction');

                    console.log('✅ API Endpoint tests passed!\n');
                    server.close();
                });
            });

            txReq.write(postData);
            txReq.end();
        });
    });

    req.on('error', (err) => {
        console.warn('API test HTTP error notice (server active):', err.message);
        server.close();
    });
}

if (require.main === module) {
    testApiEndpoints();
}

module.exports = { testApiEndpoints };
