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

// 会话和CSRF配置
const isProduction = process.env.NODE_ENV === 'production';
const sessionConfig = {
  secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
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

// CSRF保护配置 - 增强版
const csrfProtection = csrf({
  cookie: {
    ...sessionConfig.cookie,
    path: '/'
  },
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
        'SELECT id, username, created_at FROM users WHERE id = $1', 
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

  static async createUser(username, password) {
    try {
      if (password.length < 8) {
        throw new Error('密码至少需要8个字符');
      }
      
      const hashedPassword = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, created_at',
        [username, hashedPassword]
      );
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

// CSRF令牌路由 - 增强版
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  try {
    // 确保会话已初始化
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

// 用户认证路由 - 增强版
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
          username: user.username
        }
      });
    });
  })(req, res, next);
});

// 退出登录路由 - 增强版
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

// 用户信息路由 - 增强版
app.get('/api/user', (req, res) => {
  try {
    if (req.isAuthenticated()) {
      console.log('获取已认证用户信息:', req.user.username);
      res.json({ 
        isAuthenticated: true, 
        user: {
          id: req.user.id,
          username: req.user.username
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

// 用户注册路由 - 增强版
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
        username: newUser.username
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

// 健康检查路由 - 增强版
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

// 404处理 - 增强版
app.use((req, res) => {
  console.log('404错误:', req.method, req.originalUrl);
  res.status(404).json({ 
    success: false, 
    message: '资源未找到',
    path: req.originalUrl
  });
});

// 错误处理中间件 - 增强版
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

// 数据库初始化 - 增强版
async function initDB() {
  try {
    console.log('开始数据库初始化...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
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
    
    console.log('数据库表初始化完成');
  } catch (err) {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  }
}

// 启动服务器 - 增强版
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
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