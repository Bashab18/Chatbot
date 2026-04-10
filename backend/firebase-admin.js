const admin = require("firebase-admin");

let _db = null;

function initFirebase() {
  if (admin.apps.length) return;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn(
      "FIREBASE_SERVICE_ACCOUNT not set – auth and Firestore features disabled"
    );
    return;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    _db = admin.firestore();
    console.log("Firebase Admin initialized");
  } catch (err) {
    console.error("Firebase Admin init error:", err.message);
  }
}

function getDb() {
  return _db;
}

// Middleware: verify Firebase ID token
async function requireAuth(req, res, next) {
  if (!admin.apps.length) return res.status(503).json({ error: "Auth not configured" });

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Middleware: verify admin role (checks Firestore users doc)
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    try {
      const snap = await _db.collection("users").doc(req.user.uid).get();
      if (!snap.exists || snap.data().role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: "Failed to verify role" });
    }
  });
}

module.exports = { initFirebase, getDb, requireAuth, requireAdmin };
