const jwt     = require("jsonwebtoken");
const bcrypt  = require("bcryptjs");

const SECRET = process.env.JWT_SECRET || "chatbot-dev-secret-change-in-prod";

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function checkPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, role: user.role, name: user.name },
    SECRET,
    { expiresIn: "7d" }
  );
}

// Middleware: verify JWT, attach req.user = { uid, email, role, name }
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    console.log(`[auth] token rejected for ${req.method} ${req.path}: ${e.message}`);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Middleware: verify JWT + admin role
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  });
}

module.exports = { hashPassword, checkPassword, signToken, requireAuth, requireAdmin };
