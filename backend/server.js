// backend/server.js

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 環境変数
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

// PostgreSQL 接続
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ミドルウェア
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '../public')));

// -------------------------------------------
// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// -------------------------------------------
// トークン認証
const generateToken = () => crypto.randomBytes(16).toString('hex');

const authMiddleware = async (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });
  const user = await pool.query('SELECT * FROM users WHERE token=$1', [token]);
  if (!user.rows[0]) return res.status(401).json({ success: false, message: 'Invalid token' });
  req.user = user.rows[0];
  next();
};

// -------------------------------------------
// トップページ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// -------------------------------------------
// ユーザー登録
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: 'Missing fields' });

  const hashed = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      'INSERT INTO users(username, password) VALUES($1,$2) RETURNING id',
      [username, hashed]
    );
    res.json({ success: true, userId: result.rows[0].id });
  } catch (e) {
    res.json({ success: false, message: 'Username taken' });
  }
});

// -------------------------------------------
// ログイン
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  if (!result.rows[0]) return res.json({ success: false, message: 'User not found' });

  const match = await bcrypt.compare(password, result.rows[0].password);
  if (!match) return res.json({ success: false, message: 'Wrong password' });

  const token = generateToken();
  await pool.query('UPDATE users SET token=$1 WHERE id=$2', [token, result.rows[0].id]);

  res.json({ success: true, token, userId: result.rows[0].id });
});

// -------------------------------------------
// メッセージ送信
app.post('/api/message', authMiddleware, upload.single('file'), async (req, res) => {
  const text = req.body.text || '';
  let filePath = null;
  if (req.file) filePath = '/uploads/' + req.file.filename;

  const result = await pool.query(
    'INSERT INTO messages(user_id,text,file) VALUES($1,$2,$3) RETURNING *',
    [req.user.id, text, filePath]
  );

  const msg = result.rows[0];
  const username = req.user.username;
  io.emit('new_message', { ...msg, username });
  res.json({ success: true });
});

// -------------------------------------------
// メッセージ編集
app.put('/api/message/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;

  const msgRes = await pool.query('SELECT * FROM messages WHERE id=$1', [id]);
  if (!msgRes.rows[0]) return res.status(404).json({ success: false });
  if (msgRes.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false });

  await pool.query('UPDATE messages SET text=$1 WHERE id=$2', [text, id]);
  io.emit('edit_message', { id, text });
  res.json({ success: true });
});

// -------------------------------------------
// メッセージ削除
app.delete('/api/message/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  const msgRes = await pool.query('SELECT * FROM messages WHERE id=$1', [id]);
  if (!msgRes.rows[0]) return res.status(404).json({ success: false });
  if (msgRes.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false });

  await pool.query('DELETE FROM messages WHERE id=$1', [id]);
  io.emit('delete_message', parseInt(id));
  res.json({ success: true });
});

// -------------------------------------------
// 過去メッセージ取得（検索・無限スクロール対応）
app.get('/api/messages', authMiddleware, async (req, res) => {
  let { offset, limit, search } = req.query;
  offset = parseInt(offset) || 0;
  limit = parseInt(limit) || 50;

  let query = 'SELECT messages.*, users.username FROM messages JOIN users ON messages.user_id=users.id';
  const params = [];
  if (search) {
    query += ' WHERE text ILIKE $1';
    params.push(`%${search}%`);
  }
  query += ' ORDER BY id ASC OFFSET $2 LIMIT $3';
  params.push(offset, limit);

  const msgs = await pool.query(query, params);
  res.json(msgs.rows);
});

// -------------------------------------------
// WebSocket
let usersOnline = 0;
io.on('connection', socket => {
  usersOnline++;
  io.emit('user_count', usersOnline);

  socket.on('disconnect', () => {
    usersOnline--;
    io.emit('user_count', usersOnline);
  });

  socket.on('typing', username => {
    socket.broadcast.emit('typing', username);
  });
});

// -------------------------------------------
// サーバー起動
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
