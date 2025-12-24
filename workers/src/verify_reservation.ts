// Fix missing types
declare const process: {
    env: { [key: string]: string | undefined };
    exit: (code?: number) => never;
};

import { loginToShinagawa, checkShinagawaWeeklyAvailability } from './scraper/shinagawa';

async function main() {
    console.log('--- Starting Shinagawa Availability Detection Verification ---');

    const userId = process.env.SHINAGAWA_USER;
    const password = process.env.SHINAGAWA_PASS;

    if (!userId || !password) {
        console.error('Error: Please set SHINAGAWA_USER and SHINAGAWA_PASS environment variables.');
        process.exit(1);
    }

    // 1. Login
    console.log('1. Logging in...');
    const session = await loginToShinagawa(userId, password);

    if (!session) {
        console.error('❌ Login failed or returned null session.');
        process.exit(1);
    }
    console.log('✅ Login Successful');

    // 2. Search for Availability
    const facilityId = '10100010'; // しながわ中央公園 庭球場Ａ
    const targetDate = '2026-01-25'; // As per updated screenshot info

    console.log(`2. Searching for available slots at ${facilityId} on ${targetDate}...`);

    try {
        const weeklyResult = await checkShinagawaWeeklyAvailability(
            facilityId,
            targetDate,
            session,
            undefined,
            undefined
        );

        console.log(`\n--- Availability Results for ${targetDate} ---`);
        let detected = false;

        // Map keys are like "2026-01-25_09:00-11:00"
        for (const [key, status] of weeklyResult.availability.entries()) {
            if (key.includes(targetDate)) {
                console.log(`Slot: ${key} | Status: ${status}`);
                if (status === '○' || status === '取') {
                    console.log(`✅ DETECTED AVAILABLE/CANCELLED SLOT: ${key}`);
                    detected = true;
                }
            }
        }

        if (detected) {
            console.log('\n[SUCCESS] The system successfully detected the available slot!');
            console.log('In a real run, this would trigger the Notification/Reservation flow.');
        } else {
            console.log('\n[WARNING] No available slots detected. Please verify the target date/facility match the current site status.');
        }

    } catch (e: any) {
        console.error('\n❌ Error during Search:', e.message);
        if (e.message.includes('SHINAGAWA_SESSION_EXPIRED') || e.message.includes('password') || e.message.includes('e150990')) {
            console.error('CRITICAL: Password Expiration prevented even the search operation.');
        }
    }
}

main().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
