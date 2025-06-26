/**
 * 操作日志归档与清理脚本
 * 用于定期归档并清理 operation_logs 表中过期日志，防止表无限增长
 * 可通过定时任务（如 cron）调用
 * 支持按通道/模式分组归档
 * 新增：归档前统计日志量，归档后输出详细信息
 * 2025-06-26 优化：支持按多维判据、实验参数、EEG映射、Ncrit递归终止等日志归档
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

  // 可选：按action类型归档（如 node scripts/archive_logs.js 30 null rate_limit）
  const actionType = process.argv[4] || null;

  // 可选：多维判据归档（如 node scripts/archive_logs.js 30 null null '{"detail.fractal_dimension":{"$exists":true}}'）
  let multiCriteria = null;
  if (process.argv[5]) {
    try {
      multiCriteria = JSON.parse(process.argv[5]);
    } catch (e) {
      console.error('[归档日志] 多维判据参数解析失败:', e.message);
      process.exit(1);
    }
  }

  // 可选：递归终止判据Ncrit（如 node scripts/archive_logs.js 30 null null null 5）
  const ncritLimit = process.argv[6] ? parseInt(process.argv[6], 10) : null;

  try {
    await sequelize.authenticate();

    // 归档前统计
    let countSql = `SELECT COUNT(*) AS cnt FROM operation_logs WHERE created_at < $1`;
    let params = [beforeDate];
    let paramIdx = 2;
    if (channel_mode) {
      countSql += ` AND channel_mode = $${paramIdx++}`;
      params.push(channel_mode);
    }
    if (actionType) {
      countSql += ` AND action = $${paramIdx++}`;
      params.push(actionType);
    }
    // 多维判据和Ncrit归档统计（仅支持简单JSON字段判据）
    if (multiCriteria && typeof multiCriteria === "object") {
      for (const k in multiCriteria) {
        countSql += ` AND detail::jsonb ? '${k.split('.').pop()}'`;
      }
    }
    if (ncritLimit !== null) {
      countSql += ` AND (detail::jsonb->>'ncrit')::int >= $${paramIdx++}`;
      params.push(ncritLimit);
    }
    const [countResult] = await sequelize.query(countSql, params);
    const totalToDelete = countResult[0]?.cnt || 0;

    // 归档与清理
    // archiveAndCleanLogs 只支持 channel_mode，若需按action/多维判据/Ncrit扩展可在此实现
    let deleted = 0;
    if (!actionType && !multiCriteria && ncritLimit === null) {
      deleted = await archiveAndCleanLogs(beforeDate, channel_mode);
    } else {
      // 按action类型、多维判据、Ncrit归档
      const { Op } = require('sequelize');
      const OperationLog = require('../models/operation_logs');
      const where = {
        created_at: { [Op.lt]: beforeDate }
      };
      if (actionType) where.action = actionType;
      if (channel_mode) where.channel_mode = channel_mode;
      if (multiCriteria && typeof multiCriteria === "object") {
        for (const k in multiCriteria) {
          // 仅支持简单JSON字段存在判据
          where[`detail`] = { [Op.like]: `%${k.split('.').pop()}%` };
        }
      }
      if (ncritLimit !== null) {
        // 仅支持detail中ncrit字段大于等于ncritLimit的日志
        // 这里简单用like，生产建议用jsonb查询
        where.detail = where.detail || {};
        where.detail[Op.like] = `%ncrit%${ncritLimit}%`;
      }
      deleted = await OperationLog.destroy({ where });
    }

    if (channel_mode && actionType) {
      console.log(`[归档日志] 计划清理 ${totalToDelete} 条，实际已清理 ${deleted} 条 ${days} 天前、通道/模式为 ${channel_mode}、类型为 ${actionType} 的操作日志`);
    } else if (channel_mode) {
      console.log(`[归档日志] 计划清理 ${totalToDelete} 条，实际已清理 ${deleted} 条 ${days} 天前、通道/模式为 ${channel_mode} 的操作日志`);
    } else if (actionType) {
      console.log(`[归档日志] 计划清理 ${totalToDelete} 条，实际已清理 ${deleted} 条 ${days} 天前、类型为 ${actionType} 的操作日志`);
    } else if (multiCriteria) {
      console.log(`[归档日志] 计划清理 ${totalToDelete} 条，实际已清理 ${deleted} 条 ${days} 天前、满足多维判据的操作日志`);
    } else if (ncritLimit !== null) {
      console.log(`[归档日志] 计划清理 ${totalToDelete} 条，实际已清理 ${deleted} 条 ${days} 天前、Ncrit >= ${ncritLimit} 的操作日志`);
    } else {
      console.log(`[归档日志] 计划清理 ${totalToDelete} 条，实际已清理 ${deleted} 条 ${days} 天前的操作日志`);
    }
    process.exit(0);
  } catch (err) {
    console.error('[归档日志] 归档失败:', err);
    process.exit(1);
  }
}

main();