require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const adminRoutes = require('./routes/admin');
const teacherRoutes = require('./routes/teacher');
const branchRoutes = require('./routes/branch');
const authRoutes = require('./routes/auth');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// المفتاح العام لازم يكون متاح للفرونت إند عشان يعمل subscribe للإشعارات
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

app.use('/api/admin', adminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/branch', branchRoutes);
app.use('/api', authRoutes);

// تقديم الواجهة (PWA) كملفات ثابتة
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 السيرفر شغال على http://localhost:${PORT}`);
  console.log(`   الرابط الموحد (كل المستخدمين): http://localhost:${PORT}/`);
});
