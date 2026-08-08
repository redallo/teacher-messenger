const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authMiddleware } = require('../auth-utils');

const router = express.Router();
const requireTeacher = authMiddleware('teacher');

// ---------- تسجيل الدخول (مرة واحدة باليوزر والبن كود) ----------
router.post('/login', (req, res) => {
  const { username, pin } = req.body;
  const teacher = db.prepare('SELECT * FROM teachers WHERE username = ?').get(username);
  if (!teacher || !bcrypt.compareSync(pin || '', teacher.pin_hash)) {
    return res.status(401).json({ error: 'اليوزر أو البن كود غلط' });
  }
  db.prepare('UPDATE teachers SET logged_in = 1 WHERE id = ?').run(teacher.id);
  const token = signToken({ id: teacher.id, role: 'teacher', username: teacher.username });
  res.json({ token, name: teacher.name });
});

// ---------- حفظ اشتراك الإشعارات (Push Subscription) ----------
router.post('/subscribe', requireTeacher, (req, res) => {
  const subscription = req.body;
  db.prepare('UPDATE teachers SET push_subscription = ? WHERE id = ?')
    .run(JSON.stringify(subscription), req.user.id);
  res.json({ ok: true });
});

// ---------- عرض الرسائل الخاصة بالمدرس ----------
router.get('/messages', requireTeacher, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, r.read_at
    FROM messages m
    LEFT JOIN message_reads r ON r.message_id = m.id AND r.teacher_id = ?
    WHERE m.target_teacher_id IS NULL OR m.target_teacher_id = ?
    ORDER BY m.created_at DESC
  `).all(req.user.id, req.user.id);
  res.json(messages);
});

// ---------- تعليم رسالة كمقروءة ----------
router.post('/messages/:id/read', requireTeacher, (req, res) => {
  db.prepare(`
    INSERT INTO message_reads (message_id, teacher_id, read_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(message_id, teacher_id) DO UPDATE SET read_at = excluded.read_at
  `).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
