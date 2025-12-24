
// Fix TS issues
declare const process: any;

async function main() {
    console.log('--- Fetch Redirect Diagnostics ---');
    console.log('Node Version:', process.version);

    // Test URL that redirects (google.com -> www.google.com)
    const url = 'http://google.com';

    console.log(`Testing fetch with redirect: 'manual' on ${url}`);

    try {
        const res = await fetch(url, { redirect: 'manual' });
        console.log('Status:', res.status);
        console.log('Type:', res.type);
        console.log('Location Header:', res.headers.get('location'));

        if (res.status >= 300 && res.status < 400) {
            console.log('✅ SUCCESS: Fetch respected "manual" and returned redirect status.');
        } else if (res.status === 200) {
            console.log('❌ FAIL: Fetch followed redirect despite "manual" option.');
        } else if (res.status === 0 && (res.type as string) === 'opaqueredirect') {
            console.log('⚠️ OPAQUE: Fetch returned opaque redirect (Status 0). This is expected for native fetch manual redirect.');
        } else {
            console.log('❓ UNKNOWN behavior.');
        }

    } catch (e: any) {
        console.error('❌ Exception during fetch:', e.message);
    }
}

main();
