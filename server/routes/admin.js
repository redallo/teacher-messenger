const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const webpush = require('../push');
const upload = require('../upload');
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

// ---------- الفروع/الأقسام: عرض الكل ----------
router.get('/departments', requireAdmin, (req, res) => {
  const departments = db.prepare('SELECT * FROM departments ORDER BY name').all();
  res.json(departments);
});

// ---------- الفروع/الأقسام: إضافة جديد ----------
router.post('/departments', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'اكتب اسم الفرع/القسم' });
  try {
    const info = db.prepare('INSERT INTO departments (name) VALUES (?)').run(name.trim());
    res.json({ id: info.lastInsertRowid, name: name.trim() });
  } catch (e) {
    res.status(400).json({ error: 'الاسم ده موجود بالفعل' });
  }
});

// ---------- الفروع/الأقسام: حذف ----------
router.delete('/departments/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- رؤساء الفروع/الأقسام: إنشاء ----------
router.post('/branch-heads', requireAdmin, (req, res) => {
  const { name, department_id, username } = req.body;
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });

  const finalUsername = (username && username.trim()) || ('b' + Math.floor(1000 + Math.random() * 9000));
  const password = crypto.randomBytes(4).toString('hex'); // باسورد عشوائي 8 حروف

  const exists = db.prepare('SELECT id FROM branch_heads WHERE username = ?').get(finalUsername);
  if (exists) return res.status(400).json({ error: 'اليوزر ده مستخدم قبل كده' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO branch_heads (username, password_hash, name, department_id) VALUES (?, ?, ?, ?)'
  ).run(finalUsername, passwordHash, name, department_id || null);

  res.json({ id: info.lastInsertRowid, username: finalUsername, password, name });
});

// ---------- رؤساء الفروع/الأقسام: قائمة ----------
router.get('/branch-heads', requireAdmin, (req, res) => {
  const heads = db.prepare(`
    SELECT bh.id, bh.username, bh.name, bh.logged_in, bh.created_at, d.name AS department_name, bh.department_id
    FROM branch_heads bh LEFT JOIN departments d ON d.id = bh.department_id
    ORDER BY bh.created_at DESC
  `).all();
  res.json(heads);
});

// ---------- رؤساء الفروع/الأقسام: حذف ----------
router.delete('/branch-heads/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM branch_heads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- رؤساء الفروع/الأقسام: إعادة تعيين الباسورد ----------
router.post('/branch-heads/:id/reset-password', requireAdmin, (req, res) => {
  const password = crypto.randomBytes(4).toString('hex');
  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db.prepare('UPDATE branch_heads SET password_hash = ?, logged_in = 0 WHERE id = ?')
    .run(passwordHash, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'غير موجود' });
  res.json({ password });
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

// ---------- إرسال رسالة (لكل المدرسين، لمدرس معين، لكل رؤساء الفروع، أو لرئيس فرع معين) ----------
router.post('/messages', requireAdmin, upload.single('attachment'), async (req, res) => {
  const { title, body, target_teacher_id, department_id, target_audience, target_branch_head_id } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'العنوان والنص مطلوبين' });

  const audience = target_audience === 'branch_heads' ? 'branch_heads' : 'teachers';
  const attachmentPath = req.file ? '/uploads/' + req.file.filename : null;
  const attachmentName = req.file ? req.file.originalname : null;

  const info = db.prepare(`
    INSERT INTO messages
      (admin_id, title, body, target_teacher_id, department_id, attachment_path, attachment_name, sender_role, sender_id, target_audience, target_branch_head_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?)
  `).run(
    req.user.id, title, body,
    audience === 'teachers' ? (target_teacher_id || null) : null,
    department_id || null,
    attachmentPath, attachmentName,
    req.user.id, audience,
    audience === 'branch_heads' ? (target_branch_head_id || null) : null
  );

  let recipients = [];
  if (audience === 'teachers') {
    recipients = target_teacher_id
      ? db.prepare('SELECT * FROM teachers WHERE id = ?').all(target_teacher_id)
      : db.prepare('SELECT * FROM teachers').all();
  } else {
    recipients = target_branch_head_id
      ? db.prepare('SELECT * FROM branch_heads WHERE id = ?').all(target_branch_head_id)
      : db.prepare('SELECT * FROM branch_heads').all();
  }

  let sent = 0;
  for (const r of recipients) {
    if (r.push_subscription) {
      try {
        await webpush.sendNotification(JSON.parse(r.push_subscription), JSON.stringify({
          title, body, messageId: info.lastInsertRowid
        }));
        sent++;
      } catch (e) {
        // اشتراك منتهي أو المتصفح ألغاه - تجاهله
      }
    }
  }

  res.json({ ok: true, messageId: info.lastInsertRowid, notified: sent, totalRecipients: recipients.length });
});

// ---------- سجل الرسائل المرسلة ----------
router.get('/messages', requireAdmin, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, t.name AS target_name, bh.name AS target_branch_head_name, d.name AS department_name
    FROM messages m
    LEFT JOIN teachers t ON t.id = m.target_teacher_id
    LEFT JOIN branch_heads bh ON bh.id = m.target_branch_head_id
    LEFT JOIN departments d ON d.id = m.department_id
    ORDER BY m.created_at DESC LIMIT 200
  `).all();
  res.json(messages);
});

module.exports = router;
