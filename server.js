const express      = require('express');
const initSqlJs    = require('sql.js');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const { syncResults } = require('./sync');

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'quiniela-mundial-2026-key';
const API_KEY = process.env.APISPORTS_KEY || '';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'quiniela.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});

let db;

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kitchen TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      registered_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      home_goals INTEGER NOT NULL,
      away_goals INTEGER NOT NULL,
      saved_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, match_id)
    );
    CREATE TABLE IF NOT EXISTS results (
      match_id INTEGER PRIMARY KEY,
      home_goals INTEGER NOT NULL,
      away_goals INTEGER NOT NULL,
      saved_at TEXT DEFAULT (datetime('now')),
      source TEXT DEFAULT 'manual'
    );
  `);

  // seed admin
  const admin = dbGet('SELECT id FROM users WHERE email = ?', ['admin@mundial.com']);
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run('INSERT INTO users (name,kitchen,email,password_hash,is_admin) VALUES (?,?,?,?,1)',
           ['Administrador', 'Dirección', 'admin@mundial.com', hash]);
    saveDb();
    console.log('✓ Admin creado');
  }

  setInterval(saveDb, 30000);
  process.on('SIGINT',  () => { saveDb(); process.exit(); });
  process.on('SIGTERM', () => { saveDb(); process.exit(); });
  console.log(`✓ DB lista: ${DB_FILE}`);

  // ── Auto-sync scheduler ──
  if (API_KEY) {
    console.log('✓ API-Sports key detectada — auto-sync activado');
    // Sync on boot (in case server restarted mid-tournament)
    setTimeout(() => runSync(), 5000);
    // Then every 5 minutes
    setInterval(() => runSync(), 5 * 60 * 1000);
  } else {
    console.log('⚠️  Sin APISPORTS_KEY — resultados solo manuales');
  }
}

async function runSync() {
  // Only sync during World Cup dates (June 11 – July 19 2026)
  const now = new Date();
  const start = new Date('2026-06-11T00:00:00Z');
  const end   = new Date('2026-07-20T00:00:00Z');
  if (now < start || now > end) {
    console.log('⏸  Fuera de fechas del Mundial — sync omitido');
    return;
  }
  const updated = await syncResults(db, dbRun, dbGet, API_KEY);
  if (updated > 0) saveDb();
}

// ── DB helpers ──
function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free(); return null;
}
function dbAll(sql, params = []) {
  const rows = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function dbRun(sql, params = []) {
  db.run(sql, params);
  return db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0];
}

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Sin token' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido' }); }
}
function adminOnly(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Solo admins' });
  next();
}

// ════════════ AUTH ════════════

app.post('/api/register', (req, res) => {
  const { name, kitchen, email, password } = req.body;
  if (!name || !kitchen || !email || !password)
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Contraseña mínimo 4 caracteres.' });
  if (dbGet('SELECT id FROM users WHERE email=?', [email.toLowerCase().trim()]))
    return res.status(409).json({ error: 'Este correo ya está registrado.' });

  const hash = bcrypt.hashSync(password, 10);
  const id   = dbRun('INSERT INTO users (name,kitchen,email,password_hash) VALUES (?,?,?,?)',
                      [name.trim(), kitchen.trim(), email.toLowerCase().trim(), hash]);
  saveDb();
  const user = dbGet('SELECT id,name,kitchen,email,is_admin,registered_at FROM users WHERE id=?', [id]);
  const token = jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin }, SECRET, { expiresIn: '30d' });
  res.json({ token, user });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = dbGet('SELECT * FROM users WHERE email=?', [email?.toLowerCase().trim()]);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  const token = jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, kitchen: user.kitchen, email: user.email, is_admin: user.is_admin } });
});

app.get('/api/me', auth, (req, res) => {
  const user = dbGet('SELECT id,name,kitchen,email,is_admin FROM users WHERE id=?', [req.user.id]);
  res.json(user);
});

// ════════════ PREDICTIONS ════════════

app.get('/api/predictions/me', auth, (req, res) => {
  const rows = dbAll('SELECT match_id,home_goals,away_goals FROM predictions WHERE user_id=?', [req.user.id]);
  const map = {};
  rows.forEach(r => map[r.match_id] = { h: String(r.home_goals), a: String(r.away_goals) });
  res.json(map);
});

app.get('/api/predictions/:userId', auth, (req, res) => {
  const rows = dbAll('SELECT match_id,home_goals,away_goals FROM predictions WHERE user_id=?', [req.params.userId]);
  const map = {};
  rows.forEach(r => map[r.match_id] = { h: String(r.home_goals), a: String(r.away_goals) });
  res.json(map);
});

app.post('/api/predictions/:matchId', auth, (req, res) => {
  const matchId = parseInt(req.params.matchId);
  const { home_goals, away_goals } = req.body;
  if (home_goals === undefined || away_goals === undefined)
    return res.status(400).json({ error: 'Faltan goles.' });
  const existing = dbGet('SELECT id FROM predictions WHERE user_id=? AND match_id=?', [req.user.id, matchId]);
  if (existing) {
    db.run('UPDATE predictions SET home_goals=?,away_goals=?,saved_at=datetime("now") WHERE user_id=? AND match_id=?',
           [parseInt(home_goals), parseInt(away_goals), req.user.id, matchId]);
  } else {
    db.run('INSERT INTO predictions (user_id,match_id,home_goals,away_goals) VALUES (?,?,?,?)',
           [req.user.id, matchId, parseInt(home_goals), parseInt(away_goals)]);
  }
  saveDb();
  res.json({ ok: true });
});

// ════════════ RESULTS ════════════

app.get('/api/results', (req, res) => {
  const rows = dbAll('SELECT match_id,home_goals,away_goals,saved_at,source FROM results');
  const map = {};
  rows.forEach(r => map[r.match_id] = { home: r.home_goals, away: r.away_goals, savedAt: r.saved_at, source: r.source });
  res.json(map);
});

// Manual override (admin)
app.post('/api/results/:matchId', auth, adminOnly, (req, res) => {
  const matchId = parseInt(req.params.matchId);
  const { home_goals, away_goals } = req.body;
  if (home_goals === undefined || away_goals === undefined)
    return res.status(400).json({ error: 'Faltan goles.' });
  const existing = dbGet('SELECT match_id FROM results WHERE match_id=?', [matchId]);
  if (existing) {
    db.run('UPDATE results SET home_goals=?,away_goals=?,saved_at=datetime("now"),source="manual" WHERE match_id=?',
           [parseInt(home_goals), parseInt(away_goals), matchId]);
  } else {
    db.run('INSERT INTO results (match_id,home_goals,away_goals,source) VALUES (?,?,?,"manual")',
           [matchId, parseInt(home_goals), parseInt(away_goals)]);
  }
  saveDb();
  res.json({ ok: true });
});

// Manual sync trigger (admin)
app.post('/api/sync', auth, adminOnly, async (req, res) => {
  if (!API_KEY) return res.status(400).json({ error: 'Sin API key configurada.' });
  const updated = await syncResults(db, dbRun, dbGet, API_KEY);
  if (updated > 0) saveDb();
  res.json({ ok: true, updated });
});

// Sync status
app.get('/api/sync/status', auth, adminOnly, (req, res) => {
  res.json({
    apiKeyConfigured: !!API_KEY,
    autoSyncActive: !!API_KEY,
    nextSyncIn: '≤5 min'
  });
});

// ════════════ LEADERBOARD ════════════

app.get('/api/leaderboard', auth, (req, res) => {
  const users    = dbAll('SELECT id,name,kitchen,email,is_admin,registered_at FROM users');
  const allPreds = dbAll('SELECT user_id,match_id,home_goals,away_goals FROM predictions');
  const results  = dbAll('SELECT match_id,home_goals,away_goals FROM results');
  const PHASES   = getPhases();

  const predsByUser = {};
  allPreds.forEach(p => {
    if (!predsByUser[p.user_id]) predsByUser[p.user_id] = {};
    predsByUser[p.user_id][p.match_id] = { h: p.home_goals, a: p.away_goals };
  });
  const resMap = {};
  results.forEach(r => resMap[r.match_id] = { home: r.home_goals, away: r.away_goals });

  const lb = users.map(u => {
    const preds = predsByUser[u.id] || {};
    let total = 0, predCount = 0;
    Object.entries(PHASES).forEach(([idStr, phase]) => {
      const id = parseInt(idStr);
      const p  = preds[id]; const r = resMap[id];
      if (p !== undefined) predCount++;
      if (p !== undefined && r) total += calcScore(p, r, phase);
    });
    return { ...u, total, predCount };
  }).sort((a, b) => b.total - a.total || new Date(a.registered_at) - new Date(b.registered_at));

  res.json(lb);
});

app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(dbAll('SELECT id,name,kitchen,email,is_admin,registered_at FROM users ORDER BY registered_at'));
});

// ════════════ HELPERS ════════════

function calcScore(pred, result, phase) {
  const ph = parseInt(pred.h), pa = parseInt(pred.a);
  const rh = parseInt(result.home), ra = parseInt(result.away);
  if (isNaN(ph) || isNaN(pa) || isNaN(rh) || isNaN(ra)) return 0;
  const m = phase !== 'Grupos' ? 2 : 1; let pts = 0;
  const pw = ph > pa ? 'H' : ph < pa ? 'A' : 'D';
  const rw = rh > ra ? 'H' : rh < ra ? 'A' : 'D';
  if (pw === rw) pts += 5 * m;
  if (ph === rh) pts += 2 * m;
  if (pa === ra) pts += 2 * m;
  if (ph - pa === rh - ra) pts += 1 * m;
  return pts;
}

function getPhases() {
  const p = {};
  for (let i = 1;  i <= 72;  i++) p[i] = 'Grupos';
  for (let i = 73; i <= 88;  i++) p[i] = '16avos';
  for (let i = 89; i <= 96;  i++) p[i] = 'Octavos';
  for (let i = 97; i <= 100; i++) p[i] = 'Cuartos';
  p[101] = 'Semis'; p[102] = 'Semis';
  p[103] = '3er Puesto'; p[104] = 'Final';
  return p;
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`⚽ Quiniela corriendo en puerto ${PORT}`));
});
