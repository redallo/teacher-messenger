// يولّد مفاتيح VAPID اللازمة لإرسال إشعارات الدفع (Push Notifications)
// شغّله مرة واحدة فقط: npm run generate-vapid
// وبعدين انسخ الناتج في ملف .env

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();

console.log('\n===== انسخ السطرين دول في ملف .env =====\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\n=========================================\n');
