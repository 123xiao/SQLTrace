import { useMemo, useState, useEffect } from "react";

// 日志格式配置
const LOG_FORMATS = {
  CUSTOM: {
    name: "自定义格式",
    regex: /^(\d+):(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[([^\]]+)\]\s+([A-Z]+)\|\s*([^|]+)\|\s*(.*)$/,
    groups: { seq: 1, time: 2, traceId: 3, level: 4, logger: 5, message: 6 }
  },
  SPRING_BOOT: {
    name: "Spring Boot",
    regex: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+([A-Z]+)\s+\[([^\]]+)\]\s+([^\s]+)\s+:\s*(.*)$/,
    groups: { time: 1, level: 2, traceId: 3, logger: 4, message: 5 }
  },
  LOGBACK: {
    name: "Logback",
    regex: /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+\[([^\]]+)\]\s+([A-Z]+)\s+([^\s]+)\s+-\s*(.*)$/,
    groups: { time: 1, traceId: 2, level: 3, logger: 4, message: 5 }
  },
  SIMPLE: {
    name: "简单格式",
    regex: /^\[([A-Z]+)\]\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+-\s*(.*)$/,
    groups: { level: 1, time: 2, message: 3 }
  },
  SMART: {
    name: "智能识别 (推荐)",
    regex: null,
    smart: true
  },
  AUTO: {
    name: "自动识别",
    regex: null
  }
};

const SQL_PREPARE = /Preparing:\s*(.*)$/i;
const SQL_PARAMS = /Parameters:\s*(.*)$/i;

const SQL_OPS = ["SELECT", "INSERT", "UPDATE", "DELETE"];

// 智能提取日志字段（不依赖严格格式）
function smartExtractFields(line) {
  const result = {
    time: null,
    traceId: null,
    level: null,
    logger: null,
    message: line
  };

  // 提取时间戳（多种格式）
  const timePatterns = [
    /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/,
    /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
    /(\d{2}:\d{2}:\d{2}\.\d{3})/,
    /(\d{2}:\d{2}:\d{2})/
  ];

  for (const pattern of timePatterns) {
    const match = line.match(pattern);
    if (match) {
      result.time = match[1];
      break;
    }
  }

  // 提取日志级别
  const levelMatch = line.match(/\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/);
  if (levelMatch) {
    result.level = levelMatch[1];
  }

  // 提取 traceId（方括号内的内容，通常是线程名或traceId）
  const traceMatch = line.match(/\[([^\]]+)\]/);
  if (traceMatch) {
    result.traceId = traceMatch[1];
  }

  // 提取 logger（通常是包名或类名）
  const loggerMatch = line.match(/([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)\s*[:|-]/);
  if (loggerMatch) {
    result.logger = loggerMatch[1];
  }

  // 提取消息（去掉前面的元数据）
  let message = line;
  if (result.time) {
    message = message.replace(result.time, '').trim();
  }
  if (result.level) {
    message = message.replace(result.level, '').trim();
  }
  if (result.traceId) {
    message = message.replace(`[${result.traceId}]`, '').trim();
  }
  if (result.logger) {
    message = message.replace(result.logger, '').trim();
  }
  message = message.replace(/^[:|-]\s*/, '').trim();

  result.message = message || line;

  return result;
}

// 自动检测日志格式
function detectLogFormat(lines) {
  const sampleSize = Math.min(10, lines.length);
  const samples = lines.slice(0, sampleSize);

  const scores = {};

  Object.entries(LOG_FORMATS).forEach(([key, format]) => {
    if (key === "AUTO" || key === "SMART" || !format.regex) return;

    let matchCount = 0;
    samples.forEach(line => {
      if (format.regex.test(line)) {
        matchCount++;
      }
    });

    scores[key] = matchCount / sampleSize;
  });

  const bestMatch = Object.entries(scores).reduce((best, [key, score]) => {
    return score > best.score ? { key, score } : best;
  }, { key: "SMART", score: 0 });

  // 如果没有格式匹配度超过50%，使用智能识别
  return bestMatch.score > 0.5 ? bestMatch.key : "SMART";
}

function splitParams(raw) {
  const result = [];
  let current = "";
  let inQuote = false;
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const prev = raw[i - 1];

    if (ch === '"' && prev !== "\\") {
      inQuote = !inQuote;
    }

    if (!inQuote) {
      if (ch === "(") depthParen += 1;
      if (ch === ")") depthParen = Math.max(0, depthParen - 1);
      if (ch === "{") depthBrace += 1;
      if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
      if (ch === "[") depthBracket += 1;
      if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
    }

    if (ch === "," && !inQuote && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

function parseParamToken(token) {
  const match = token.match(/^(.*)\(([^()]*)\)$/);
  if (!match) {
    return { value: token.trim(), type: "" };
  }
  return { value: match[1].trim(), type: match[2].trim() };
}

function formatParamValue(value, type) {
  const val = value.trim();
  if (!val || val.toLowerCase() === "null") {
    return "NULL";
  }

  const numericTypes = ["integer", "long", "bigdecimal", "double", "float"];
  const booleanTypes = ["boolean"];
  const stringTypes = ["string", "timestamp", "localdatetime", "date"];

  const typeLower = type.toLowerCase();

  if (numericTypes.some((t) => typeLower.includes(t))) {
    return val;
  }

  if (booleanTypes.some((t) => typeLower.includes(t))) {
    return val.toLowerCase();
  }

  if (stringTypes.some((t) => typeLower.includes(t))) {
    return `'${val.replace(/^"|"$/g, "").replace(/'/g, "''")}'`;
  }

  return `'${val.replace(/^"|"$/g, "").replace(/'/g, "''")}'`;
}

function buildSql(sql, params) {
  let index = 0;
  return sql.replace(/\?/g, () => {
    const item = params[index];
    index += 1;
    return item ?? "?";
  });
}

function extractTableAndOp(sql) {
  if (!sql) return { op: "OTHER", table: "UNKNOWN" };
  const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.startsWith("select")) {
    const match = normalized.match(/from\s+([^\s,]+)/i);
    return { op: "SELECT", table: (match?.[1] || "UNKNOWN").replace(/["`]/g, "").toUpperCase() };
  }
  if (normalized.startsWith("insert")) {
    const match = normalized.match(/into\s+([^\s(]+)/i);
    return { op: "INSERT", table: (match?.[1] || "UNKNOWN").replace(/["`]/g, "").toUpperCase() };
  }
  if (normalized.startsWith("update")) {
    const match = normalized.match(/update\s+([^\s,]+)/i);
    return { op: "UPDATE", table: (match?.[1] || "UNKNOWN").replace(/["`]/g, "").toUpperCase() };
  }
  if (normalized.startsWith("delete")) {
    const match = normalized.match(/from\s+([^\s,]+)/i);
    return { op: "DELETE", table: (match?.[1] || "UNKNOWN").replace(/["`]/g, "").toUpperCase() };
  }
  return { op: "OTHER", table: "UNKNOWN" };
}

function parseLog(text, formatKey = "AUTO") {
  const lines = text.split(/\r?\n/);

  // 自动检测格式
  let selectedFormat = formatKey;
  if (formatKey === "AUTO") {
    selectedFormat = detectLogFormat(lines);
  }

  const format = LOG_FORMATS[selectedFormat];
  const entries = [];
  const sqlEvents = [];
  const pendingByTrace = new Map();
  const useSmartExtract = selectedFormat === "SMART" || format?.smart;

  lines.forEach((raw, index) => {
    const lineNo = index + 1;

    let entry = {
      lineNo,
      raw,
      parsed: false,
      seq: null,
      time: null,
      traceId: null,
      level: null,
      logger: null,
      message: raw,
    };

    if (useSmartExtract) {
      // 使用智能提取
      const extracted = smartExtractFields(raw);
      entry = {
        ...entry,
        ...extracted,
        parsed: Boolean(extracted.time || extracted.level || extracted.traceId)
      };
    } else if (format.regex) {
      // 使用正则匹配
      const match = raw.match(format.regex);
      if (match && format.groups) {
        const g = format.groups;
        entry.parsed = true;
        entry.seq = g.seq ? (match[g.seq] ? Number(match[g.seq]) : null) : null;
        entry.time = g.time ? match[g.time] : null;
        entry.traceId = g.traceId ? match[g.traceId] : null;
        entry.level = g.level ? match[g.level] : null;
        entry.logger = g.logger ? match[g.logger]?.trim() : null;
        entry.message = g.message ? match[g.message] : raw;
      }
    }

    entries.push(entry);

    const message = entry.message;
    const traceId = entry.traceId || "-";
    const pendingList = pendingByTrace.get(traceId) || [];

    const prepMatch = message.match(SQL_PREPARE);
    if (prepMatch) {
      pendingList.push({
        lineNo: entry.lineNo,
        time: entry.time,
        traceId,
        sqlRaw: prepMatch[1].trim(),
        params: null,
      });
      pendingByTrace.set(traceId, pendingList);
      return;
    }

    const paramMatch = message.match(SQL_PARAMS);
    if (paramMatch) {
      const target = [...pendingList].reverse().find((item) => !item.params);
      if (target) {
        const tokens = splitParams(paramMatch[1]);
        const parsedTokens = tokens.map(parseParamToken).map((item) => formatParamValue(item.value, item.type));
        target.params = parsedTokens;
        const stitched = buildSql(target.sqlRaw, parsedTokens);
        const { op, table } = extractTableAndOp(stitched || target.sqlRaw);
        sqlEvents.push({
          id: sqlEvents.length + 1,
          lineNo: target.lineNo,
          time: target.time,
          traceId: target.traceId,
          op,
          table,
          sql: stitched || target.sqlRaw,
          rawSql: target.sqlRaw,
        });
      }
    }
  });

  pendingByTrace.forEach((pendingList) => {
    pendingList.forEach((item) => {
      if (item.params) return;
      const { op, table } = extractTableAndOp(item.sqlRaw);
      sqlEvents.push({
        id: sqlEvents.length + 1,
        lineNo: item.lineNo,
        time: item.time,
        traceId: item.traceId,
        op,
        table,
        sql: item.sqlRaw,
        rawSql: item.sqlRaw,
      });
    });
  });

  const statsMap = new Map();
  sqlEvents.forEach((event) => {
    const table = event.table || "UNKNOWN";
    if (!statsMap.has(table)) {
      statsMap.set(table, { SELECT: 0, INSERT: 0, UPDATE: 0, DELETE: 0, OTHER: 0, TOTAL: 0 });
    }
    const stat = statsMap.get(table);
    const key = SQL_OPS.includes(event.op) ? event.op : "OTHER";
    stat[key] += 1;
    stat.TOTAL += 1;
  });

  const stats = [...statsMap.entries()].map(([table, counts]) => ({ table, ...counts }));

  const traceStats = new Map();
  entries.forEach((entry) => {
    if (!entry.traceId) return;
    if (!traceStats.has(entry.traceId)) {
      traceStats.set(entry.traceId, { count: 0, firstTime: entry.time, lastTime: entry.time });
    }
    const stat = traceStats.get(entry.traceId);
    stat.count += 1;
    if (entry.time && (!stat.firstTime || entry.time < stat.firstTime)) stat.firstTime = entry.time;
    if (entry.time && (!stat.lastTime || entry.time > stat.lastTime)) stat.lastTime = entry.time;
  });

  const traceList = [...traceStats.entries()].map(([traceId, info]) => ({ traceId, ...info }));
  traceList.sort((a, b) => b.count - a.count);

  return { lines, entries, sqlEvents, stats, traceList, detectedFormat: selectedFormat };
}

export default function App() {
  const [encoding, setEncoding] = useState("utf-8");
  const [rawText, setRawText] = useState("");
  const [data, setData] = useState(null);
  const [selectedTrace, setSelectedTrace] = useState("");
  const [traceMode, setTraceMode] = useState("key");
  const [selectedLine, setSelectedLine] = useState(null);
  const [sqlOpFilter, setSqlOpFilter] = useState("ALL");
  const [sqlTableFilter, setSqlTableFilter] = useState("ALL");
  const [sqlSearch, setSqlSearch] = useState("");
  const [jumpLine, setJumpLine] = useState("");
  const [logFormat, setLogFormat] = useState("AUTO");
  const [detectedFormat, setDetectedFormat] = useState(null);
  const [sortKey, setSortKey] = useState("table");
  const [sortOrder, setSortOrder] = useState("asc");
  const [toast, setToast] = useState(null);
  const [sqlDetail, setSqlDetail] = useState(null);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "dark";
  });
  const [sqlSeqOpFilter, setSqlSeqOpFilter] = useState("ALL");
  const [sqlSeqTableFilter, setSqlSeqTableFilter] = useState("ALL");
  const [displayLimit, setDisplayLimit] = useState(50);
  const [highlightTable, setHighlightTable] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [dbSchema, setDbSchema] = useState(() => {
    const saved = localStorage.getItem("dbSchema");
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const getTableComment = (tableName) => {
    if (!dbSchema || !tableName) return null;
    const table = dbSchema[tableName.toUpperCase()];
    return table?.comment || null;
  };

  const getFieldComment = (tableName, fieldName) => {
    if (!dbSchema || !tableName || !fieldName) return null;
    const table = dbSchema[tableName.toUpperCase()];
    if (!table) return null;
    const field = table.fields[fieldName.toLowerCase()];
    return field?.comment || null;
  };

  const enrichSqlWithComments = (sql, tableName) => {
    if (!dbSchema || !tableName) return { sql, fieldComments: [] };
    const table = dbSchema[tableName.toUpperCase()];
    if (!table || !table.fields) return { sql, fieldComments: [] };

    // 提取 SQL 中的字段名
    const fieldPattern = /\b(\w+)\b/g;
    let enrichedSql = sql;
    const matches = new Set();

    let match;
    while ((match = fieldPattern.exec(sql)) !== null) {
      const fieldName = match[1].toLowerCase();
      if (table.fields[fieldName] && !matches.has(fieldName)) {
        matches.add(fieldName);
      }
    }

    // 构建字段注释映射
    const fieldComments = [];
    matches.forEach(fieldName => {
      const field = table.fields[fieldName];
      if (field && field.comment) {
        fieldComments.push(`${fieldName}: ${field.comment}`);
      }
    });

    return { sql: enrichedSql, fieldComments };
  };

  // 为 SQL 添加悬停提示的渲染函数
  const renderSqlWithTooltips = (sql, tableName) => {
    if (!dbSchema || !tableName) return sql;
    const table = dbSchema[tableName.toUpperCase()];
    if (!table) return sql;

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
      if (tokenLower === tableName.toLowerCase() && dbSchema[tokenUpper]) {
        const tableInfo = dbSchema[tokenUpper];
        tokens.push(
          <span key={lastIndex} className="sql-tooltip">
            {token}
            {tableInfo.comment && (
              <span className="tooltip-content">{tableInfo.comment}</span>
            )}
          </span>
        );
      }
      // 检查是否是字段名
      else if (table.fields && table.fields[tokenLower] && !sqlKeywords.has(tokenUpper)) {
        const field = table.fields[tokenLower];
        tokens.push(
          <span key={lastIndex} className="sql-tooltip">
            {token}
            {field.comment && (
              <span className="tooltip-content">{field.comment}</span>
            )}
          </span>
        );
      } else {
        tokens.push(token);
      }
      lastIndex = match.index + token.length;
    }

    return <>{tokens}</>;
  };

  const handleParse = (text) => {
    const parsed = parseLog(text, logFormat);
    setData(parsed);
    setDetectedFormat(parsed.detectedFormat);
    if (parsed.traceList.length > 0) {
      setSelectedTrace(parsed.traceList[0].traceId);
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result;
      let text = "";
      try {
        const decoder = new TextDecoder(encoding);
        text = decoder.decode(buffer);
      } catch (err) {
        text = new TextDecoder("utf-8").decode(buffer);
      }
      setRawText(text);
      handleParse(text);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSample = async () => {
    try {
      const res = await fetch("/日志示例.txt");
      const text = await res.text();
      setRawText(text);
      handleParse(text);
    } catch (err) {
      alert("示例加载失败，请确保以本地服务器方式打开。");
    }
  };

  const traces = data?.traceList || [];

  const timelineEntries = useMemo(() => {
    if (!data || !selectedTrace) return [];
    const list = data.entries.filter((entry) => entry.traceId === selectedTrace);
    if (traceMode === "all") return list;
    return list.filter((entry) => {
      const msg = entry.message || "";
      return msg.includes("Preparing:") || msg.includes("Parameters:") || msg.includes("/admin-api") || entry.level === "ERROR";
    });
  }, [data, selectedTrace, traceMode]);

  const sqlTables = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.sqlEvents.map((item) => item.table));
    return ["ALL", ...[...set].sort()];
  }, [data]);

  const filteredSqlEvents = useMemo(() => {
    if (!data) return [];
    return data.sqlEvents.filter((event) => {
      if (sqlOpFilter !== "ALL" && event.op !== sqlOpFilter) return false;
      if (sqlTableFilter !== "ALL" && event.table !== sqlTableFilter) return false;
      if (sqlSearch && !event.sql.toLowerCase().includes(sqlSearch.toLowerCase())) return false;
      return true;
    });
  }, [data, sqlOpFilter, sqlTableFilter, sqlSearch]);

  const summary = useMemo(() => {
    if (!data) return { lines: 0, traces: 0, sqls: 0 };
    return {
      lines: data.lines.length,
      traces: data.traceList.length,
      sqls: data.sqlEvents.length,
    };
  }, [data]);

  const scrollToLine = (lineNo) => {
    if (!lineNo) return;
    setSelectedLine(lineNo);
    const el = document.querySelector(`[data-line="${lineNo}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const copySql = (sql) => {
    navigator.clipboard.writeText(sql).then(() => {
      setToast("已复制到剪贴板");
      setTimeout(() => setToast(null), 2000);
    }).catch(() => {
      setToast("复制失败");
      setTimeout(() => setToast(null), 2000);
    });
  };

  const formatSql = (sql) => {
    return sql
      .replace(/\s+/g, " ")
      .replace(/\bSELECT\b/gi, "\nSELECT")
      .replace(/\bFROM\b/gi, "\nFROM")
      .replace(/\bWHERE\b/gi, "\nWHERE")
      .replace(/\bAND\b/gi, "\n  AND")
      .replace(/\bOR\b/gi, "\n  OR")
      .replace(/\bJOIN\b/gi, "\nJOIN")
      .replace(/\bLEFT\b/gi, "\nLEFT")
      .replace(/\bINNER\b/gi, "\nINNER")
      .replace(/\bON\b/gi, "\nON")
      .replace(/\bGROUP BY\b/gi, "\nGROUP BY")
      .replace(/\bORDER BY\b/gi, "\nORDER BY")
      .replace(/\bLIMIT\b/gi, "\nLIMIT")
      .trim();
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setRawText(text);
        setToast({ type: 'success', message: '已从剪贴板粘贴日志内容' });
        setTimeout(() => setToast(null), 2000);
      } else {
        setToast({ type: 'error', message: '剪贴板为空' });
        setTimeout(() => setToast(null), 2000);
      }
    } catch (err) {
      console.error('读取剪贴板失败:', err);
      setToast({ type: 'error', message: '读取剪贴板失败，请检查浏览器权限' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const getSortedStats = useMemo(() => {
    if (!data) return [];
    const stats = [...data.stats];
    stats.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      const comparison = typeof aVal === "string" ? aVal.localeCompare(bVal) : aVal - bVal;
      return sortOrder === "asc" ? comparison : -comparison;
    });
    return stats;
  }, [data, sortKey, sortOrder]);

  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // 检测 URL 参数，自动从剪贴板读取日志
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const source = urlParams.get('source');

    if (source === 'clipboard') {
      // 从剪贴板读取
      navigator.clipboard.readText()
        .then(text => {
          if (text && text.trim()) {
            setRawText(text);
            setToast({ type: 'success', message: '已从剪贴板加载日志内容' });
            // 自动解析
            setTimeout(() => {
              handleParse(text);
            }, 500);
          } else {
            setToast({ type: 'error', message: '剪贴板为空' });
          }
        })
        .catch(err => {
          console.error('读取剪贴板失败:', err);
          setToast({ type: 'error', message: '读取剪贴板失败，请手动粘贴日志内容' });
        });

      // 清除 URL 参数
      window.history.replaceState({}, '', window.location.pathname);
    } else if (source === 'external') {
      // 从 localStorage 读取外部传入的日志
      const externalLog = localStorage.getItem('external_log_data');
      if (externalLog) {
        setRawText(externalLog);
        setToast({ type: 'success', message: '已加载外部日志内容' });
        // 自动解析
        setTimeout(() => {
          handleParse(externalLog);
        }, 500);
        // 清除数据
        localStorage.removeItem('external_log_data');
      } else {
        setToast({ type: 'error', message: '未找到外部日志数据' });
      }

      // 清除 URL 参数
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const sqlTimeline = useMemo(() => {
    if (!data) return [];
    return [...data.sqlEvents].sort((a, b) => {
      if (!a.time || !b.time) return 0;
      return a.time.localeCompare(b.time);
    });
  }, [data]);

  const filteredSqlTimeline = useMemo(() => {
    return sqlTimeline.filter((event) => {
      if (sqlSeqOpFilter !== "ALL" && event.op !== sqlSeqOpFilter) return false;
      if (sqlSeqTableFilter !== "ALL" && event.table !== sqlSeqTableFilter) return false;
      return true;
    });
  }, [sqlTimeline, sqlSeqOpFilter, sqlSeqTableFilter]);

  return (
    <div className="app-shell">
      <section className="header">
        <div className="title-block">
          <div className="title-row">
            <img src="/logo.svg" alt="Logo" className="app-logo" />
            <h1>日志执行链路可视化</h1>
            <a href="https://github.com/123xiao" target="_blank" rel="noopener noreferrer" className="github-link" title="GitHub">
              <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
            </a>
          </div>
          <p>本地解析日志，自动拼接 SQL 参数，展示执行顺序、链路与统计，并支持定位到具体行号。</p>
        </div>
        <div className="badges">
          <span className="badge">React · 本地分析</span>
          <span className="badge">无需服务器</span>
          <span className="badge">SQL 拼接</span>
          <span className="badge">开源项目</span>
          <button className="theme-toggle" onClick={toggleTheme} title="切换主题">
            {theme === "dark" ? "☀️ 亮色" : "🌙 暗色"}
          </button>
          <button
            className="page-toggle"
            onClick={() => window.open("./schema.html", "_blank")}
            title="表结构管理"
          >
            📊 表结构
          </button>
        </div>
      </section>

      <nav className="page-nav">
        <a href="#data-import" className="nav-link">数据导入</a>
        <a href="#trace-timeline" className="nav-link">执行链路</a>
        <a href="#sql-stats" className="nav-link">SQL 统计</a>
        <a href="#sql-sequence" className="nav-link">执行顺序</a>
        <a href="#sql-list" className="nav-link">SQL 列表</a>
        <a href="#log-viewer" className="nav-link">行号定位</a>
      </nav>

      <>
        <div className="card fade-in" id="data-import">
          <h2>数据导入</h2>
          <div className="control-group">
            <label className="label">日志格式</label>
            <select value={logFormat} onChange={(e) => setLogFormat(e.target.value)}>
              {Object.entries(LOG_FORMATS).map(([key, format]) => (
                <option key={key} value={key}>
                  {format.name}
                  {detectedFormat === key && logFormat === "AUTO" ? " (已检测)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="control-group">
            <label className="label">文件编码</label>
            <select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
              <option value="utf-8">UTF-8</option>
              <option value="gbk">GBK</option>
            </select>
          </div>
          <div className="control-group">
            <label className="label">选择日志文件</label>
            <input type="file" accept=".log,.txt" onChange={(e) => handleFile(e.target.files?.[0])} />
          </div>
          <div className="control-group">
            <label className="label">或粘贴日志内容</label>
            <textarea
              placeholder="在这里粘贴日志..."
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
          </div>
          <div className="button-row">
            <button onClick={() => handleParse(rawText)}>解析日志</button>
            <button className="secondary" onClick={handlePasteFromClipboard}>📋 从剪贴板粘贴</button>
            <button className="secondary" onClick={() => setRawText("")}>清空</button>
            {/* <button className="ghost" onClick={handleSample}>加载示例</button> */}
          </div>

          {detectedFormat && (
            <div className="format-info">
              <span className="format-badge">
                检测到格式: {LOG_FORMATS[detectedFormat]?.name || detectedFormat}
              </span>
            </div>
          )}

          <h3>摘要</h3>
          <div className="stats">
            <div className="stat">
              <strong>{summary.lines}</strong>
              <span>行数</span>
            </div>
            <div className="stat">
              <strong>{summary.traces}</strong>
              <span>Trace 数</span>
            </div>
            <div className="stat">
              <strong>{summary.sqls}</strong>
              <span>SQL 次数</span>
            </div>
          </div>
        </div>

        <div className="card fade-in" id="trace-timeline">
          <h2>执行链路</h2>
          <div className="control-group">
            <label className="label">Trace 选择</label>
            <select value={selectedTrace} onChange={(e) => setSelectedTrace(e.target.value)}>
              {traces.map((trace) => (
                <option key={trace.traceId} value={trace.traceId}>
                  {trace.traceId} ({trace.count})
                </option>
              ))}
            </select>
          </div>
          <div className="control-group">
            <label className="label">展示范围</label>
            <select value={traceMode} onChange={(e) => setTraceMode(e.target.value)}>
              <option value="key">关键事件</option>
              <option value="all">全部日志</option>
            </select>
          </div>
          <div className="timeline">
            {timelineEntries.length === 0 && <p className="label">暂无可展示事件</p>}
            {timelineEntries.map((entry) => (
              <div className="timeline-item" key={`${entry.lineNo}-${entry.message}`} onClick={() => scrollToLine(entry.lineNo)}>
                <div className="timeline-dot" />
                <div className="timeline-content">
                  <h4>{entry.time} · {entry.level} · #{entry.lineNo}</h4>
                  <p>{entry.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <section className="card fade-in" id="sql-stats">
        <h2>SQL 统计</h2>
        <table className="sql-table">
          <thead>
            <tr>
              <th onClick={() => handleSort("table")} className={sortKey === "table" ? "sortable active" : "sortable"}>表 {sortKey === "table" && (sortOrder === "asc" ? "↑" : "↓")}</th>
              <th onClick={() => handleSort("SELECT")} className={sortKey === "SELECT" ? "sortable active" : "sortable"}>SELECT {sortKey === "SELECT" && (sortOrder === "asc" ? "↑" : "↓")}</th>
              <th onClick={() => handleSort("INSERT")} className={sortKey === "INSERT" ? "sortable active" : "sortable"}>INSERT {sortKey === "INSERT" && (sortOrder === "asc" ? "↑" : "↓")}</th>
              <th onClick={() => handleSort("UPDATE")} className={sortKey === "UPDATE" ? "sortable active" : "sortable"}>UPDATE {sortKey === "UPDATE" && (sortOrder === "asc" ? "↑" : "↓")}</th>
              <th onClick={() => handleSort("DELETE")} className={sortKey === "DELETE" ? "sortable active" : "sortable"}>DELETE {sortKey === "DELETE" && (sortOrder === "asc" ? "↑" : "↓")}</th>
              <th onClick={() => handleSort("TOTAL")} className={sortKey === "TOTAL" ? "sortable active" : "sortable"}>TOTAL {sortKey === "TOTAL" && (sortOrder === "asc" ? "↑" : "↓")}</th>
            </tr>
          </thead>
          <tbody>
            {getSortedStats.map((item) => {
              const tableComment = getTableComment(item.table);
              return (
                <tr key={item.table}>
                  <td>
                    <div className="table-name-cell">
                      <span>{item.table}</span>
                      {tableComment && <span className="table-comment" title={tableComment}>({tableComment})</span>}
                    </div>
                  </td>
                  <td>{item.SELECT}</td>
                  <td>{item.INSERT}</td>
                  <td>{item.UPDATE}</td>
                  <td>{item.DELETE}</td>
                  <td>{item.TOTAL}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card fade-in" id="sql-sequence">
        <h2>SQL 执行顺序</h2>
        <div className="control-group">
          <label className="label">操作过滤</label>
          <select value={sqlSeqOpFilter} onChange={(e) => setSqlSeqOpFilter(e.target.value)}>
            <option value="ALL">全部</option>
            <option value="SELECT">SELECT</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="OTHER">OTHER</option>
          </select>
        </div>
        <div className="control-group">
          <label className="label">表过滤</label>
          <select value={sqlSeqTableFilter} onChange={(e) => setSqlSeqTableFilter(e.target.value)}>
            {sqlTables.map((table) => (
              <option key={table} value={table}>{table}</option>
            ))}
          </select>
        </div>
        <div className="sql-legend">
          <span className="legend-item">
            <span className="legend-dot op-select"></span>
            SELECT
          </span>
          <span className="legend-item">
            <span className="legend-dot op-insert"></span>
            INSERT
          </span>
          <span className="legend-item">
            <span className="legend-dot op-update"></span>
            UPDATE
          </span>
          <span className="legend-item">
            <span className="legend-dot op-delete"></span>
            DELETE
          </span>
        </div>
        <div className="sql-sequence-chart">
          <div className="sequence-timeline">
            {filteredSqlTimeline.slice(0, displayLimit).map((event, index) => {
              const tableComment = getTableComment(event.table);
              return (
                <div
                  key={event.id}
                  className={`sequence-node ${highlightTable && event.table === highlightTable ? "highlighted" : ""}`}
                  onClick={() => setSqlDetail(event)}
                  onMouseEnter={() => setHighlightTable(event.table)}
                  onMouseLeave={() => setHighlightTable(null)}
                  title="点击查看详情"
                >
                  <div className="node-number">#{index + 1}</div>
                  <div className={`node-circle op-${event.op.toLowerCase()}`}>
                    <span className="node-op">{event.op.charAt(0)}</span>
                  </div>
                  <div className="node-info">
                    <div className="node-time">{event.time?.split(' ')[1] || event.time}</div>
                    <div className="node-table">
                      {tableComment ? (
                        <span className="sql-tooltip">
                          {event.table}
                          <span className="tooltip-content">{tableComment}</span>
                        </span>
                      ) : (
                        event.table
                      )}
                    </div>
                  </div>
                  {index < filteredSqlTimeline.slice(0, displayLimit).length - 1 && <div className="node-connector" />}
                </div>
              );
            })}
          </div>
          {filteredSqlTimeline.length > displayLimit && (
            <div className="load-more-container">
              <button className="secondary" onClick={() => setDisplayLimit(prev => prev + 50)}>
                加载更多 ({displayLimit} / {filteredSqlTimeline.length})
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="card fade-in" id="sql-list">
        <h2>SQL 列表</h2>
        <div className="control-group">
          <label className="label">操作过滤</label>
          <select value={sqlOpFilter} onChange={(e) => setSqlOpFilter(e.target.value)}>
            <option value="ALL">全部</option>
            <option value="SELECT">SELECT</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="OTHER">OTHER</option>
          </select>
        </div>
        <div className="control-group">
          <label className="label">表过滤</label>
          <select value={sqlTableFilter} onChange={(e) => setSqlTableFilter(e.target.value)}>
            {sqlTables.map((table) => (
              <option key={table} value={table}>{table}</option>
            ))}
          </select>
        </div>
        <div className="control-group">
          <label className="label">搜索</label>
          <input type="text" value={sqlSearch} onChange={(e) => setSqlSearch(e.target.value)} placeholder="SQL 关键词" />
        </div>
        <div className="sql-list">
          {filteredSqlEvents.map((event) => {
            const tableComment = getTableComment(event.table);
            return (
              <div className="sql-item" key={event.id}>
                <div className="sql-item-header">
                  <h4>
                    #{event.id} · {event.op} ·{' '}
                    {tableComment ? (
                      <span className="sql-tooltip">
                        {event.table}
                        <span className="tooltip-content">{tableComment}</span>
                      </span>
                    ) : (
                      event.table
                    )}
                    {' '}· 行 {event.lineNo}
                  </h4>
                  <div className="sql-item-actions">
                    <button className="copy-btn" onClick={(e) => { e.stopPropagation(); copySql(event.sql); }} title="复制 SQL">📋</button>
                    <button className="detail-btn" onClick={(e) => { e.stopPropagation(); setSqlDetail(event); }} title="查看详情">📖</button>
                  </div>
                </div>
                <p onClick={() => scrollToLine(event.lineNo)}>
                  {renderSqlWithTooltips(event.sql, event.table)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card fade-in" id="log-viewer">
        <h2>日志行号定位</h2>
        <div className="button-row">
          <input
            type="number"
            min="1"
            placeholder="输入行号"
            value={jumpLine}
            onChange={(e) => setJumpLine(e.target.value)}
          />
          <button className="secondary" onClick={() => scrollToLine(Number(jumpLine))}>跳转</button>
        </div>
        <div className="log-viewer">
          {data?.entries.map((entry) => (
            <div
              key={entry.lineNo}
              className={`log-line ${selectedLine === entry.lineNo ? "selected" : ""}`}
              data-line={entry.lineNo}
            >
              <span>{entry.lineNo}</span>
              <span>{entry.raw}</span>
            </div>
          ))}
        </div>
      </section>

      {toast && (
        <div className={`toast ${toast.type || ''}`}>
          {typeof toast === 'string' ? toast : toast.message}
        </div>
      )}

      {showBackToTop && (
        <button className="back-to-top" onClick={scrollToTop} title="回到顶部">
          ↑
        </button>
      )}

      {sqlDetail && (
        <div className="modal-overlay" onClick={() => setSqlDetail(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>SQL 详情</h3>
              <button className="modal-close" onClick={() => setSqlDetail(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="sql-detail-info">
                <p><strong>ID:</strong> {sqlDetail.id}</p>
                <p><strong>操作:</strong> {sqlDetail.op}</p>
                <p>
                  <strong>表:</strong>
                  {getTableComment(sqlDetail.table)
                    ? `${sqlDetail.table}(${getTableComment(sqlDetail.table)})`
                    : sqlDetail.table
                  }
                </p>
                <p><strong>行号:</strong> {sqlDetail.lineNo}</p>
                <p><strong>时间:</strong> {sqlDetail.time}</p>
              </div>
              {(() => {
                const enriched = enrichSqlWithComments(sqlDetail.sql, sqlDetail.table);
                return (
                  <>
                  <div className="sql-detail-formatted">
                      <h4>格式化 SQL</h4>
                      <pre>{renderSqlWithTooltips(formatSql(sqlDetail.sql), sqlDetail.table)}</pre>
                    </div>
                    <div className="sql-detail-raw">
                      <h4>原始 SQL</h4>
                      <pre>{renderSqlWithTooltips(sqlDetail.sql, sqlDetail.table)}</pre>
                    </div>
                    {enriched.fieldComments.length > 0 && (
                      <div className="sql-field-comments">
                        <h4>字段说明</h4>
                        <div className="field-comment-list">
                          {enriched.fieldComments.map((comment, idx) => (
                            <div key={idx} className="field-comment-item">{comment}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                  </>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button onClick={() => copySql(sqlDetail.sql)}>复制 SQL</button>
              <button className="secondary" onClick={() => setSqlDetail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
      </>

      <footer className="footer">
        <div className="footer-content">
          <div className="footer-left">
            <p className="footer-title">日志执行链路可视化工具</p>
            <p className="footer-desc">开源、免费、本地化的日志分析解决方案</p>
          </div>
          <div className="footer-right">
            <a href="https://github.com/123xiao" target="_blank" rel="noopener noreferrer" className="footer-link">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              <span>GitHub @123xiao</span>
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
