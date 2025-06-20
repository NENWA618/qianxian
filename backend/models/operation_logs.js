/**
 * 操作日志表模型
 * 记录用户的关键操作，便于审计和追踪
 * 增强：支持记录限流、缓存命中/失效、批量任务等系统事件
 * 新增：导出 logOperation 通用日志写入函数，便于全局调用
 */

const { DataTypes } = require("sequelize");
const sequelize = require("../db");

/**
 * operation_logs 表结构
 * - id: 主键
 * - user_id: 操作用户ID（系统事件可为0）
 * - username: 操作用户名（冗余，便于查询，系统事件可为 'system'）
 * - action: 操作类型（如 login、register、edit_content、set_admin、rate_limit、cache_hit、cache_miss、batch_task 等）
 * - detail: 操作详情（JSON字符串或文本）
 * - ip: 操作IP
 * - created_at: 操作时间
 */
const OperationLog = sequelize.define(
  "operation_logs",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0 // 系统事件为0
    },
    username: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'system'
    },
    action: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    detail: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ip: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "operation_logs",
    timestamps: false,
    indexes: [
      { fields: ["user_id"] },
      { fields: ["action"] },
      { fields: ["created_at"] }
    ]
  }
);

/**
 * 通用操作日志写入函数
 * @param {object} param0
 * @param {number} [param0.user_id] 操作用户ID
 * @param {string} [param0.username] 操作用户名
 * @param {string} param0.action 操作类型
 * @param {string} [param0.detail] 操作详情
 * @param {string} [param0.ip] 操作IP
 * @returns {Promise<void>}
 */
async function logOperation({ user_id = 0, username = 'system', action, detail = '', ip = '' }) {
  try {
    await OperationLog.create({
      user_id,
      username,
      action,
      detail,
      ip,
      created_at: new Date()
    });
  } catch (err) {
    // 日志写入失败不抛出，仅打印
    console.error('操作日志写入失败:', err);
  }
}

module.exports = OperationLog;
module.exports.logOperation