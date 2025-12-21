
// Run with: npx tsx manual-verify-minato.ts
require('dotenv').config({ path: '.dev.vars' }); // Load env vars if needed
const { loginToMinato, checkMinatoAvailability } = require('../src/scraper');

async function main() {
    const userId = process.env.MINATO_USER_ID;
    const password = process.env.MINATO_PASSWORD;

    if (!userId || !password) {
        console.error('Please set MINATO_USER_ID and MINATO_PASSWORD in .dev.vars or environment');
        process.exit(1);
    }

    console.log('Logging in to Minato...');
    const sessionId = await loginToMinato(userId, password);

    if (!sessionId) {
        console.error('Login failed');
        return;
    }
    console.log('Logged in, Session ID:', sessionId);

    const facilityId = '5001'; // 芝浦中央公園運動場 テニスコートA
    const date = '2026-01-06';

    console.log(`Checking availability for Facility ${facilityId} on ${date}...`);

    // Check 12:00 (Green in screenshot)
    try {
        const result12 = await checkMinatoAvailability(facilityId, date, '12:00', sessionId);
        console.log('12:00 Result:', result12);
    } catch (e) { console.error('Error checking 12:00', e); }

    // Check 13:00 (X in screenshot, requested by user)
    try {
        const result13 = await checkMinatoAvailability(facilityId, date, '13:00', sessionId);
        console.log('13:00 Result:', result13);
    } catch (e) { console.error('Error checking 13:00', e); }

}

// Mock fetch if needed (but tsx global fetch might work if node 18+)
// If running in node environment without fetch:
if (!globalThis.fetch) {
    console.log('Polyfilling fetch...');
    // You might need 'node-fetch' if strictly old node, but usually tsx/node 20 has it.
}

main().catch(console.error);
