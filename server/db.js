const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const sqlite = new DatabaseSync(path.join(__dirname, '..', 'data.sqlite'));
sqlite.exec('PRAGMA journal_mode = WAL;');

// طبقة توافق بسيطة عشان باقي الكود يفضل شغال زي ما هو (نفس أسلوب better-sqlite3)
const db = {
  exec: (sql) => sqlite.exec(sql),
  prepare: (sql) => {
    const stmt = sqlite.prepare(sql);
    return {
      run: (...args) => stmt.run(...args),
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args)
    };
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT,
  logged_in INTEGER DEFAULT 0,
  push_subscription TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_teacher_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admins(id),
  FOREIGN KEY (target_teacher_id) REFERENCES teachers(id)
);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  read_at TEXT,
  PRIMARY KEY (message_id, teacher_id)
);
`);

// إنشاء أول حساب مدير تلقائيًا لو مفيش أي مدير في النظام
// اليوزر: admin | الباسورد: admin123  -- غيّرهم فورًا بعد أول دخول
const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
if (adminCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admins (username, password_hash, name) VALUES (?, ?, ?)')
    .run('admin', hash, 'المدير الرئيسي');
  console.log('✅ تم إنشاء حساب مدير افتراضي -> username: admin | password: admin123 (غيّره فورًا)');
}

module.exports = db;
