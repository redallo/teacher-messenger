const webpush = require('web-push');
require('dotenv').config();

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;

if (!publicKey || !privateKey) {
  console.warn('⚠️  لسه ما ولّدتش مفاتيح VAPID. شغّل: npm run generate-vapid وحطهم في .env');
} else {
  webpush.setVapidDetails(
    process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com',
    publicKey,
    privateKey
  );
}

module.exports = webpush;
