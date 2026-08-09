const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const webpush = require('../push');
const { signToken, authMiddleware } = require('../auth-utils');

const router = express.Router();
const requireAdmin = authMiddleware('admin');

// ---------- تسجيل دخول المدير ----------
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).json({ error: 'يوزر أو باسورد غلط' });
  }
  const token = signToken({ id: admin.id, role: 'admin', username: admin.username });
  res.json({ token, name: admin.name });
});

// ---------- تغيير باسورد المدير الحالي ----------
router.post('/change-password', requireAdmin, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'لازم تكتب الباسورد الحالي والجديد' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'الباسورد الجديد لازم يكون 6 حروف/أرقام على الأقل' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.user.id);
  if (!admin || !bcrypt.compareSync(current_password, admin.password_hash)) {
    return res.status(401).json({ error: 'الباسورد الحالي غلط' });
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);
  res.json({ ok: true });
});

// ---------- إنشاء مدرس جديد (يوزر + بن كود تلقائي) ----------
router.post('/teachers', requireAdmin, (req, res) => {
  const { name, subject, username } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المدرس مطلوب' });

  const finalUsername = (username && username.trim()) ||
    ('t' + Math.floor(1000 + Math.random() * 9000));
  const pin = crypto.randomInt(1000, 9999).toString(); // بن كود 4 أرقام

  const exists = db.prepare('SELECT id FROM teachers WHERE username = ?').get(finalUsername);
  if (exists) return res.status(400).json({ error: 'اليوزر ده مستخدم قبل كده' });

  const pinHash = bcrypt.hashSync(pin, 10);
  const info = db.prepare(
    'INSERT INTO teachers (username, pin_hash, name, subject) VALUES (?, ?, ?, ?)'
  ).run(finalUsername, pinHash, name, subject || null);

  // البن كود بيترجع مرة واحدة بس هنا عشان المدير يديه للمدرس يدويًا
  res.json({ id: info.lastInsertRowid, username: finalUsername, pin, name, subject });
});

// ---------- قائمة المدرسين ----------
router.get('/teachers', requireAdmin, (req, res) => {
  const teachers = db.prepare(
    'SELECT id, username, name, subject, logged_in, created_at FROM teachers ORDER BY created_at DESC'
  ).all();
  res.json(teachers);
});

// ---------- حذف مدرس ----------
router.delete('/teachers/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- إعادة تعيين بن كود مدرس ----------
router.post('/teachers/:id/reset-pin', requireAdmin, (req, res) => {
  const pin = crypto.randomInt(1000, 9999).toString();
  const pinHash = bcrypt.hashSync(pin, 10);
  const result = db.prepare('UPDATE teachers SET pin_hash = ?, logged_in = 0 WHERE id = ?')
    .run(pinHash, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'مدرس غير موجود' });
  res.json({ pin });
});

// ---------- إرسال رسالة (لكل المدرسين أو لمدرس معين) ----------
router.post('/messages', requireAdmin, async (req, res) => {
  const { title, body, target_teacher_id } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'العنوان والنص مطلوبين' });

  const info = db.prepare(
    'INSERT INTO messages (admin_id, title, body, target_teacher_id) VALUES (?, ?, ?, ?)'
  ).run(req.user.id, title, body, target_teacher_id || null);

  const teachers = target_teacher_id
    ? db.prepare('SELECT * FROM teachers WHERE id = ?').all(target_teacher_id)
    : db.prepare('SELECT * FROM teachers').all();

  let sent = 0;
  for (const t of teachers) {
    if (t.push_subscription) {
      try {
        await webpush.sendNotification(JSON.parse(t.push_subscription), JSON.stringify({
          title, body, messageId: info.lastInsertRowid
        }));
        sent++;
      } catch (e) {
        // اشتراك منتهي أو المتصفح ألغاه - تجاهله
      }
    }
  }

  res.json({ ok: true, messageId: info.lastInsertRowid, notified: sent, totalTeachers: teachers.length });
});

// ---------- سجل الرسائل المرسلة ----------
router.get('/messages', requireAdmin, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, t.name AS target_name
    FROM messages m LEFT JOIN teachers t ON t.id = m.target_teacher_id
    ORDER BY m.created_at DESC LIMIT 200
  `).all();
  res.json(messages);
});

module.exports = router;
