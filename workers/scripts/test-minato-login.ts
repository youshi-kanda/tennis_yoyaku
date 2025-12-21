import { loginToMinato, checkMinatoWeeklyAvailability } from '../src/scraper';

async function main() {
    const username = process.env.MINATO_USER;
    const password = process.env.MINATO_PASS;

    if (!username || !password) {
        console.error('Error: MINATO_USER and MINATO_PASS environment variables are required.');
        process.exit(1);
    }

    console.log(`Testing Minato Login for user: ${username}`);

    try {
        // 1. Login
        console.log('\n--- Step 1: Login ---');
        const cookie = await loginToMinato(username, password);

        if (!cookie) {
            console.error('Login Failed: Returned null cookie');
            return;
        }
        console.log('Login Success! Cookie:', cookie.substring(0, 20) + '...');

        // 2. Weekly Availability Check
        console.log('\n--- Step 2: Weekly Availability Check ---');
        // Monday of next week
        const today = new Date();
        const nextMonday = new Date(today);
        nextMonday.setDate(today.getDate() + (8 - today.getDay()));
        const dateStr = nextMonday.toISOString().split('T')[0];

        console.log(`Checking week starting: ${dateStr}`);

        // We need a facility ID. Using a known Minato facility ID (e.g. Shiba Park) or placeholder
        // If we don't know one, we can try to fetch facilities first if scraper has that function
        // But getMinatoFacilities also needs a session usually? 
        // Wait, getMinatoFacilities(cookie) exists.

        const { getMinatoFacilities } = require('../src/scraper');
        console.log('\n--- Step 2.5: Get Facilities ---');
        // Mock Env for monitoring KV if needed, but getMinatoFacilities signature is:
        // (cookie: string, monitoringNamespace: any, userId: string)
        // We can pass null/undefined for namespace if it just reads?
        // Actually getMinatoFacilities tries to CACHE to KV. So passing null will crash if it tries `put`.
        // Let's check getMinatoFacilities implementation.
        // If it crashes, we'll skip.

        // Let's just try checkMinatoWeeklyAvailability directly with a dummy ID
        // Shiba Park Tennis Court ID: '1113' (Example, need to verify or use variable)
        const TEST_FACILITY_ID = process.env.FACILITY_ID || '1113';

        console.log(`Checking availability for facility ${TEST_FACILITY_ID}...`);

        const result = await checkMinatoWeeklyAvailability(
            TEST_FACILITY_ID,
            dateStr,
            cookie
            // facilityInfo is optional
        );

        if (result) {
            console.log('Weekly check result:', result);
            console.log(`Found ${result.availability.size} slots.`);
        }

    } catch (error) {
        console.error('An error occurred:', error);
    }
}

main();
