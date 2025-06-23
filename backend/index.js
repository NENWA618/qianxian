require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const adaptiveRateLimit = require('./middleware/adaptiveRateLimit');
const csrf = require('csurf');
const helmet = require('helmet');
const crypto = require('crypto');
const http = require('http');
const socketio = require('socket.io');
const compression = require('compression');

// 新增依赖
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const redis = require('redis');
const RedisStore = require('connect-redis').default;
const { v4: uuidv4 } = require('uuid');
const ApiToken = require('./models/api_tokens');
const { logOperation } = require('./models/operation_logs');
const { getParams, setParam, setParamsBatch, getChangeLog, resetParams } = require('./config/dynamicParams');
const { getCacheStats, monitorCache, getOrRefreshCacheWithEntropy, setCache, getCache, delCache, clearCache, initRedis } = require('./cache');

// 新增：引入zxcvbn用于密码强度校验
const zxcvbn = require('zxcvbn');

// 新增：参数校验中间件
const { body, param, query, validationResult } = require('express-validator');
const validate = require('./middleware/validate'); // 你需要新建 middleware/validate.js

const app = express(); // 必须先初始化app

// 加载Swagger文档
const swaggerDocument = YAML.load(path.join(__dirname, 'swagger.yaml'));

// Redis缓存工具
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || undefined
});
redisClient.connect().catch(console.error);

// 数据库连接
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000
});

// ========== 递归熵驱动缓存刷新优化 ==========
// 首页内容递归熵缓存
async function getSiteContentWithEntropy() {
  // 使用递归熵缓存工具，判据为内容块访问分布熵变化
  return await getOrRefreshCacheWithEntropy(
    'site_content_blocks',
    async () => {
      const { rows } = await pool.query('SELECT key, value FROM site_content');
      const content = {};
      rows.forEach(row => {
        content[row.key] = row.value;
      });
      return content;
    },
    {
      ttl: 300,
      entropyJudge: (cached) => {
        // 简单判据：内容块数量变化或内容块为空时刷新
        if (!cached || typeof cached !== 'object')
          return Object.keys(cached).length > 0;
      },
      maxDepth: 2
    }
  );
}
// ========== END 递归熵驱动缓存刷新 ==========

// 响应压缩（gzip/brotli）
app.use(compression());

// 增强的安全中间件配置
app.use(helmet());
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Session & Redis
const sessionStore = new RedisStore({ client: redisClient });
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'qianxian_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// CSRF 防护
app.use(csrf());

// Passport 初始化
app.use(passport.initialize());
app.use(passport.session());

// ========== 全局参数校验中间件（统一处理校验错误） ==========
app.use(validate.handleValidationErrors);

// ========== API Token 相关接口专用限流 ==========
const tokenRateLimit = adaptiveRateLimit({
  windowMs: 10 * 60 * 1000,
  min: 3,
  max: 10,
  criticalDamping: true,
  groupKey: '/api/api-tokens'
});
app.use(['/api/api-tokens', '/api/api-tokens/:token'], tokenRateLimit);

// ========== 其他接口限流 ==========
app.use(adaptiveRateLimit());

// ========== 路由定义 ==========

// 示例：注册接口参数校验
app.post(
  '/api/register',
  [
    body('username').isString().isLength({ min: 3, max: 32 }).trim().escape(),
    body('password').isString().isLength({ min: 6, max: 64 }),
    body('email').optional().isEmail().normalizeEmail()
  ],
  validate.handleValidationErrors,
  async (req, res) => {
    // ...注册逻辑...
  }
);

// 示例：API Token 创建接口参数校验与日志
app.post(
  '/api/api-tokens',
  [
    body('description').isString().isLength({ min: 1, max: 128 }).trim().escape(),
    body('expired_at').optional().isISO8601()
  ],
  validate.handleValidationErrors,
  async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: '未登录' });
    try {
      const { description, expired_at } = req.body;
      const tokenObj = await ApiToken.createToken({
        user_id: user.id,
        description,
        expired_at
      });
      await logOperation({
        user_id: user.id,
        username: user.username,
        action: 'create_token',
        detail: { description, expired_at },
        ip: req.ip,
        channel_mode: 'api_token'
      });
      res.json({ success: true, data: { token: tokenObj.token } });
    } catch (err) {
      await logOperation({
        user_id: user.id,
        username: user.username,
        action: 'create_token_fail',
        detail: { error: err.message },
        ip: req.ip,
        channel_mode: 'api_token'
      });
      res.status(500).json({ success: false, message: 'Token创建失败' });
    }
  }
);

// 其他 API 路由...（请为敏感接口补充参数校验与日志）

// ========== 热点数据 Redis 缓存示例 ==========
app.get('/api/members', async (req, res) => {
  const cacheKey = 'members:list';
  let data = await getCache(cacheKey);
  if (!data) {
    // ...从数据库查询成员列表...
    // 假设 data = await getMembersFromDb();
    await setCache(cacheKey, data, 60 * 5); // 缓存5分钟
    // 可写入缓存命中/失效日志
    await logOperation({
      user_id: req.user ? req.user.id : 0,
      username: req.user ? req.user.username : 'system',
      action: 'cache_miss',
      detail: { key: cacheKey },
      ip: req.ip,
      channel_mode: 'members'
    });
  } else {
    await logOperation({
      user_id: req.user ? req.user.id : 0,
      username: req.user ? req.user.username : 'system',
      action: 'cache_hit',
      detail: { key: cacheKey },
      ip: req.ip,
      channel_mode: 'members'
    });
  }
  res.json({ success: true, data });
});

// ========== Swagger UI ==========
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ========== 静态资源 ==========
app.use(express.static(path.join(__dirname, '../')));

// ========== 错误处理 ==========
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ success: false, message: 'CSRF校验失败' });
  }
  res.status(500).json({ success: false, message: err.message || '服务器错误' });
});

// ========== 启动 ==========
const server = http.createServer(app);
const io = socketio(server, {
  cors: { origin: true, credentials: true }
});

// ...Socket.IO 相关逻辑...

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Qianxian backend running on port ${PORT}`);
});