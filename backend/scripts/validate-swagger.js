/**
 * swagger.yaml 自动校验脚本
 * 校验 OpenAPI 文档格式与规范，便于接口变更后自动检测文档一致性
 * 可集成到 CI/CD 流程
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const SwaggerParser = require('@apidevtools/swagger-parser');

async function main() {
  const swaggerPath = path.resolve(__dirname, '../swagger.yaml');
  if (!fs.existsSync(swaggerPath)) {
    console.error('[Swagger校验] swagger.yaml 文件不存在');
    process.exit(1);
  }

  try {
    const doc = yaml.load(fs.readFileSync(swaggerPath, 'utf8'));
    await SwaggerParser.validate(doc);
    console.log('[Swagger校验] swagger.yaml 格式与规范校验通过');
    process.exit(0);
  } catch (err) {
    console.error('[Swagger校验] swagger.yaml 校验失败:', err.message);
    process.exit(1);
  }
}

main();
