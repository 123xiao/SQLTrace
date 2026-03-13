import fs from 'fs';

// 从编译后的文件中提取 parseMySQLSchema 函数
const distCode = fs.readFileSync('dist/assets/schema-BHGgUBAH.js', 'utf-8');

// 提取函数 H (parseMySQLSchema)
const funcMatch = distCode.match(/function H\(l\)\{[^}]+\{[^}]+\}+return C\}/);
if (!funcMatch) {
  console.log('无法提取函数');
  process.exit(1);
}

// 创建测试环境
const testCode = `
${funcMatch[0]}

// 测试 SQL
const testSQL = \`CREATE TABLE test_table (
  \\`id\\` int(11) COMMENT '主键ID',
  \\`name\\` varchar(50) COMMENT '名称'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='测试表';\`;

const result = H(testSQL);
console.log('解析结果:', JSON.stringify(result, null, 2));
`;

// 写入临时文件并执行
fs.writeFileSync('temp-test.mjs', testCode);
