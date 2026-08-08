const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'change-this-secret-in-env-file';

function signToken(payload) {
  // توكن المدرسين يفضل شغال لمدة سنة (تسجيل دخول مرة واحدة)
  return jwt.sign(payload, SECRET, { expiresIn: '365d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (e) {
    return null;
  }
}

function authMiddleware(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'لازم تسجل دخول' });
    const decoded = verifyToken(token);
    if (!decoded || decoded.role !== role) {
      return res.status(401).json({ error: 'جلسة غير صالحة، سجل دخول تاني' });
    }
    req.user = decoded;
    next();
  };
}

module.exports = { signToken, verifyToken, authMiddleware };
