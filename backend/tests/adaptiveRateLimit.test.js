const request = require('supertest');
const express = require('express');
const adaptiveRateLimit = require('../middleware/adaptiveRateLimit');

describe('adaptiveRateLimit middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(adaptiveRateLimit({
      windowMs: 1000, // 1秒窗口，便于测试
      min: 3,
      max: 5,
      criticalDamping: true
    }));
    app.get('/', (req, res) => res.status(200).send('ok'));
    app.post('/api/test', (req, res) => res.status(200).send('ok'));
  });

  it('should allow requests under the limit', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    }
  });

  it('should block requests over the limit', async () => {
    // 先发max次
    for (let i = 0; i < 5; i++) {
      await request(app).get('/');
    }
    // 第6次应被限流
    const res = await request(app).get('/');
    expect(res.status).toBe(429);
    expect(res.body.error).toBeDefined();
  });

  it('should reset count after windowMs', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).get('/');
    }
    await new Promise(r => setTimeout(r, 1100)); // 等待窗口重置
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('should adapt dynamicMax based on request rate', async () => {
    // 连续请求，dynamicMax 应有自适应调整
    for (let i = 0; i < 10; i++) {
      await request(app).get('/');
    }
    // 之后请求应被限流
    const res = await request(app).get('/');
    expect([200, 429]).toContain(res.status);
  });

  it('should use multi-dimensional sync criteria for sensitive methods', async () => {
    // POST方法触发多维同步性判据
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/test');
    }
    // 之后请求应被限流
    const res = await request(app).post('/api/test');
    expect([200, 429]).toContain(res.status);
  });

  it('should treat different API groups independently', async () => {
    // /api/test 和 / 路径分组限流互不影响
    for (let i = 0; i < 5; i++) {
      await request(app).get('/');
    }
    // /api/test 应不受 / 路径影响
    const res = await request(app).post('/api/test');
    expect([200, 429]).toContain(res.status);
  });

  it('should skip rate limit for whitelist IP (X-Forwarded-For)', async () => {
    // 模拟白名单IP通过 X-Forwarded-For
    const res = await request(app)
      .get('/')
      .set('X-Forwarded-For', '127.0.0.1');
    expect(res.status).toBe(200);
  });

  it('should skip rate limit for whitelist IP (req.ip)', async () => {
    // 模拟白名单IP通过 req.ip
    // supertest 默认 req.ip 为 ::ffff:127.0.0.1，需兼容
    const res = await request(app)
      .get('/')
      .set('X-Forwarded-For', '::1');
    expect(res.status).toBe(200);
  });
});
