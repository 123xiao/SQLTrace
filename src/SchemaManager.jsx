import { useState, useMemo, useEffect } from "react";

// MySQL 表结构解析器
function parseMySQLSchema(sqlText) {
  const tables = {};

  // 匹配 CREATE TABLE 语句
  const tableRegex = /CREATE TABLE\s+`?(\w+)`?\s*\(([\s\S]*?)\)\s*(ENGINE[\s\S]*?);/gi;

  let match;
  while ((match = tableRegex.exec(sqlText)) !== null) {
    const tableName = match[1];
    const fieldsBlock = match[2];
    const tableMetadata = match[3];

    // 从 tableMetadata 中提取 COMMENT
    let tableComment = '';
    const commentMatch = tableMetadata.match(/COMMENT\s*=\s*'([^']+)'/i);
    if (commentMatch) {
      tableComment = commentMatch[1];
    }

    const fields = {};

    // 匹配字段定义
    const lines = fieldsBlock.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();

      // 跳过主键、索引等非字段定义行
      if (trimmedLine.startsWith('PRIMARY KEY') ||
          trimmedLine.startsWith('UNIQUE INDEX') ||
          trimmedLine.startsWith('INDEX') ||
          trimmedLine.startsWith('KEY') ||
          trimmedLine.startsWith('CONSTRAINT') ||
          !trimmedLine.startsWith('`')) {
        continue;
      }

      // 匹配字段：`字段名` 类型
      const fieldMatch = trimmedLine.match(/`(\w+)`\s+([^\s]+(?:\([^)]+\))?)/i);

      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const fieldType = fieldMatch[2];

        // 单独提取 COMMENT
        let fieldComment = '';
        const commentMatch = trimmedLine.match(/COMMENT\s+'([^']+)'/i);
        if (commentMatch) {
          fieldComment = commentMatch[1];
        }

        // 检查是否是主键
        const isPrimary = new RegExp(`PRIMARY KEY.*?\\(\`?${fieldName}\`?\\)`, 'i').test(fieldsBlock);

        fields[fieldName.toLowerCase()] = {
          type: fieldType,
          comment: fieldComment,
          isPrimary
        };
      }
    }

    tables[tableName.toUpperCase()] = {
      name: tableName,
      comment: tableComment,
      fields
    };
  }

  return tables;
}

export default function SchemaManager() {
  const [dbSchema, setDbSchema] = useState(() => {
    const saved = localStorage.getItem("dbSchema");
    return saved ? JSON.parse(saved) : null;
  });
  const [selectedSchemaTable, setSelectedSchemaTable] = useState(null);
  const [tableDetailModal, setTableDetailModal] = useState(null);
  const [fieldSearch, setFieldSearch] = useState("");
  const [analyzedFieldSearch, setAnalyzedFieldSearch] = useState("");
  const [sqlToAnalyze, setSqlToAnalyze] = useState("");
  const [analyzedSql, setAnalyzedSql] = useState(null);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("ALL");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "dark";
  });

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  // 处理表结构文件上传
  const handleSchemaFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const schema = parseMySQLSchema(text);
      setDbSchema(schema);
      localStorage.setItem("dbSchema", JSON.stringify(schema));
    };
    reader.readAsText(file);
  };

  // 解析 SQL 语句
  const parseSqlForSchema = (sql) => {
    if (!dbSchema || !sql) return { tables: [], fields: [] };

    const result = { tables: [], fields: [] };
    const sqlUpper = sql.toUpperCase();

    // 使用正则表达式提取表名（支持 FROM, JOIN, UPDATE, INSERT INTO, DELETE FROM）
    const tablePattern = /(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
    const matches = [...sql.matchAll(tablePattern)];
    const foundTables = new Set();

    matches.forEach(match => {
      const tableName = match[1].toUpperCase();
      if (dbSchema[tableName] && !foundTables.has(tableName)) {
        foundTables.add(tableName);
        const table = dbSchema[tableName];
        result.tables.push({
          name: tableName,
          comment: table.comment
        });

        // 提取该表相关的字段
        Object.entries(table.fields).forEach(([fieldName, fieldInfo]) => {
          if (sql.toLowerCase().includes(fieldName)) {
            result.fields.push({
              table: tableName,
              field: fieldName,
              type: fieldInfo.type,
              comment: fieldInfo.comment
            });
          }
        });
      }
    });

    return result;
  };

  const handleAnalyzeSql = () => {
    if (!sqlToAnalyze.trim()) {
      return;
    }

    const result = parseSqlForSchema(sqlToAnalyze);
    setAnalyzedSql(result);
  };

  // 为 SQL 添加悬停提示的渲染函数
  const renderSqlWithTooltips = (sql) => {
    if (!dbSchema || !sql) return sql;

    // SQL 关键字列表（不需要提示）
    const sqlKeywords = new Set([
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'SET',
      'VALUES', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL',
      'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT',
      'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'DISTINCT', 'COUNT', 'SUM',
      'AVG', 'MAX', 'MIN', 'ASC', 'DESC'
    ]);

    // 分词并添加提示
    const tokens = [];
    const regex = /(\b\w+\b|[^\w\s]+|\s+)/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(sql)) !== null) {
      const token = match[1];
      const tokenLower = token.toLowerCase();
      const tokenUpper = token.toUpperCase();

      // 检查是否是表名
      const table = dbSchema[tokenUpper];
      if (table && table.comment && !sqlKeywords.has(tokenUpper)) {
        tokens.push(
          <span key={lastIndex} className="sql-tooltip">
            {token}
            <span className="tooltip-content">{table.comment}</span>
          </span>
        );
        lastIndex = match.index + token.length;
        continue;
      }

      // 检查是否是字段名（遍历所有表）
      let fieldFound = false;
      if (!sqlKeywords.has(tokenUpper)) {
        for (const [tableName, tableInfo] of Object.entries(dbSchema)) {
          if (tableInfo.fields && tableInfo.fields[tokenLower]) {
            const field = tableInfo.fields[tokenLower];
            if (field.comment) {
              tokens.push(
                <span key={lastIndex} className="sql-tooltip">
                  {token}
                  <span className="tooltip-content">{field.comment}</span>
                </span>
              );
              fieldFound = true;
              break;
            }
          }
        }
      }

      if (!fieldFound) {
        tokens.push(token);
      }
      lastIndex = match.index + token.length;
    }

    return <>{tokens}</>;
  };

  const schemaTableList = useMemo(() => {
    if (!dbSchema) return { groups: {}, ungrouped: [], allGroups: [] };

    const allTables = Object.entries(dbSchema).map(([tableName, tableInfo]) => ({
      name: tableName,
      comment: tableInfo.comment,
      fieldCount: Object.keys(tableInfo.fields).length
    }));

    // 过滤搜索
    const filteredTables = schemaSearch
      ? allTables.filter(table =>
          table.name.toLowerCase().includes(schemaSearch.toLowerCase()) ||
          (table.comment && table.comment.includes(schemaSearch))
        )
      : allTables;

    // 按前缀分组
    const groups = {};
    const ungrouped = [];

    filteredTables.forEach(table => {
      // 提取前缀（第一个下划线之前的部分）
      const match = table.name.match(/^([A-Z]+)_/);
      if (match) {
        const prefix = match[1];
        if (!groups[prefix]) {
          groups[prefix] = [];
        }
        groups[prefix].push(table);
      } else {
        ungrouped.push(table);
      }
    });

    // 获取所有分组名称
    const allGroups = Object.keys(groups).sort();

    // 根据选中的分组过滤
    let filteredGroups = groups;
    let filteredUngrouped = ungrouped;

    if (selectedGroup !== "ALL") {
      if (selectedGroup === "OTHER") {
        filteredGroups = {};
      } else {
        filteredGroups = { [selectedGroup]: groups[selectedGroup] || [] };
        filteredUngrouped = [];
      }
    }

    return { groups: filteredGroups, ungrouped: filteredUngrouped, allGroups };
  }, [dbSchema, schemaSearch, selectedGroup]);

  return (
    <div className="schema-manager-page">
      <section className="header">
        <div className="title-block">
          <div className="title-row">
            <img src="/logo.svg" alt="Logo" className="app-logo" />
            <h1>表结构管理</h1>
            <a href="https://github.com/123xiao" target="_blank" rel="noopener noreferrer" className="github-link" title="GitHub">
              <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
            </a>
          </div>
          <p>上传 MySQL 表结构文件，解析表和字段注释，辅助 SQL 分析。</p>
        </div>
        <div className="badges">
          <button className="theme-toggle" onClick={toggleTheme} title="切换主题">
            {theme === "dark" ? "☀️ 亮色" : "🌙 暗色"}
          </button>
          <button className="back-button" onClick={() => window.location.href = './index.html'}>← 返回首页</button>
        </div>
      </section>

      {dbSchema && (
        <nav className="page-nav">
          <a href="#schema-stats" className="nav-link">统计信息</a>
          <a href="#table-list" className="nav-link">表列表</a>
          <a href="#sql-parser" className="nav-link">SQL 解析</a>
        </nav>
      )}

      {!dbSchema && (
        <section className="card" id="upload-schema">
          <h2>上传表结构文件</h2>
          <div className="control-group">
            <label className="label">选择 SQL 文件（CREATE TABLE 语句）</label>
            <input
              type="file"
              accept=".sql,.txt"
              onChange={(e) => handleSchemaFile(e.target.files[0])}
            />
            <p className="hint">支持 MySQL CREATE TABLE 语句，用于解析表和字段注释</p>
          </div>
        </section>
      )}

      {dbSchema && (
        <>
          <section className="card" id="schema-stats">
            <div className="schema-stats">
              <p>✓ 已加载 {Object.keys(dbSchema).length} 个表的结构定义</p>
              <button
                className="secondary"
                onClick={() => {
                  setDbSchema(null);
                  localStorage.removeItem("dbSchema");
                  setSelectedSchemaTable(null);
                  setAnalyzedSql(null);
                }}
              >
                清除表结构
              </button>
            </div>
          </section>

          <section className="card" id="table-list">
            <h2>表列表</h2>
            <div className="control-group">
              <label className="label">分组筛选</label>
              <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}>
                <option value="ALL">全部分组</option>
                {schemaTableList.allGroups.map(group => (
                  <option key={group} value={group}>{group} ({dbSchema && Object.keys(dbSchema).filter(t => t.startsWith(group + '_')).length})</option>
                ))}
                {schemaTableList.ungrouped.length > 0 && (
                  <option value="OTHER">其他 ({schemaTableList.ungrouped.length})</option>
                )}
              </select>
            </div>
            <div className="control-group">
              <label className="label">搜索表名或注释</label>
              <input
                type="text"
                placeholder="输入表名或注释关键词..."
                value={schemaSearch}
                onChange={(e) => setSchemaSearch(e.target.value)}
              />
            </div>
            <div className="schema-table-list">
              {Object.entries(schemaTableList.groups).sort(([a], [b]) => a.localeCompare(b)).map(([prefix, tables]) => (
                <div key={prefix} className="table-group">
                  <h3 className="table-group-title">{prefix} ({tables.length})</h3>
                  {tables.map((table) => (
                    <div
                      key={table.name}
                      className="schema-table-item"
                      onClick={() => setTableDetailModal(table.name)}
                    >
                      <div className="schema-table-header">
                        <span className="schema-table-name">{table.name}</span>
                        <span className="schema-field-count">{table.fieldCount} 个字段</span>
                      </div>
                      {table.comment && <div className="schema-table-desc">{table.comment}</div>}
                    </div>
                  ))}
                </div>
              ))}

              {schemaTableList.ungrouped.length > 0 && (
                <div className="table-group">
                  <h3 className="table-group-title">其他 ({schemaTableList.ungrouped.length})</h3>
                  {schemaTableList.ungrouped.map((table) => (
                    <div
                      key={table.name}
                      className="schema-table-item"
                      onClick={() => setTableDetailModal(table.name)}
                    >
                      <div className="schema-table-header">
                        <span className="schema-table-name">{table.name}</span>
                        <span className="schema-field-count">{table.fieldCount} 个字段</span>
                      </div>
                      {table.comment && <div className="schema-table-desc">{table.comment}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="card" id="sql-parser">
            <h2>SQL 解析</h2>
            <div className="control-group">
              <label className="label">粘贴 SQL 语句</label>
              <textarea
                placeholder="粘贴 SQL 语句，自动识别表和字段含义..."
                value={sqlToAnalyze}
                onChange={(e) => setSqlToAnalyze(e.target.value)}
                rows={6}
              />
            </div>
            <div className="button-row">
              <button onClick={handleAnalyzeSql}>解析 SQL</button>
              <button className="secondary" onClick={() => { setSqlToAnalyze(""); setAnalyzedSql(null); }}>清空</button>
            </div>

            {analyzedSql && (
              <div className="sql-analysis-result">
                <div className="analysis-section">
                  <h4>SQL 语句（悬停查看注释）</h4>
                  <div className="analysis-sql-display">
                    {renderSqlWithTooltips(sqlToAnalyze)}
                  </div>
                </div>

                {analyzedSql.tables.length > 0 && (
                  <div className="analysis-section">
                    <h4>涉及的表 ({analyzedSql.tables.length})</h4>
                    <div className="analysis-tables">
                      {analyzedSql.tables.map((table, idx) => (
                        <div key={idx} className="analysis-table-item">
                          <span className="analysis-table-name">{table.name}</span>
                          {table.comment && <span className="analysis-table-comment">({table.comment})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {analyzedSql.fields.length > 0 && (
                  <div className="analysis-section">
                    <h4>涉及的字段 ({analyzedSql.fields.length})</h4>
                    <div className="control-group">
                      <input
                        type="text"
                        placeholder="搜索字段名或说明..."
                        value={analyzedFieldSearch}
                        onChange={(e) => setAnalyzedFieldSearch(e.target.value)}
                        style={{ marginBottom: '12px' }}
                      />
                    </div>
                    <div className="analysis-fields">
                      {analyzedSql.fields
                        .filter(field => {
                          if (!analyzedFieldSearch) return true;
                          const searchLower = analyzedFieldSearch.toLowerCase();
                          return field.field.toLowerCase().includes(searchLower) ||
                                 (field.comment && field.comment.includes(analyzedFieldSearch));
                        })
                        .map((field, idx) => {
                          const isHighlight = analyzedFieldSearch && (
                            field.field.toLowerCase().includes(analyzedFieldSearch.toLowerCase()) ||
                            (field.comment && field.comment.includes(analyzedFieldSearch))
                          );
                          return (
                            <div key={idx} className={`analysis-field-item ${isHighlight ? 'highlight-field' : ''}`}>
                              <span className="analysis-field-table">{field.table}.</span>
                              <span className="analysis-field-name">{field.field}</span>
                              <span className="analysis-field-type">({field.type})</span>
                              {field.comment && <span className="analysis-field-comment">- {field.comment}</span>}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {analyzedSql.tables.length === 0 && analyzedSql.fields.length === 0 && (
                  <p className="no-analysis-result">未识别到相关的表或字段</p>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {showBackToTop && (
        <button className="back-to-top" onClick={scrollToTop} title="回到顶部">
          ↑
        </button>
      )}

      {tableDetailModal && (
        <div className="modal-overlay" onClick={() => { setTableDetailModal(null); setFieldSearch(""); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{tableDetailModal}</h3>
              <button className="modal-close" onClick={() => { setTableDetailModal(null); setFieldSearch(""); }}>✕</button>
            </div>
            <div className="modal-body">
              {dbSchema[tableDetailModal].comment && (
                <div className="table-comment-section">
                  <strong>表说明：</strong>{dbSchema[tableDetailModal].comment}
                </div>
              )}
              <div className="control-group">
                <input
                  type="text"
                  placeholder="搜索字段名或说明..."
                  value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                  style={{ marginBottom: '12px' }}
                />
              </div>
              <table className="schema-fields-table">
                <thead>
                  <tr>
                    <th>字段名</th>
                    <th>类型</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(dbSchema[tableDetailModal].fields)
                    .filter(([fieldName, fieldInfo]) => {
                      if (!fieldSearch) return true;
                      const searchLower = fieldSearch.toLowerCase();
                      return fieldName.toLowerCase().includes(searchLower) ||
                             (fieldInfo.comment && fieldInfo.comment.includes(fieldSearch));
                    })
                    .map(([fieldName, fieldInfo]) => {
                      const isHighlight = fieldSearch && (
                        fieldName.toLowerCase().includes(fieldSearch.toLowerCase()) ||
                        (fieldInfo.comment && fieldInfo.comment.includes(fieldSearch))
                      );
                      return (
                        <tr key={fieldName} className={isHighlight ? "highlight-row" : ""}>
                          <td>
                            <span className="field-name">{fieldName}</span>
                            {fieldInfo.isPrimary && <span className="primary-key-badge">PK</span>}
                          </td>
                          <td className="field-type">{fieldInfo.type}</td>
                          <td className="field-desc">{fieldInfo.comment || '-'}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="secondary" onClick={() => { setTableDetailModal(null); setFieldSearch(""); }}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        <div className="footer-content">
          <div className="footer-left">
            <p className="footer-title">日志执行链路可视化工具</p>
            <p className="footer-desc">开源、免费、本地化的日志分析解决方案</p>
          </div>
          <div className="footer-right">
            <a href="https://github.com/123xiao" target="_blank" rel="noopener noreferrer" className="footer-link">
              GitHub
            </a>
            <span className="footer-divider">·</span>
            <span className="footer-license">MIT License</span>
            <span className="footer-divider">·</span>
            <span className="footer-year">© 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
