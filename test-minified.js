// 模拟编译后的代码逻辑
function parseMySQLSchema(l) {
  const C = {};
  const M = /CREATE TABLE\s+`?(\w+)`?\s*\(([\s\S]*?)\)\s*(ENGINE[\s\S]*?);/gi;
  let y;
  
  const testSQL = `CREATE TABLE test_table (
  \`id\` int(11) COMMENT '主键ID',
  \`name\` varchar(50) COMMENT '名称'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='测试表';`;
  
  while ((y = M.exec(testSQL)) !== null) {
    const N = y[1];
    const g = y[2];
    const u = y[3];
    
    console.log('表名:', N);
    console.log('字段块:', g);
    console.log('元数据:', u);
    
    // 表注释
    let b = "";
    const d = u.match(/COMMENT\s*=\s*'([^']+)'/i);
    if (d) {
      b = d[1];
    }
    console.log('表注释:', b);
    
    // 字段解析
    const E = g.split('\n');
    for (const w of E) {
      const n = w.trim();
      if (!n.startsWith('`')) continue;
      
      const S = n.match(/`(\w+)`\s+([^\s]+(?:\([^)]+\))?)/i);
      if (S) {
        const fieldName = S[1];
        const fieldType = S[2];
        
        // 字段注释
        let x = "";
        const k = n.match(/COMMENT\s+'([^']+)'/i);
        if (k) {
          x = k[1];
        }
        console.log(`字段 ${fieldName}: 类型=${fieldType}, 注释=${x}`);
      }
    }
  }
}

parseMySQLSchema();
