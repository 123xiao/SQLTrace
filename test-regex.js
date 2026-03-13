// 测试正则表达式
const testSQL = `CREATE TABLE test_table (
  \`id\` int(11) COMMENT '主键ID',
  \`name\` varchar(50) COMMENT '名称'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='测试表';`;

// 源代码中的正则（带 i 标志）
const regex1 = /COMMENT\s+'([^']+)'/i;
const match1 = testSQL.match(regex1);
console.log('带 i 标志的匹配结果:', match1 ? match1[1] : '未匹配');

// 测试字段行
const line = "`id` int(11) COMMENT '主键ID',";
const match2 = line.match(/COMMENT\s+'([^']+)'/i);
console.log('字段行匹配结果:', match2 ? match2[1] : '未匹配');

// 测试表注释
const tableMeta = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='测试表';";
const match3 = tableMeta.match(/COMMENT\s*=\s*'([^']+)'/i);
console.log('表注释匹配结果:', match3 ? match3[1] : '未匹配');
