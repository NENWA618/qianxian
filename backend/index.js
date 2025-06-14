require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const helmet = require('helmet');
const crypto = require('crypto');
const http = require('http');
const socketio = require('socket.io');

const app = express();

// 数据库连接 - 使用Render的PostgreSQL
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 增强的安全中间件配置
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: [
        "'self'", 
        "https://qianxian-backend.onrender.com",
        "https://nenwa618.github.io"
      ]
    }
  },
  hsts: {
    maxAge: 63072000, // 2年
    includeSubDomains: true,
    preload: true
  }
}));

// CORS配置 - 增强版
const corsOptions = {
  origin: [
    'https://nenwa618.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'https://qianxian-backend.onrender.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'X-CSRF-Token', 
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'Cache-Control'
  ],
  exposedHeaders: ['X-CSRF-Token']
};
app.use(cors(corsOptions));

// 处理预检请求
app.options('*', cors(corsOptions));

// 生产环境强制HTTPS
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// 增强的速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 每个IP限制100个请求
  message: '请求过于频繁，请稍后再试',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.path === '/health';
  }
});
app.use(limiter);

// 请求体解析
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 会话配置
const isProduction = process.env.NODE_ENV === 'production';
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'qianxian_default_secret', // 建议在环境变量中设置
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  },
  store: new (require('connect-pg-simple')(session))({
    pool: pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  name: 'qianxian.sid'
};

if (isProduction) {
  app.set('trust proxy', 1);
}

// session中间件必须在csrf之前
app.use(session(sessionConfig));

// CSRF保护配置 - 只用默认配置即可，不要用cookie模式
const csrfProtection = csrf({
  value: (req) => {
    return req.headers['x-csrf-token'] || req.body._csrf;
  },
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS']
});

// Passport初始化
app.use(passport.initialize());
app.use(passport.session());

// 用户模型 - 增强版，支持 is_super_admin
class User {
  static async findById(id) {
    try {
      const { rows } = await pool.query(
        'SELECT id, username, created_at, is_admin, is_super_admin, is_approved, password FROM users WHERE id = $1', 
        [id]
      );
      if (!rows[0]) return null;
      const user = rows[0];
      // 兼容旧数据：ID=1自动是创始人、超管、管理员、已审核
      user.is_admin = user.is_admin || (user.id === 1);
      user.is_super_admin = user.is_super_admin || (user.id === 1);
      user.is_approved = user.is_approved !== false || (user.id === 1);
      return user;
    } catch (err) {
      console.error('查找用户失败:', err);
      throw err;
    }
  }

  static async findByUsername(username) {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM users WHERE username = $1', 
        [username]
      );
      if (!rows[0]) return null;
      const user = rows[0];
      user.is_admin = user.is_admin || (user.id === 1);
      user.is_super_admin = user.is_super_admin || (user.id === 1);
      user.is_approved = user.is_approved !== false || (user.id === 1);
      return user;
    } catch (err) {
      console.error('查找用户名失败:', err);
      throw err;
    }
  }

  static async createUser(username, password) {
    try {
      if (password.length < 8) {
        throw new Error('密码至少需要8个字符');
      }
      // 创始人自动审核通过
      let is_approved = false;
      let is_admin = false;
      let is_super_admin = false;
      // 判断是否第一个用户
      const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM users');
      if (parseInt(countRows[0].count, 10) === 0) {
        is_approved = true;
        is_admin = true;
        is_super_admin = true;
      }
      const hashedPassword = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        'INSERT INTO users (username, password, is_approved, is_admin, is_super_admin) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, created_at, is_admin, is_super_admin, is_approved',
        [username, hashedPassword, is_approved, is_admin, is_super_admin]
      );
      rows[0].is_admin = rows[0].is_admin || (rows[0].id === 1);
      rows[0].is_super_admin = rows[0].is_super_admin || (rows[0].id === 1);
      rows[0].is_approved = rows[0].is_approved !== false || (rows[0].id === 1);
      return rows[0];
    } catch (err) {
      console.error('创建用户失败:', err);
      throw err;
    }
  }
}

// Passport配置 - 增强版
passport.use(new LocalStrategy(
  {
    usernameField: 'username',
    passwordField: 'password',
    passReqToCallback: true
  },
  async (req, username, password, done) => {
    try {
      console.log(`尝试登录用户: ${username}`);
      const user = await User.findByUsername(username);
      if (!user) {
        console.log('用户不存在:', username);
        return done(null, false, { message: '用户不存在' });
      }
      if (!user.is_approved && user.id !== 1) {
        return done(null, false, { message: '账号未审核，请等待管理员或超管批准' });
      }
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        console.log('密码错误:', username);
        return done(null, false, { message: '密码错误' });
      }
      console.log('用户认证成功:', username);
      return done(null, user);
    } catch (err) {
      console.error('认证过程中出错:', err);
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    console.log('反序列化用户ID:', id);
    const user = await User.findById(id);
    if (!user) {
      return done(new Error('用户不存在'));
    }
    done(null, user);
  } catch (err) {
    console.error('反序列化用户失败:', err);
    done(err);
  }
});

// CSRF令牌路由
app.get('/api/csrf-token', (req, res, next) => {
  csrfProtection(req, res, () => {
    try {
      if (!req.session) {
        throw new Error('会话未初始化');
      }
      const token = req.csrfToken();
      console.log('生成CSRF令牌:', token);

      // 设置CSRF cookie
      res.cookie('XSRF-TOKEN', token, {
        httpOnly: false,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      res.json({
        token,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
    } catch (err) {
      console.error('生成CSRF令牌失败:', err);
      res.status(500).json({
        success: false,
        message: '无法生成CSRF令牌',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  });
});

// 用户认证路由
app.post('/api/login', csrfProtection, (req, res, next) => {
  console.log('处理登录请求:', req.body.username);
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('登录过程中出错:', err);
      return next(err);
    }
    if (!user) {
      console.log('登录失败:', info.message);
      return res.status(401).json({ 
        success: false, 
        message: info.message || '认证失败' 
      });
    }
    req.logIn(user, (err) => {
      if (err) {
        console.error('登录会话创建失败:', err);
        return next(err);
      }
      console.log('用户登录成功:', user.username);
      return res.json({ 
        success: true, 
        user: {
          id: user.id,
          username: user.username,
          is_admin: user.is_admin,
          is_super_admin: user.is_super_admin
        }
      });
    });
  })(req, res, next);
});

// 退出登录路由
app.post('/api/logout', csrfProtection, (req, res) => {
  console.log('处理退出登录请求');
  req.logout((err) => {
    if (err) {
      console.error('退出登录失败:', err);
      return res.status(500).json({ 
        success: false, 
        message: '退出登录失败' 
      });
    }
    res.clearCookie('qianxian.sid');
    res.clearCookie('XSRF-TOKEN');
    res.clearCookie('_csrf');
    console.log('用户已退出登录');
    res.json({ success: true });
  });
});

// ========== 新增：修改密码接口 ==========
app.post('/api/change-password', csrfProtection, async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: '参数不完整' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: '新密码至少8位' });
  }
  try {
    const user = await User.findById(req.user.id);
    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
      return res.status(400).json({ success: false, message: '原密码错误' });
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hashed, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: '修改失败' });
  }
});
// ========== END 修改密码接口 ==========

// 用户信息路由
app.get('/api/user', (req, res) => {
  try {
    if (req.isAuthenticated()) {
      console.log('获取已认证用户信息:', req.user.username);
      res.json({ 
        isAuthenticated: true, 
        user: {
          id: req.user.id,
          username: req.user.username,
          is_admin: req.user.is_admin,
          is_super_admin: req.user.is_super_admin,
          is_approved: req.user.is_approved
        }
      });
    } else {
      console.log('获取未认证用户信息');
      res.json({ isAuthenticated: false });
    }
  } catch (err) {
    console.error('获取用户信息失败:', err);
    res.status(500).json({ 
      success: false, 
      message: '无法获取用户信息' 
    });
  }
});

// 用户注册路由
app.post('/api/register', csrfProtection, async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('处理注册请求:', username);
    if (!username || !password) {
      console.log('注册失败: 用户名和密码不能为空');
      return res.status(400).json({ 
        success: false, 
        message: '用户名和密码不能为空' 
      });
    }
    if (username.length < 3 || username.length > 20) {
      console.log('注册失败: 用户名长度不符合要求');
      return res.status(400).json({ 
        success: false, 
        message: '用户名长度需在3-20个字符之间' 
      });
    }
    if (password.length < 8) {
      console.log('注册失败: 密码长度不足');
      return res.status(400).json({ 
        success: false, 
        message: '密码至少需要8个字符' 
      });
    }
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      console.log('注册失败: 用户名已存在');
      return res.status(400).json({ 
        success: false, 
        message: '用户名已存在' 
      });
    }
    const newUser = await User.createUser(username, password);
    console.log('注册成功:', newUser.username);
    res.status(201).json({ 
      success: true, 
      user: {
        id: newUser.id,
        username: newUser.username,
        is_admin: newUser.is_admin,
        is_super_admin: newUser.is_super_admin,
        is_approved: newUser.is_approved
      }
    });
  } catch (err) {
    console.error('注册过程中出错:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || '注册失败' 
    });
  }
});

// --- 新增：首页内容管理API ---
app.get('/api/site-content', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM site_content');
    const content = {};
    rows.forEach(row => { content[row.key] = row.value; });
    res.json({ success: true, content });
  } catch (err) {
    res.status(500).json({ success: false, message: '获取内容失败' });
  }
});

// 仅管理员可修改首页内容
app.post('/api/site-content', csrfProtection, async (req, res) => {
  if (!req.isAuthenticated() || !req.user.is_admin) {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ success: false, message: '缺少key' });
  try {
    await pool.query(
      `INSERT INTO site_content (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: '保存失败' });
  }
});

// --- 新增：成员列表API ---
app.get('/api/members', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, created_at, is_admin, is_super_admin, is_approved FROM users ORDER BY id ASC');
    const members = rows.map(u => ({
      id: u.id,
      username: u.username,
      is_admin: u.is_admin || (u.id === 1),
      is_super_admin: u.is_super_admin || (u.id === 1),
      is_approved: u.is_approved !== false || (u.id === 1)
    }));
    res.json({ success: true, members });
  } catch (err) {
    res.status(500).json({ success: false, message: '获取成员列表失败' });
  }
});

// 获取单个成员详情（仅管理员及以上可用）
app.get('/api/members/:id', async (req, res) => {
  if (
    !req.isAuthenticated() ||
    !(req.user.is_admin || req.user.is_super_admin || req.user.id === 1)
  ) {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT id, username, created_at, is_admin, is_super_admin, is_approved FROM users WHERE id = $1', [id]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: '成员不存在' });
    }
    res.json({ success: true, member: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: '获取成员详情失败' });
  }
});

// 发送好友申请
app.post('/api/friends/request', csrfProtection, async (req, res) => {
  const fromUserId = req.user?.id;
  const { toUserId } = req.body;
  if (!fromUserId || !toUserId || fromUserId === toUserId) return res.status(400).json({ success: false, message: '参数错误' });
  try {
    await pool.query(
      `INSERT INTO friend_requests (from_user_id, to_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [fromUserId, toUserId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: '申请失败' });
  }
});

// 获取好友申请（收到/发出）
app.get('/api/friends/requests', csrfProtection, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false });
  const { type } = req.query; // type: 'received' | 'sent'
  let sql, params;
  if (type === 'received') {
    sql = `SELECT fr.*, u.username AS from_username FROM friend_requests fr JOIN users u ON fr.from_user_id = u.id WHERE fr.to_user_id=$1 AND fr.status='pending'`;
    params = [userId];
  } else {
    sql = `SELECT fr.*, u.username AS to_username FROM friend_requests fr JOIN users u ON fr.to_user_id = u.id WHERE fr.from_user_id=$1 AND fr.status='pending'`;
    params = [userId];
  }
  const { rows } = await pool.query(sql, params);
  res.json({ success: true, requests: rows });
});

// 同意/拒绝好友申请（所有已登录用户可处理）
app.post('/api/friends/respond', csrfProtection, async (req, res) => {
  const userId = req.user?.id;
  const { requestId, action } = req.body; // action: 'accept' | 'decline'
  if (!userId || !requestId || !['accept', 'decline'].includes(action)) return res.status(400).json({ success: false });
  const { rows } = await pool.query(`SELECT * FROM friend_requests WHERE id=$1`, [requestId]);
  const reqRow = rows[0];
  if (!reqRow || reqRow.to_user_id !== userId || reqRow.status !== 'pending') return res.status(403).json({ success: false });
  await pool.query(`UPDATE friend_requests SET status=$1 WHERE id=$2`, [action === 'accept' ? 'accepted' : 'declined', requestId]);
  if (action === 'accept') {
    // 双向加好友
    await pool.query(`INSERT INTO user_friends (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`, [reqRow.from_user_id, reqRow.to_user_id]);
  }
  res.json({ success: true });
});

// 获取好友列表
app.get('/api/friends', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ success: false, message: '未登录' });
  try {
    const { rows } = await pool.query(
      'SELECT u.id, u.username FROM users u JOIN user_friends f ON u.id = f.friend_id WHERE f.user_id = $1',
      [req.user.id]
    );
    res.json({ success: true, friends: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// --- 新增：聊天消息API ---
app.get('/api/chat/messages', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ success: false });
  const { targetType, targetId, limit, beforeId } = req.query;
  let sql = '';
  let params = [];
  let pageLimit = Math.min(Number(limit) || 50, 100); // 默认50，最大100

  if (targetType === 'public') {
    if (beforeId) {
      sql = `SELECT m.*, u.username, u.is_admin, u.is_super_admin 
             FROM chat_messages m 
             JOIN users u ON m.sender_id = u.id 
             WHERE m.target_type = 'public' AND m.id < $1 
             ORDER BY m.id DESC 
             LIMIT $2`;
      params = [beforeId, pageLimit];
    } else {
      sql = `SELECT m.*, u.username, u.is_admin, u.is_super_admin 
             FROM chat_messages m 
             JOIN users u ON m.sender_id = u.id 
             WHERE m.target_type = 'public' 
             ORDER BY m.id DESC 
             LIMIT $1`;
      params = [pageLimit];
    }
  } else if (targetType === 'private' && targetId) {
    if (beforeId) {
      sql = `SELECT m.*, u.username, u.is_admin, u.is_super_admin 
             FROM chat_messages m 
             JOIN users u ON m.sender_id = u.id 
             WHERE m.target_type = 'private' 
               AND ((m.sender_id = $1 AND m.target_id = $2) OR (m.sender_id = $2 AND m.target_id = $1))
               AND m.id < $3
             ORDER BY m.id DESC 
             LIMIT $4`;
      params = [req.user.id, targetId, beforeId, pageLimit];
    } else {
      sql = `SELECT m.*, u.username, u.is_admin, u.is_super_admin 
             FROM chat_messages m 
             JOIN users u ON m.sender_id = u.id 
             WHERE m.target_type = 'private' 
               AND ((m.sender_id = $1 AND m.target_id = $2) OR (m.sender_id = $2 AND m.target_id = $1))
             ORDER BY m.id DESC 
             LIMIT $3`;
      params = [req.user.id, targetId, pageLimit];
    }
  } else {
    return res.status(400).json({ success: false, message: '参数错误' });
  }
  try {
    const { rows } = await pool.query(sql, params);
    // 返回升序（时间从早到晚）
    rows.reverse();
    res.json({ success: true, messages: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: '获取聊天记录失败' });
  }
});

app.post('/api/chat/clear', csrfProtection, async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ success: false });
  const { targetType, targetId } = req.body;
  let sql = '';
  let params = [];
  if (targetType === 'public') {
    sql = `DELETE FROM chat_messages WHERE target_type = 'public'`;
    params = [];
  } else if (targetType === 'private' && targetId) {
    sql = `DELETE FROM chat_messages WHERE target_type = 'private' AND ((sender_id = $1 AND target_id = $2) OR (sender_id = $2 AND target_id = $1))`;
    params = [req.user.id, targetId];
  } else {
    return res.status(400).json({ success: false, message: '参数错误' });
  }
  try {
    await pool.query(sql, params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: '清空失败' });
  }
});

// --- 权限相关中间件 ---
function requireSuperAdminOrAdmin(req, res, next) {
  if (req.isAuthenticated() && (req.user.is_admin || req.user.is_super_admin || req.user.id === 1)) {
    return next();
  }
  res.status(403).json({ success: false, message: '只有管理员及以上可操作' });
}
function requireSuperAdmin(req, res, next) {
  if (req.isAuthenticated() && (req.user.is_super_admin || req.user.id === 1)) {
    return next();
  }
  res.status(403).json({ success: false, message: '只有超管可操作' });
}
function requireFounder(req, res, next) {
  if (req.isAuthenticated() && req.user.id === 1) {
    return next();
  }
  res.status(403).json({ success: false, message: '只有创始人可操作' });
}

// --- 管理员/超管权限相关API ---
app.post('/api/admin/set-admin', csrfProtection, requireSuperAdmin, async (req, res) => {
  const { userId, isAdmin } = req.body;
  if (Number(userId) === 1) {
    return res.status(400).json({ success: false, message: '创始人权限不可更改' });
  }
  try {
    await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [!!isAdmin, userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: '数据库操作失败' });
  }
});

app.post('/api/admin/set-super-admin', csrfProtection, requireFounder, async (req, res) => {
  const { userId, isSuperAdmin } = req.body;
  if (Number(userId) === 1) {
    return res.status(400).json({ success: false, message: '创始人权限不可更改' });
  }
  try {
    await pool.query('UPDATE users SET is_super_admin = $1 WHERE id = $2', [!!isSuperAdmin, userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: '数据库操作失败' });
  }
});

// --- 新增：注册审核相关API ---
// 获取待审核用户列表（仅管理员及以上）
app.get('/api/admin/pending-users', requireSuperAdminOrAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, created_at FROM users WHERE is_approved = FALSE ORDER BY id ASC'
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: '获取待审核用户失败' });
  }
});

// 审核通过用户（仅管理员及以上）
app.post('/api/admin/approve-user', csrfProtection, requireSuperAdminOrAdmin, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: '缺少userId' });
  if (Number(userId) === 1) {
    return res.status(400).json({ success: false, message: '创始人无需审核' });
  }
  try {
    await pool.query('UPDATE users SET is_approved = TRUE WHERE id = $1', [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: '审核失败' });
  }
});

// 健康检查路由
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected'
    });
  } catch (err) {
    console.error('健康检查失败:', err);
    res.status(500).json({ 
      status: 'error',
      database: 'disconnected',
      error: err.message
    });
  }
});

// 404处理
app.use((req, res) => {
  console.log('404错误:', req.method, req.originalUrl);
  res.status(404).json({ 
    success: false, 
    message: '资源未找到',
    path: req.originalUrl
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method
  });
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ 
      success: false, 
      message: '无效的CSRF令牌' 
    });
  }
  res.status(500).json({ 
    success: false, 
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 数据库初始化
async function initDB() {
  try {
    console.log('开始数据库初始化...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_admin BOOLEAN DEFAULT FALSE,
        is_super_admin BOOLEAN DEFAULT FALSE,
        is_approved BOOLEAN DEFAULT FALSE
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS site_content (
        key VARCHAR PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_friends (
        user_id INTEGER NOT NULL,
        friend_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, friend_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER NOT NULL,
        target_type VARCHAR(16) NOT NULL,
        target_id INTEGER,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // 新增：好友申请表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friend_requests (
        id SERIAL PRIMARY KEY,
        from_user_id INTEGER NOT NULL,
        to_user_id INTEGER NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (from_user_id, to_user_id)
      )
    `);
    // 补丁：如果旧表没有is_approved字段则添加
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT FALSE
    `);
    console.log('数据库表初始化完成');
  } catch (err) {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  }
}

// --- Socket.IO 聊天功能集成 ---
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: corsOptions.origin,
    credentials: true
  }
});

// Socket.IO 鉴权中间件
io.use((socket, next) => {
  session(sessionConfig)(socket.request, {}, async () => {
    const req = socket.request;
    if (req.session && req.session.passport && req.session.passport.user) {
      try {
        const user = await User.findById(req.session.passport.user);
        if (user) {
          socket.user = user;
          return next();
        }
      } catch (err) {
        return next(new Error('用户查找失败'));
      }
    }
    next(new Error('未认证，无法连接聊天'));
  });
});

// 聊天事件
io.on('connection', (socket) => {
  console.log('用户已连接聊天:', socket.user.username);

  socket.on('chat message', async (msg) => {
    // msg: { message, targetType, targetId }
    if (!msg || typeof msg.message !== 'string' || !msg.targetType) return;
    let targetType = msg.targetType;
    let targetId = msg.targetId || null;
    let content = msg.message.trim();
    if (!content) return;
    let insertedMsg = null;
    // 持久化消息
    try {
      const result = await pool.query(
        `INSERT INTO chat_messages (sender_id, target_type, target_id, content) VALUES ($1, $2, $3, $4) RETURNING *`,
        [socket.user.id, targetType, targetType === 'public' ? null : targetId, content]
      );
      insertedMsg = result.rows[0];
    } catch (e) {
      // ignore
    }
    // 广播到对应房间
    const data = {
      username: socket.user.username,
      id: socket.user.id,
      is_admin: socket.user.is_admin,
      is_super_admin: socket.user.is_super_admin,
      message: content,
      targetType,
      targetId,
      time: insertedMsg ? insertedMsg.created_at : new Date().toISOString(),
      msgId: insertedMsg ? insertedMsg.id : undefined
    };
    if (targetType === 'public') {
      io.emit('chat message', data);
    } else if (targetType === 'private' && targetId) {
      // 只发给双方
      io.sockets.sockets.forEach(s => {
        if (
          s.user &&
          (s.user.id === socket.user.id || s.user.id === Number(targetId))
        ) {
          s.emit('chat message', data);
        }
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('用户断开聊天:', socket.user.username);
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  try {
    await initDB();
    console.log(`服务器已启动，监听端口 ${PORT}`);
    console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
    console.log(`CORS允许的源: ${corsOptions.origin.join(', ')}`);
  } catch (err) {
    console.error('服务器启动失败:', err);
    process.exit(1);
  }
});