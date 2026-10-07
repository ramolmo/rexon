/**
 * Unified Test Runner for REXON Business OS Ecosystem
 */
const { testTelegramAuth } = require('./test_telegram_auth.js');
const { testFinanceSafety } = require('./test_finance_deterministic.js');
const { testApiEndpoints } = require('./test_api_endpoints.js');

console.log('====================================================');
console.log('🧪 RUNNING REXON ECOSYSTEM AUTOMATED TEST SUITE');
console.log('====================================================\n');

try {
    testTelegramAuth();
    testFinanceSafety();
    testApiEndpoints();
} catch (err) {
    console.error('❌ Test failure encountered:', err);
    process.exit(1);
}
