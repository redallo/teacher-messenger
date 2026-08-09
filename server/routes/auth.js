const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken } = require('../auth-utils');

const router = express.Router();

// ---------- تسجيل دخول موحد: بيكتشف نوع المستخدم تلقائيًا من اليوزر والباسورد ----------
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'اكتب اليوزر وكلمة المرور' });

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (admin && bcrypt.compareSync(password, admin.password_hash)) {
    const token = signToken({ id: admin.id, role: 'admin', username: admin.username });
    return res.json({ token, role: 'admin', name: admin.name });
  }

  const head = db.prepare('SELECT * FROM branch_heads WHERE username = ?').get(username);
  if (head && bcrypt.compareSync(password, head.password_hash)) {
    db.prepare('UPDATE branch_heads SET logged_in = 1 WHERE id = ?').run(head.id);
    const token = signToken({ id: head.id, role: 'branch_head', username: head.username });
    return res.json({ token, role: 'branch_head', name: head.name });
  }

  const teacher = db.prepare('SELECT * FROM teachers WHERE username = ?').get(username);
  if (teacher && bcrypt.compareSync(password, teacher.pin_hash)) {
    db.prepare('UPDATE teachers SET logged_in = 1 WHERE id = ?').run(teacher.id);
    const token = signToken({ id: teacher.id, role: 'teacher', username: teacher.username });
    return res.json({ token, role: 'teacher', name: teacher.name });
  }

  return res.status(401).json({ error: 'اليوزر أو كلمة المرور غلط' });
});

module.exports = router;
