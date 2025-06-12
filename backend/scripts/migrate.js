require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`);
    console.log('字段 is_admin 添加成功或已存在');
  } catch (err) {
    console.error('添加字段失败:', err.message);
  } finally {
    await pool.end();
  }
})();
