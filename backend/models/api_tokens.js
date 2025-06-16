/**
 * API Token 表模型
 * 用于存储和管理用户的 API Token（如第三方集成、自动化等场景）
 */

const { DataTypes } = require("sequelize");
const sequelize = require("../db");

/**
 * api_tokens 表结构
 * - id: 主键
 * - user_id: 关联用户ID
 * - token: Token字符串（唯一）
 * - description: 用途描述
 * - created_at: 创建时间
 * - expired_at: 过期时间（可选）
 * - is_active: 是否有效
 */
const ApiToken = sequelize.define(
  "api_tokens",
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
    token: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true
    },
    description: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    expired_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  },
  {
    tableName: "api_tokens",
    timestamps: false,
    indexes: [
      { fields: ["user_id"] },
      { fields: ["token"] },
      { fields: ["is_active"] }
    ]
  }
);

module.exports = ApiToken;
