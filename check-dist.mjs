import fs from 'fs';

// 读取编译后的文件
const distCode = fs.readFileSync('dist/assets/schema-BHGgUBAH.js', 'utf-8');

// 查找 parseMySQLSchema 函数的开始位置
const funcStart = distCode.indexOf('function H(l)');
if (funcStart === -1) {
  console.log('未找到 parseMySQLSchema 函数');
  process.exit(1);
}

// 提取函数代码（大约前2000个字符）
const funcCode = distCode.substring(funcStart, funcStart + 2000);

console.log('=== 编译后的 parseMySQLSchema 函数代码片段 ===');
console.log(funcCode);

// 检查正则表达式
const regexMatches = funcCode.match(/\/[^\/]+\/[gi]*/g);
console.log('\n=== 找到的正则表达式 ===');
regexMatches?.forEach((r, i) => {
  console.log(`${i + 1}. ${r}`);
});

// 检查 COMMENT 匹配
const commentMatches = funcCode.match(/COMMENT[^}]{0,80}/g);
console.log('\n=== COMMENT 相关代码 ===');
commentMatches?.forEach((c, i) => {
  console.log(`${i + 1}. ${c}`);
});
