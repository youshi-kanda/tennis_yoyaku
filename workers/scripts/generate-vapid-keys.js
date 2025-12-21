const webpush = require('web-push');

const vapidKeys = webpush.generateVAPIDKeys();

console.log('\n=== VAPID Keys Generated ===\n');
console.log('Public Key:');
console.log(vapidKeys.publicKey);
console.log('\nPrivate Key:');
console.log(vapidKeys.privateKey);
console.log('\n=== Add these to wrangler.toml ===\n');
console.log(`VAPID_PUBLIC_KEY = "${vapidKeys.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY = "${vapidKeys.privateKey}"`);
console.log('\n=== Add public key to PWA .env.local ===\n');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log('\n');
