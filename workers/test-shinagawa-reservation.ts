import fs from 'fs';
import path from 'path';
import { loginToShinagawa, makeShinagawaReservation, getShinagawaFacilities, checkShinagawaWeeklyAvailability } from './src/scraper/shinagawa';
import { ShinagawaSession, Facility } from './src/scraper/types';

// Simple .dev.vars parser
function loadDevVars() {
    try {
        const devVarsPath = path.resolve(__dirname, '.dev.vars');
        if (fs.existsSync(devVarsPath)) {
            const content = fs.readFileSync(devVarsPath, 'utf-8');
            content.split('\n').forEach(line => {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    const key = match[1].trim();
                    let value = match[2].trim();
                    // Remove quotes if present
                    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.slice(1, -1);
                    }
                    process.env[key] = value;
                }
            });
            console.log('✅ Loaded environment from .dev.vars');
        } else {
            console.warn('⚠️ .dev.vars not found. Please set SHINAGAWA_USER and SHINAGAWA_PASS manually.');
        }
    } catch (e) {
        console.error('Error loading .dev.vars:', e);
    }
}

// Mock KVNamespace for getShinagawaFacilities
const mockKV = {
    get: async () => null,
    put: async () => { },
    delete: async () => { },
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
    getWithMetadata: async () => ({ value: null, metadata: null }),
} as any;

async function main() {
    loadDevVars();

    const username = process.env.SHINAGAWA_USER;
    const password = process.env.SHINAGAWA_PASS;

    if (!username || !password) {
        console.error('❌ Error: SHINAGAWA_USER and SHINAGAWA_PASS are required.');
        process.exit(1);
    }

    console.log(`\n🚀 Starting Shinagawa Verification for user: ${username}`);

    try {
        // 1. Login
        console.log('\n🔐 Step 1: Logging in...');
        const session = await loginToShinagawa(username, password);
        if (!session) {
            console.error('❌ Login Failed.');
            return;
        }
        console.log('✅ Login Success!');

        // 2. Get Facilities (Tennis Courts)
        console.log('\n📋 Step 2: Fetching Facilities...');
        const facilities = await getShinagawaFacilities({ username, password }, mockKV);
        const tennisCourts = facilities.filter(f => f.isTennisCourt);
        console.log(`✅ Found ${tennisCourts.length} tennis courts.`);

        // 3. Find Available Slot
        console.log('\n🔍 Step 3: Searching for ANY available slot (checking upcoming week)...');

        let targetSlot: { facility: Facility, date: string, timeSlot: string, context?: any } | null = null;

        // Calculate next Monday for weekly check
        const today = new Date();
        const nextMonday = new Date(today);
        nextMonday.setDate(today.getDate() + (8 - today.getDay())); // Next Monday
        const weekStart = nextMonday.toISOString().split('T')[0];

        // Check up to 5 random facilities to save time, or check popular ones
        const courtsToCheck = tennisCourts.slice(0, 10); // Check first 10 courts (likely Shinagawa Kumin Park etc.)

        for (const court of courtsToCheck) {
            console.log(`Checking ${court.facilityName} for week of ${weekStart}...`);
            const weeklyResult = await checkShinagawaWeeklyAvailability(
                court.facilityId,
                weekStart,
                session,
                court
            );

            // Find first '○'
            for (const [key, status] of weeklyResult.availability.entries()) {
                if (status === '○') {
                    const [date, time] = key.split('_');
                    console.log(`\n🎉 Found available slot!`);
                    console.log(`   Facility: ${court.facilityName}`);
                    console.log(`   Date: ${date}`);
                    console.log(`   Time: ${time}`);

                    targetSlot = {
                        facility: court,
                        date,
                        timeSlot: time,
                        context: weeklyResult.reservationContext
                    };
                    break;
                }
            }
            if (targetSlot) break;
        }

        if (!targetSlot) {
            console.log('\n⚠️ No available slots found in the checked facilities/range.');
            console.log('To verify reservation logic, checking a FULL slot to see rejection (or use a different date).');
            // Fallback: Pick a random full slot to test the failure path (or confirm screen rejection)
            targetSlot = {
                facility: tennisCourts[0],
                date: weekStart, // Monday
                timeSlot: '09:00-11:00',
                context: undefined // Weekly context might not be valid for this unless we fetched it
            };
            console.log(`⚠️ Testing with potentially FULL slot: ${targetSlot.facility.facilityName} on ${targetSlot.date} ${targetSlot.timeSlot}`);
        }

        // 4. Execute DryRun Reservation
        console.log('\n🛑 Step 4: Executing DryRun Reservation...');
        const result = await makeShinagawaReservation(
            targetSlot.facility.facilityId,
            targetSlot.date,
            targetSlot.timeSlot,
            session,
            { applicantCount: 2 },
            targetSlot.context,
            true // dryRun = true
        );

        console.log('\n--- Reservation Result ---');
        if (result.success) {
            console.log('✅ SUCCESS:', result.message);
        } else {
            console.log('❌ FAILED:', result.message);
        }

    } catch (error: any) {
        console.error('❌ Unexpected Error:', error);
    }
}

main();
