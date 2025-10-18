// backend/server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import pg from 'pg';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const upload = multer({ dest: 'uploads/' });

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(session({
  secret: 'secret_key',
  resave: false,
  saveUninitialized: false,
}));

// --- 認証 ---
const generateToken = () => crypto.randomBytes(16).toString('hex');

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hash]);
  res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  if(result.rows.length === 0) return res.json({ success: false });
  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);
  if(match){
    const token = generateToken();
    await pool.query('UPDATE users SET token=$1 WHERE id=$2', [token, user.id]);
    return res.json({ success: true, token, username: user.username, userId: user.id });
  }
  res.json({ success: false });
});

app.post('/api/logout', (req,res)=>{
  req.session.destroy(()=>{ res.json({ success:true })});
});

const authMiddleware = async (req,res,next)=>{
  const token = req.headers['authorization'];
  if(!token) return res.status(401).send('Unauthorized');
  const result = await pool.query('SELECT * FROM users WHERE token=$1', [token]);
  if(result.rows.length === 0) return res.status(401).send('Unauthorized');
  req.user = result.rows[0];
  next();
};

// --- メッセージ送信・編集・削除 ---
app.post('/api/message', authMiddleware, upload.single('file'), async (req,res)=>{
  const { text } = req.body;
  const file = req.file ? `/uploads/${req.file.filename}` : null;
  const timestamp = new Date();
  const result = await pool.query(
    'INSERT INTO messages (user_id, text, file, created_at) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, text, file, timestamp]
  );
  const msg = { ...result.rows[0], username: req.user.username };
  io.emit('new_message', msg);
  res.json(msg);
});

app.put('/api/message/:id', authMiddleware, async (req,res)=>{
  const { text } = req.body;
  const msgId = req.params.id;
  const result = await pool.query(
    'UPDATE messages SET text=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
    [text, msgId, req.user.id]
  );
  if(result.rows.length > 0) io.emit('edit_message', result.rows[0]);
  res.json(result.rows[0]);
});

app.delete('/api/message/:id', authMiddleware, async (req,res)=>{
  const msgId = req.params.id;
  const result = await pool.query(
    'DELETE FROM messages WHERE id=$1 AND user_id=$2 RETURNING *',
    [msgId, req.user.id]
  );
  if(result.rows.length > 0) io.emit('delete_message', msgId);
  res.json(result.rows[0]);
});

// --- 過去ログ取得（無限スクロール対応） ---
app.get('/api/messages', authMiddleware, async (req,res)=>{
  const { offset=0, limit=50, search='' } = req.query;
  const result = await pool.query(`
    SELECT m.*, u.username
    FROM messages m
    JOIN users u ON m.user_id=u.id
    WHERE m.text ILIKE $3
    ORDER BY m.created_at ASC
    OFFSET $1 LIMIT $2
  `, [offset, limit, `%${search}%`]);
  res.json(result.rows);
});

// --- 参加人数 ---
let onlineUsers = 0;
io.on('connection', socket => {
  onlineUsers++;
  io.emit('user_count', onlineUsers);

  socket.on('typing', username => socket.broadcast.emit('typing', username));

  socket.on('disconnect', ()=>{
    onlineUsers--;
    io.emit('user_count', onlineUsers);
  });
});

server.listen(process.env.PORT || 3000, ()=>console.log('Server running'));
