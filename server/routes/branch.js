const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const webpush = require('../push');
const upload = require('../upload');
const { signToken, authMiddleware } = require('../auth-utils');

const router = express.Router();
const requireBranchHead = authMiddleware('branch_head');

// ---------- تسجيل الدخول ----------
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const head = db.prepare('SELECT * FROM branch_heads WHERE username = ?').get(username);
  if (!head || !bcrypt.compareSync(password || '', head.password_hash)) {
    return res.status(401).json({ error: 'اليوزر أو الباسورد غلط' });
  }
  db.prepare('UPDATE branch_heads SET logged_in = 1 WHERE id = ?').run(head.id);
  const token = signToken({ id: head.id, role: 'branch_head', username: head.username });
  res.json({ token, name: head.name });
});

// ---------- تغيير الباسورد ----------
router.post('/change-password', requireBranchHead, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'املأ كل الحقول' });
  if (new_password.length < 6) return res.status(400).json({ error: 'الباسورد الجديد لازم يكون 6 حروف على الأقل' });

  const head = db.prepare('SELECT * FROM branch_heads WHERE id = ?').get(req.user.id);
  if (!head || !bcrypt.compareSync(current_password, head.password_hash)) {
    return res.status(401).json({ error: 'الباسورد الحالي غلط' });
  }
  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE branch_heads SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);
  res.json({ ok: true });
});

// ---------- حفظ اشتراك الإشعارات ----------
router.post('/subscribe', requireBranchHead, (req, res) => {
  db.prepare('UPDATE branch_heads SET push_subscription = ? WHERE id = ?')
    .run(JSON.stringify(req.body), req.user.id);
  res.json({ ok: true });
});

// ---------- قائمة الفروع/الأقسام (للاستخدام في نموذج الإرسال) ----------
router.get('/departments', requireBranchHead, (req, res) => {
  res.json(db.prepare('SELECT * FROM departments ORDER BY name').all());
});

// ---------- قائمة المدرسين (للاستهداف عند الإرسال) ----------
router.get('/teachers', requireBranchHead, (req, res) => {
  res.json(db.prepare('SELECT id, name, subject FROM teachers ORDER BY name').all());
});

// ---------- إرسال رسالة للمدرسين (فقط - صلاحية محدودة، القسم بيتحدد تلقائيًا من قسم رئيس الفرع) ----------
router.post('/messages', requireBranchHead, upload.single('attachment'), async (req, res) => {
  const { body, target_teacher_id } = req.body;
  if (!body) return res.status(400).json({ error: 'اكتب نص الرسالة' });

  const sender = db.prepare('SELECT * FROM branch_heads WHERE id = ?').get(req.user.id);
  const departmentId = sender ? sender.department_id : null;

  const attachmentPath = req.file ? '/uploads/' + req.file.filename : null;
  const attachmentName = req.file ? req.file.originalname : null;

  const info = db.prepare(`
    INSERT INTO messages
      (admin_id, title, body, target_teacher_id, department_id, attachment_path, attachment_name, sender_role, sender_id, target_audience)
    VALUES (NULL, NULL, ?, ?, ?, ?, ?, 'branch_head', ?, 'teachers')
  `).run(body, target_teacher_id || null, departmentId, attachmentPath, attachmentName, req.user.id);

  const teachers = target_teacher_id
    ? db.prepare('SELECT * FROM teachers WHERE id = ?').all(target_teacher_id)
    : db.prepare('SELECT * FROM teachers').all();

  let sent = 0;
  for (const t of teachers) {
    if (t.push_subscription) {
      try {
        await webpush.sendNotification(JSON.parse(t.push_subscription), JSON.stringify({
          title: (sender && sender.name) ? ('رسالة من ' + sender.name) : 'رسالة جديدة', body, messageId: info.lastInsertRowid
        }));
        sent++;
      } catch (e) { /* تجاهل الاشتراكات المنتهية */ }
    }
  }

  res.json({ ok: true, messageId: info.lastInsertRowid, notified: sent, totalTeachers: teachers.length });
});

// ---------- الرسائل المرسلة من رئيس الفرع نفسه ----------
router.get('/sent-messages', requireBranchHead, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, t.name AS target_name, d.name AS department_name
    FROM messages m
    LEFT JOIN teachers t ON t.id = m.target_teacher_id
    LEFT JOIN departments d ON d.id = m.department_id
    WHERE m.sender_role = 'branch_head' AND m.sender_id = ?
    ORDER BY m.created_at DESC LIMIT 200
  `).all(req.user.id);
  res.json(messages);
});

// ---------- الرسائل الواردة إلى رئيس الفرع (من الإدارة) ----------
router.get('/messages', requireBranchHead, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, d.name AS department_name,
      (SELECT read_at FROM message_reads_v2 WHERE message_id = m.id AND reader_role = 'branch_head' AND reader_id = ?) AS read_at
    FROM messages m
    LEFT JOIN departments d ON d.id = m.department_id
    WHERE m.target_audience = 'branch_heads'
      AND (m.target_branch_head_id IS NULL OR m.target_branch_head_id = ?)
    ORDER BY m.created_at DESC
  `).all(req.user.id, req.user.id);
  res.json(messages);
});

// ---------- تعليم رسالة واردة كمقروءة ----------
router.post('/messages/:id/read', requireBranchHead, (req, res) => {
  db.prepare(`
    INSERT INTO message_reads_v2 (message_id, reader_role, reader_id, read_at)
    VALUES (?, 'branch_head', ?, datetime('now'))
    ON CONFLICT(message_id, reader_role, reader_id) DO UPDATE SET read_at = excluded.read_at
  `).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
