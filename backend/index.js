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
      connectSrc: ["'self'", "https://qianxian-backend.onrender.com"]
    }
  },
  hsts: {
    maxAge: 63072000, // 2年
    includeSubDomains: true,
    preload: true
  }
}));

// CORS配置
const corsOptions = {
  origin: [
    'https://nenwa618.github.io',
    'http://localhost:3000',
    'https://qianxian-backend.onrender.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
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
  legacyHeaders: false
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
    maxAge: 24 * 60 * 60 * 1000 // 24小时
  },
  store: new (require('connect-pg-simple')(session))({
    pool: pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  name: 'qianxian.sid' // 自定义会话cookie名称
};

if (isProduction) {
  app.set('trust proxy', 1); // 信任第一个代理
}

app.use(session(sessionConfig));

// CSRF保护配置
const csrfProtection = csrf({
  cookie: {
    ...sessionConfig.cookie,
    path: '/'
  },
  value: (req) => {
    // 从header或body中获取CSRF令牌
    return req.headers['x-csrf-token'] || req.body._csrf;
  }
});

// Passport初始化
app.use(passport.initialize());
app.use(passport.session());

// 用户模型
class User {
  static async findById(id) {
    const { rows } = await pool.query('SELECT id, username, created_at FROM users WHERE id = $1', [id]);
    return rows[0];
  }

  static async findByUsername(username) {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return rows[0];
  }

  static async createUser(username, password) {
    if (password.length < 8) {
      throw new Error('密码至少需要8个字符');
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, hashedPassword]
    );
    return rows[0];
  }
}

// Passport配置
passport.use(new LocalStrategy(
  {
    usernameField: 'username',
    passwordField: 'password'
  },
  async (username, password, done) => {
    try {
      const user = await User.findByUsername(username);
      if (!user) return done(null, false, { message: '用户不存在' });
      
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return done(null, false, { message: '密码错误' });
      
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
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// CSRF令牌路由
app.get('/api/csrf-token', (req, res) => {
  res.json({ 
    token: req.csrfToken(),
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24小时后过期
  });
});

// 用户认证路由
app.post('/api/login', csrfProtection, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: info.message || '认证失败' 
      });
    }
    req.logIn(user, (err) => {
      if (err) return next(err);
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

app.post('/api/logout', csrfProtection, (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: '退出登录失败' 
      });
    }
    res.clearCookie('qianxian.sid');
    res.clearCookie('_csrf');
    res.json({ success: true });
  });
});

app.get('/api/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ 
      isAuthenticated: true, 
      user: {
        id: req.user.id,
        username: req.user.username
      }
    });
  } else {
    res.json({ isAuthenticated: false });
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
        username: newUser.username
      }
    });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || '注册失败' 
    });
  }
});

// 健康检查路由
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: '资源未找到' 
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  // CSRF错误处理
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

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDB();
  console.log(`服务器已启动，监听端口 ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
});