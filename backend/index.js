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
  app.set('trust proxy', 1);
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
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
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
  name: 'qianxian.sid',
  proxy: true
};

app.use(session(sessionConfig));

// CSRF保护配置 - 重要优化
const csrfProtection = csrf({
  cookie: false, // 不使用cookie模式
  value: (req) => {
    // 从header或body中获取token
    return req.headers['x-csrf-token'] || req.body._csrf;
  },
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS']
});

// Passport初始化
app.use(passport.initialize());
app.use(passport.session());

// 用户模型
class User {
  static async findById(id) {
    try {
      const { rows } = await pool.query(
        'SELECT id, username, created_at, is_admin, is_super_admin FROM users WHERE id = $1', 
        [id]
      );
      if (!rows[0]) return null;
      const user = rows[0];
      user.is_admin = user.is_admin || (user.id === 1);
      user.is_super_admin = user.is_super_admin || (user.id === 1);
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
      const hashedPassword = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, created_at, is_admin, is_super_admin',
        [username, hashedPassword]
      );
      rows[0].is_admin = rows[0].is_admin || (rows[0].id === 1);
      rows[0].is_super_admin = rows[0].is_super_admin || (rows[0].id === 1);
      return rows[0];
    } catch (err) {
      console.error('创建用户失败:', err);
      throw err;
    }
  }
}

// Passport配置
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
        return done(null, false, { message: '用户不存在' });
      }
      
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return done(null, false, { message: '密码错误' });
      }
      
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    if (!user) {
      return done(new Error('用户不存在'));
    }
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// CSRF令牌路由 - 重要优化
app.get('/api/csrf-token', (req, res) => {
  if (!req.session) {
    return res.status(500).json({ 
      success: false, 
      message: '会话未初始化' 
    });
  }

  const token = req.csrfToken();
  console.log('生成CSRF令牌:', token);

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
});

// 用户认证路由
app.post('/api/login', csrfProtection, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: info.message || '认证失败' 
      });
    }
    
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      
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
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: '退出登录失败' 
      });
    }
    
    res.clearCookie('qianxian.sid');
    res.clearCookie('XSRF-TOKEN');
    res.json({ success: true });
  });
});

// 用户信息路由
app.get('/api/user', (req, res) => {
  try {
    if (req.isAuthenticated()) {
      res.json({ 
        isAuthenticated: true, 
        user: {
          id: req.user.id,
          username: req.user.username,
          is_admin: req.user.is_admin,
          is_super_admin: req.user.is_super_admin
        }
      });
    } else {
      res.json({ isAuthenticated: false });
    }
  } catch (err) {
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
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: '用户名和密码不能为空' 
      });
    }
    
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ 
        success: false, 
        message: '用户名长度需在3-20个字符之间' 
      });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ 
        success: false, 
        message: '密码至少需要8个字符' 
      });
    }
    
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: '用户名已存在' 
      });
    }
    
    const newUser = await User.createUser(username, password);
    res.status(201).json({ 
      success: true, 
      user: {
        id: newUser.id,
        username: newUser.username,
        is_admin: newUser.id === 1,
        is_super_admin: newUser.id === 1
      }
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      message: err.message || '注册失败' 
    });
  }
});

// 首页内容管理API
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

// 成员列表API
app.get('/api/members', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, created_at, is_admin, is_super_admin FROM users ORDER BY id ASC');
    const members = rows.map(u => ({
      id: u.id,
      username: u.username,
      is_admin: u.is_admin || (u.id === 1),
      is_super_admin: u.is_super_admin || (u.id === 1)
    }));
    res.json({ success: true, members });
  } catch (err) {
    res.status(500).json({ success: false, message: '获取成员列表失败' });
  }
});

app.get('/api/members/:id', async (req, res) => {
  if (!req.isAuthenticated() || !req.user.is_admin) {
    return res.status(403).json({ success: false, message: '无权限' });
  }
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT id, username, created_at, is_admin, is_super_admin FROM users WHERE id = $1', [id]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: '成员不存在' });
    }
    res.json({ success: true, member: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: '获取成员详情失败' });
  }
});

// 权限相关中间件
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

// 管理员/超管权限相关API
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
    res.status(500).json({ 
      status: 'error',
      database: 'disconnected',
      error: err.message
    });
  }
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: '资源未找到',
    path: req.originalUrl
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_admin BOOLEAN DEFAULT FALSE,
        is_super_admin BOOLEAN DEFAULT FALSE
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
  } catch (err) {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  }
}

// Socket.IO 聊天功能集成
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: corsOptions.origin,
    credentials: true,
    transports: ['websocket']
  }
});

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

io.on('connection', (socket) => {
  socket.on('chat message', (msg) => {
    io.emit('chat message', {
      username: socket.user.username,
      id: socket.user.id,
      is_admin: socket.user.is_admin,
      is_super_admin: socket.user.is_super_admin,
      message: msg,
      time: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    console.log('用户断开聊天:', socket.user?.username);
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  try {
    await initDB();
    console.log(`服务器已启动，监听端口 ${PORT}`);
  } catch (err) {
    console.error('服务器启动失败:', err);
    process.exit(1);
  }
});