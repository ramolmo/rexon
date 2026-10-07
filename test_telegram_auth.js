/**
 * Test Suite: Telegram Mini App (TMA) HMAC-SHA256 Cryptographic Verification
 */
const assert = require('assert');
const crypto = require('crypto');
const { verifyTelegramWebAppData } = require('../server.js');

function testTelegramAuth() {
    console.log('[TEST] Testing Telegram WebApp HMAC-SHA256 Cryptographic Verification...');

    const mockBotToken = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ-01234567';

    // 1. Construct valid mock initData
    const userPayload = JSON.stringify({
        id: 88776655,
        first_name: 'Tareq',
        last_name: 'Hasan',
        username: 'tareq_worker',
        language_code: 'en'
    });

    const params = [
        ['auth_date', '1790970000'],
        ['query_id', 'AAHdF60uAAAAAN0XrS4pZ5qG'],
        ['user', userPayload]
    ];

    params.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = params.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(mockBotToken).digest();
    const correctHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const validInitData = `${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}&hash=${correctHash}`;

    // Test Valid Signature
    const validResult = verifyTelegramWebAppData(validInitData, mockBotToken);
    assert.strictEqual(validResult.valid, true, 'Valid initData must return valid: true');
    assert.strictEqual(validResult.user.id, 88776655, 'User ID must match extracted data');
    assert.strictEqual(validResult.user.username, 'tareq_worker', 'Username must match extracted data');
    console.log('  ✓ Valid Telegram WebApp initData verified successfully');

    // Test Invalid/Tampered Signature
    const tamperedInitData = validInitData.replace(correctHash, '0000000000000000000000000000000000000000000000000000000000000000');
    const invalidResult = verifyTelegramWebAppData(tamperedInitData, mockBotToken);
    assert.strictEqual(invalidResult.valid, false, 'Tampered initData must be rejected');
    console.log('  ✓ Tampered signature rejected successfully (Security Gatekeeper enforced)');

    console.log('✅ Telegram Mini App Authentication tests passed!\n');
}

if (require.main === module) {
    testTelegramAuth();
}

module.exports = { testTelegramAuth };
