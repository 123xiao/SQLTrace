import { useState, useRef, useEffect } from "react";

export default function TraceExtractor() {
  const [logContent, setLogContent] = useState("");
  const [traceId, setTraceId] = useState("");
  const [extractedLogs, setExtractedLogs] = useState([]);
  const [displayedLogs, setDisplayedLogs] = useState(""); // 用于显示的日志（带高亮）
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [matchPositions, setMatchPositions] = useState([]); // 存储所有匹配位置
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "dark";
  });
  const fileInputRef = useRef(null);
  const logContainerRef = useRef(null);
  const highlightRefs = useRef([]);

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

  // 流式读取大文件
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsProcessing(true);
    setLogContent("");
    setExtractedLogs([]);
    setStats(null);
    setSearchKeyword("");
    setMatchCount(0);
    setCurrentMatchIndex(0);

    try {
      const text = await file.text();
      setLogContent(text);
      setStats({
        fileName: file.name,
        fileSize: (file.size / 1024 / 1024).toFixed(2) + " MB",
        totalLines: text.split("\n").length
      });
    } catch (error) {
      alert("文件读取失败: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 提取指定TraceID的日志
  const extractByTraceId = () => {
    if (!logContent) {
      alert("请先上传日志文件");
      return;
    }
    if (!traceId.trim()) {
      alert("请输入TraceID");
      return;
    }

    setIsProcessing(true);
    const lines = logContent.split("\n");
    const extracted = [];
    const searchId = traceId.trim();

    for (const line of lines) {
      if (line.includes(`[${searchId}]`)) {
        extracted.push(line);
      }
    }

    setExtractedLogs(extracted);
    setDisplayedLogs(extracted.join("\n"));
    setIsProcessing(false);

    if (extracted.length === 0) {
      alert(`未找到TraceID为 ${searchId} 的日志`);
    }
  };

  // 一键复制
  const handleCopy = async () => {
    try {
      const logText = extractedLogs.join("\n");
      await navigator.clipboard.writeText(logText);
      setToast({ type: 'success', message: '✓ 已复制到剪贴板' });
      setTimeout(() => setToast(null), 2000);
    } catch (error) {
      setToast({ type: 'error', message: '✗ 复制失败' });
      setTimeout(() => setToast(null), 2000);
    }
  };

  // 实时搜索关键词并高亮
  useEffect(() => {
    if (!searchKeyword.trim() || extractedLogs.length === 0) {
      setMatchCount(0);
      setCurrentMatchIndex(0);
      setMatchPositions([]);
      setDisplayedLogs(extractedLogs.join("\n"));
      return;
    }

    const logText = extractedLogs.join("\n");
    const keyword = searchKeyword;
    const positions = [];
    let index = 0;

    // 找到所有匹配位置
    while ((index = logText.toLowerCase().indexOf(keyword.toLowerCase(), index)) !== -1) {
      positions.push(index);
      index += keyword.length;
    }

    setMatchPositions(positions);
    setMatchCount(positions.length);

    if (positions.length > 0) {
      setCurrentMatchIndex(1);
      // 高亮所有匹配项
      highlightMatches(logText, keyword, positions, 0);
    } else {
      setCurrentMatchIndex(0);
      setDisplayedLogs(logText);
    }
  }, [searchKeyword, extractedLogs]);

  // 高亮匹配项
  const highlightMatches = (text, keyword, positions, activeIndex) => {
    if (positions.length === 0) {
      setDisplayedLogs(text);
      return;
    }

    let result = "";
    let lastIndex = 0;

    positions.forEach((pos, idx) => {
      result += text.substring(lastIndex, pos);
      const isActive = idx === activeIndex;
      const highlightClass = isActive ? "highlight-active" : "highlight";
      result += `<mark class="${highlightClass}" data-index="${idx}">${text.substring(pos, pos + keyword.length)}</mark>`;
      lastIndex = pos + keyword.length;
    });
    result += text.substring(lastIndex);

    setDisplayedLogs(result);

    // 滚动到当前高亮位置
    setTimeout(() => {
      const activeElement = logContainerRef.current?.querySelector('.highlight-active');
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 0);
  };

  // 跳转到上一个匹配
  const goToPrevMatch = () => {
    if (matchCount === 0) return;

    const newIndex = currentMatchIndex <= 1 ? matchCount : currentMatchIndex - 1;
    setCurrentMatchIndex(newIndex);
    highlightMatches(extractedLogs.join("\n"), searchKeyword, matchPositions, newIndex - 1);
  };

  // 跳转到下一个匹配
  const goToNextMatch = () => {
    if (matchCount === 0) return;

    const newIndex = currentMatchIndex >= matchCount ? 1 : currentMatchIndex + 1;
    setCurrentMatchIndex(newIndex);
    highlightMatches(extractedLogs.join("\n"), searchKeyword, matchPositions, newIndex - 1);
  };

  // 发送到日志分析模块
  const sendToAnalyzer = () => {
    if (extractedLogs.length === 0) {
      alert("没有可发送的日志");
      return;
    }

    const logText = extractedLogs.join("\n");
    localStorage.setItem("imported_logs", logText);
    window.open('./index.html', '_blank');
  };

  // 清空数据
  const clearAll = () => {
    setLogContent("");
    setTraceId("");
    setExtractedLogs([]);
    setStats(null);
    setSearchKeyword("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="schema-manager-page">
      <section className="header">
        <div className="title-block">
          <div className="title-row">
            <img src="/logo.svg" alt="Logo" className="app-logo" />
            <h1>历史日志提取</h1>
            <a href="https://github.com/123xiao" target="_blank" rel="noopener noreferrer" className="github-link" title="GitHub">
              <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
            </a>
          </div>
          <p>上传历史日志文件（支持100MB+大文件），通过TraceID快速提取完整链路日志。</p>
        </div>
        <div className="badges">
          <button className="theme-toggle" onClick={toggleTheme} title="切换主题">
            {theme === "dark" ? "☀️ 亮色" : "🌙 暗色"}
          </button>
          <button className="back-button" onClick={() => window.location.href = './index.html'}>← 返回首页</button>
        </div>
      </section>

      {extractedLogs.length > 0 && (
        <nav className="page-nav">
          <a href="#upload-section" className="nav-link">上传文件</a>
          <a href="#extract-section" className="nav-link">提取日志</a>
          <a href="#result-section" className="nav-link">提取结果</a>
        </nav>
      )}

      <div className="schema-content">
        {/* 文件上传区域 */}
        <section id="upload-section" className="schema-section">
          <h2 className="section-title">1. 上传日志文件</h2>
          <div className="upload-area">
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              style={{ marginBottom: "10px" }}
            />
            {stats && (
              <div className="file-stats">
                <div className="stat-item">
                  <span className="stat-label">文件名:</span>
                  <span className="stat-value">{stats.fileName}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">文件大小:</span>
                  <span className="stat-value">{stats.fileSize}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">总行数:</span>
                  <span className="stat-value">{stats.totalLines.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* TraceID输入区域 */}
        <section id="extract-section" className="schema-section">
          <h2 className="section-title">2. 输入TraceID</h2>
          <div className="trace-input-area">
            <input
              type="text"
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              placeholder="输入TraceID (例如: 45390c2bcab148db893b3614806b6f83)"
              className="trace-input"
              onKeyPress={(e) => e.key === "Enter" && extractByTraceId()}
            />
            <div className="button-group">
              <button
                onClick={extractByTraceId}
                disabled={isProcessing || !logContent}
                className="primary-button"
              >
                {isProcessing ? "处理中..." : "提取日志"}
              </button>
              <button onClick={clearAll} className="secondary-button">
                清空
              </button>
            </div>
          </div>
        </section>

        {/* 提取结果区域 */}
        {extractedLogs.length > 0 && (
          <section id="result-section" className="schema-section">
            <div className="result-header">
              <h2 className="section-title">3. 提取结果 ({extractedLogs.length} 条日志)</h2>
              <div className="result-header-buttons">
                <button onClick={handleCopy} className="copy-button">
                  📋 复制
                </button>
                <button onClick={sendToAnalyzer} className="send-button">
                  发送到日志分析 →
                </button>
              </div>
            </div>

            {/* 漂浮搜索框 */}
            <div className="floating-search">
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索关键词..."
                className="floating-search-input"
              />
              {matchCount > 0 && (
                <div className="floating-search-info">
                  <span className="floating-match-count">{currentMatchIndex}/{matchCount}</span>
                  <button onClick={goToPrevMatch} className="floating-nav-button" title="上一个">
                    ↑
                  </button>
                  <button onClick={goToNextMatch} className="floating-nav-button" title="下一个">
                    ↓
                  </button>
                </div>
              )}
            </div>

            <div
              ref={logContainerRef}
              className="log-display"
              dangerouslySetInnerHTML={{ __html: displayedLogs }}
            />
          </section>
        )}

        {/* 使用说明 */}
        <section className="schema-section">
          <h2 className="section-title">使用说明</h2>
          <div className="usage-guide">
            <ol>
              <li>点击"选择文件"上传历史日志文件（支持大文件，如100MB+）</li>
              <li>在输入框中输入要查找的TraceID</li>
              <li>点击"提取日志"按钮，系统会提取该TraceID的所有日志</li>
              <li>使用搜索框输入关键词快速定位日志内容</li>
              <li>点击"发送到日志分析"按钮，将提取的日志发送到主分析页面</li>
            </ol>
          </div>
        </section>
      </div>

      {showBackToTop && (
        <button className="back-to-top" onClick={scrollToTop} title="回到顶部">
          ↑
        </button>
      )}

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
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
          </div>
        </div>
      </footer>
    </div>
  );
}
