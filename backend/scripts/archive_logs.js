/**
 * 操作日志归档与清理脚本
 * 用于定期归档并清理 operation_logs 表中过期日志，防止表无限增长
 * 可通过定时任务（如 cron）调用
 * 支持按通道/模式分组归档
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const sequelize = require('../db');
const { archiveAndCleanLogs } = require('../models/operation_logs');

async function main() {
  // 归档N天前的日志，默认30天
  const days = process.argv[2] ? parseInt(process.argv[2], 10) : 30;
  const beforeDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 可选：按通道/模式分组归档（如 node scripts/archive_logs.js 30 user_day_chat）
  const channel_mode = process.argv[3] || null;

  try {
    await sequelize.authenticate();
    const deleted = await archiveAndCleanLogs(beforeDate, channel_mode);
    if (channel_mode) {
      console.log(`[归档日志] 已清理 ${deleted} 条 ${days} 天前、通道/模式为 ${channel_mode} 的操作日志`);
    } else {
      console.log(`[归档日志] 已清理 ${deleted} 条 ${days} 天前的操作日志`);
    }
    process.exit(0);
  } catch (err) {
    console.error('[归档日志] 归档失败:', err);
    process.exit(1);
  }
}

main();