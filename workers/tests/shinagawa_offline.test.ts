
import { strict as assert } from 'assert';
import { checkShinagawaWeeklyAvailability, makeShinagawaReservation, SHINAGAWA_SESSION_EXPIRED } from '../src/scraper/shinagawa';
import { ShinagawaSession, ReservationContext } from '../src/scraper/types';
import * as fixtures from './fixtures';

// --- MOCK TEXTDECODER (Handle Shift-JIS mismatch) ---
// The scraper uses TextDecoder('shift-jis'). Tests use UTF-8 strings.
// We override TextDecoder to always use UTF-8 during tests.
const OriginalDecoder = globalThis.TextDecoder;
globalThis.TextDecoder = class MockTextDecoder implements TextDecoder {
    encoding = 'utf-8';
    fatal = false;
    ignoreBOM = false;
    private decoder: TextDecoder;
    constructor(label?: string, options?: TextDecoderOptions) {
        this.decoder = new OriginalDecoder('utf-8', options);
    }
    decode(input?: BufferSource, options?: TextDecodeOptions): string {
        return this.decoder.decode(input, options);
    }
} as any;

// --- MOCK FETCH ---
const originalFetch = globalThis.fetch;
let mockResponseMap: Record<string, string> = {};

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = input.toString();
    console.log(`[MockFetch] ${urlStr}`);

    // Simple routing based on URL keyword
    let body = '';

    if (urlStr.includes('rsvWOpeInstSrchVacantAction')) {
        // Availability Search
        if (mockResponseMap['AVAILABILITY']) body = mockResponseMap['AVAILABILITY'];
        else body = fixtures.HTML_CALENDAR_OK;
    } else if (urlStr.includes('rsvWOpeReservedApplyAction')) {
        // Application Form
        body = fixtures.HTML_RESERVATION_INPUT;
    } else if (urlStr.includes('rsvWInstUseruleRsvApplyAction')) {
        // Terms of Use
        body = 'OK';
    } else if (urlStr.includes('rsvWOpeReservedConfirmAction')) {
        // Confirmation
        body = fixtures.HTML_CONFIRMATION;
    } else if (urlStr.includes('rsvWOpeReservedCompleteAction')) {
        // Complete
        body = fixtures.HTML_COMPLETE_SUCCESS;
    } else {
        body = '<html>Default Mock</html>';
    }

    // Override if specific mock set
    if (mockResponseMap['NEXT']) {
        body = mockResponseMap['NEXT'];
        // Don't clear immediately if needed for multiple calls, but for now simple
    }

    return new Response(new TextEncoder().encode(body).buffer, { status: 200 });
};

// --- TEST RUNNER ---
async function runTests() {
    console.log('=== Shinagawa Offline Integration Tests ===');

    const mockSession: ShinagawaSession = { cookie: 'JSESSIONID=TEST', displayNo: 'test' };
    const facilityId = 'INST001';

    // TEST 1: Weekly Availability Parsing
    console.log('\n🧪 Test 1: checkShinagawaWeeklyAvailability (Standard HTML)');
    mockResponseMap = {};
    const weekResult = await checkShinagawaWeeklyAvailability(
        facilityId, '2025-12-20', mockSession, undefined, undefined
    );

    assert.equal(weekResult.availability.get('2025-12-20_09:00-11:00'), '○', 'Should find available slot');
    assert.equal(weekResult.availability.get('2025-12-20_11:00-13:00'), '×', 'Should find full slot');
    console.log('✅ Availability parsed correctly');

    // TEST 2: Session Expired
    console.log('\n🧪 Test 2: Session Expired Handling');
    mockResponseMap = { 'AVAILABILITY': fixtures.HTML_ERROR_SESSION };
    try {
        await checkShinagawaWeeklyAvailability(
            facilityId, '2025-12-20', mockSession, undefined, undefined
        );
        assert.fail('Should have thrown error');
    } catch (e: any) {
        assert.equal(e.message, SHINAGAWA_SESSION_EXPIRED);
        console.log('✅ Correctly threw SHINAGAWA_SESSION_EXPIRED');
    }

    // TEST 3: Reservation Flow (Success)
    console.log('\n🧪 Test 3: Reservation Flow (Success)');
    mockResponseMap = {};
    const resResult = await makeShinagawaReservation(
        facilityId, '2025-12-20', '09:00-11:00', mockSession, { applicantCount: 2, executeReservation: true } as any, undefined, false
    );

    assert.equal(resResult.success, true);
    assert.ok(resResult.message.includes('12345678'), 'Should contain reservation number');
    console.log('✅ Reservation flow succeeded with number extraction');

    // TEST 4: Robust Extraction check (Input Reversed / Select Selected)
    // Implicitly tested in Test 3 because HTML_RESERVATION_INPUT contains these cases.
    // verify 'instNo=INST_12345', 'dateNo=DATE_67890', 'timeNo=TIME_002' are used.
    // Since we mock the responses, we assume the scraper *found* the link in HTML_RESERVATION_INPUT
    // If it failed to extract, makeShinagawaReservation would fail at STEP 4 (Confirm).

    // TEST 5: Critical Param Missing
    console.log('\n🧪 Test 5: Parameter Missing Error');
    mockResponseMap = { 'NEXT': fixtures.HTML_ERROR_PARAM_MISSING };
    // Force ApplyAction to return broken HTML

    // We need to trick the router. makeShinagawaReservation calls ApplyAction 2nd.
    // The previous simple mock router is stateless per call logic.
    // Let's customize fetch for this test specifically if needed, or refine the router.

    // Hard override fetch for this test case to return broken HTML on Apply
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const urlStr = input.toString();
        if (urlStr.includes('rsvWOpeReservedApplyAction')) return new Response(fixtures.HTML_ERROR_PARAM_MISSING);
        // ... (minimal others)
        return new Response('');
    };

    const failResult = await makeShinagawaReservation(
        facilityId, '2025-12-20', '09:00-11:00', mockSession, { applicantCount: 2 }
    );

    assert.equal(failResult.success, false);
    assert.ok(failResult.message.includes('SHINAGAWA_PARAM_MISSING'), 'Should detect missing params');
    console.log('✅ Correctly detected missing parameters');

    // Restore
    globalThis.fetch = oldFetch;

    // TEST 6: Safety Guard (Skip)
    console.log('\n🧪 Test 6: Safety Guard (Should Skip)');
    mockResponseMap = {};
    const guardResult = await makeShinagawaReservation(
        facilityId, '2025-12-20', '09:00-11:00', mockSession, { applicantCount: 2, executeReservation: false } as any, undefined, false
    );
    assert.equal(guardResult.success, true);
    assert.ok(guardResult.message.includes('Skipped'), 'Should indicate commit skipped');
    console.log('✅ Safety Guard skipped commit correctly');

    // TEST 7: Safety Guard (Execute)
    console.log('\n🧪 Test 7: Safety Guard (Should Execute)');
    mockResponseMap = {};
    const execResult = await makeShinagawaReservation(
        facilityId, '2025-12-20', '09:00-11:00', mockSession, { applicantCount: 2, executeReservation: true } as any, undefined, false // strict false dryRun
    );
    assert.ok(execResult.message.includes('12345678'), 'Should execute and get number');
    console.log('✅ Safety Guard allowed execution when authorized');
    console.log('\n🎉 All Offline Tests Passed!');
}

runTests().catch(e => {
    console.error('❌ Test Failed:', e);
    process.exit(1);
});
