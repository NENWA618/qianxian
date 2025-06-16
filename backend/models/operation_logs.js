/**
 * 操作日志表模型
 * 记录用户的关键操作，便于审计和追踪
 */

const { DataTypes } = require("sequelize");
const sequelize = require("../db");

/**
 * operation_logs 表结构
 * - id: 主键
 * - user_id: 操作用户ID
 * - username: 操作用户名（冗余，便于查询）
 * - action: 操作类型（如 login、register、edit_content、set_admin 等）
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
      allowNull: false
    },
    username: {
      type: DataTypes.STRING(32),
      allowNull: false
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

module.exports = OperationLog;