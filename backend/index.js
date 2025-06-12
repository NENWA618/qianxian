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
  secret: process.env.SESSION_SECRET || 'qianxian_default_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    domain: isProduction ? '.qianxian-backend.onrender.com' : undefined
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

app.use(session(sessionConfig));

// CSRF保护配置
const csrfProtection = csrf({
  value: (req) => {
    return req.headers['x-csrf-token'] || req.body._csrf;
  },
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS']
});

// Passport初始化
app.use(passport.initialize());
app.use(passport.session());

// 用户模型 - 增强版
class User {
  static async findById(id) {
    try {
      const { rows } = await pool.query(
        'SELECT id, username, is_admin, created_at FROM users WHERE id = $1', 
        [id]
      );
      return rows[0];
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
      return rows[0];
    } catch (err) {
      console.error('查找用户名失败:', err);
      throw err;
    }
  }

  static async createUser(username, password, isAdmin = false) {
    try {
      if (password.length < 8) {
        throw new Error('密码至少需要8个字符');
      }
      
      const hashedPassword = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        'INSERT INTO users (username, password, is_admin) VALUES ($1, $2, $3) RETURNING id, username, is_admin, created_at',
        [username, hashedPassword, isAdmin]
      );
      return rows[0];
    } catch (err) {
      console.error('创建用户失败:', err);
      throw err;
    }
  }

  static async isAdmin(userId) {
    try {
      const { rows } = await pool.query(
        'SELECT is_admin FROM users WHERE id = $1',
        [userId]
      );
      return rows[0]?.is_admin || false;
    } catch (err) {
      console.error('检查管理员状态失败:', err);
      return false;
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

// CSRF令牌路由
app.get('/api/csrf-token', (req, res, next) => {
  csrfProtection(req, res, () => {
    try {
      const token = req.csrfToken();
      res.cookie('XSRF-TOKEN', token, {
        httpOnly: false,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });
      res.json({ token });
    } catch (err) {
      res.status(500).json({ success: false, message: '无法生成CSRF令牌' });
    }
  });
});

// 用户认证路由
app.post('/api/login', csrfProtection, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ success: false, message: info.message || '认证失败' });
    
    req.logIn(user, (err) => {
      if (err) return next(err);
      res.json({ 
        success: true, 
        user: {
          id: user.id,
          username: user.username,
          isAdmin: user.is_admin
        }
      });
    });
  })(req, res, next);
});

// 退出登录路由
app.post('/api/logout', csrfProtection, (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ success: false, message: '退出登录失败' });
    res.clearCookie('qianxian.sid');
    res.clearCookie('XSRF-TOKEN');
    res.clearCookie('_csrf');
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
          isAdmin: req.user.is_admin
        }
      });
    } else {
      res.json({ isAuthenticated: false });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: '无法获取用户信息' });
  }
});

// 管理员检查路由
app.get('/api/user/is-admin', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ isAdmin: false });
    }
    const isAdmin = await User.isAdmin(req.user.id);
    res.json({ isAdmin });
  } catch (err) {
    res.status(500).json({ success: false, message: '无法检查管理员状态' });
  }
});

// 管理员专属文件下载路由
app.get('/api/admin/authority', csrfProtection, async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    const isAdmin = await User.isAdmin(req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权访问' });
    }

    // 这里是管理员专属内容
    const authorityContent = "这是管理员专属密钥，请妥善保管";
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="authority.txt"');
    res.send(authorityContent);
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 用户注册路由
app.post('/api/register', csrfProtection, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ success: false, message: '用户名长度需在3-20个字符之间' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: '密码至少需要8个字符' });
    }
    
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ success: false, message: '用户名已存在' });
    }
    
    // 普通用户注册，isAdmin默认为false
    const newUser = await User.createUser(username, password, false);
    res.status(201).json({ 
      success: true, 
      user: {
        id: newUser.id,
        username: newUser.username
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || '注册失败' });
  }
});

// 健康检查路由
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ success: false, message: '资源未找到' });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ success: false, message: '无效的CSRF令牌' });
  }
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// 数据库初始化
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);

    // 检查是否有管理员用户，如果没有则创建一个默认管理员
    const { rows } = await pool.query('SELECT * FROM users WHERE is_admin = TRUE LIMIT 1');
    if (rows.length === 0 && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await pool.query(
        'INSERT INTO users (username, password, is_admin) VALUES ($1, $2, $3)',
        [process.env.ADMIN_USERNAME, hashedPassword, true]
      );
      console.log('已创建默认管理员账户');
    }
  } catch (err) {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  }
}

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    await initDB();
    console.log(`服务器已启动，监听端口 ${PORT}`);
  } catch (err) {
    console.error('服务器启动失败:', err);
    process.exit(1);
  }
});