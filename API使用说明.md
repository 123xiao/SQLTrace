# 外部程序调用 API 说明

本工具支持外部程序通过剪贴板或 localStorage 快速传递日志内容。

## 方案 1：通过剪贴板（推荐）

### 使用场景
- 适合任意大小的日志内容
- 跨域支持
- 用户体验好

### 调用方式

#### JavaScript 示例
```javascript
// 1. 将日志内容复制到剪贴板
const logContent = `你的日志内容...`;
await navigator.clipboard.writeText(logContent);

// 2. 打开页面（会自动读取剪贴板）
window.open('http://localhost:5173/index.html?source=clipboard', '_blank');
```

#### Python 示例
```python
import webbrowser
import pyperclip

# 读取日志文件
with open('log.txt', 'r', encoding='utf-8') as f:
    log_content = f.read()

# 复制到剪贴板
pyperclip.copy(log_content)

# 打开页面
webbrowser.open('http://localhost:5173/index.html?source=clipboard')
```

#### C# 示例
```csharp
using System.Diagnostics;
using System.Windows.Forms;

// 读取日志内容
string logContent = File.ReadAllText("log.txt");

// 复制到剪贴板
Clipboard.SetText(logContent);

// 打开页面
Process.Start(new ProcessStartInfo
{
    FileName = "http://localhost:5173/index.html?source=clipboard",
    UseShellExecute = true
});
```

---

## 方案 2：通过 localStorage

### 使用场景
- 适合大文件（无大小限制）
- 需要同域访问

### 调用方式

#### JavaScript 示例
```javascript
// 1. 将日志内容存储到 localStorage
const logContent = `你的日志内容...`;
localStorage.setItem('external_log_data', logContent);

// 2. 打开页面（会自动读取 localStorage）
window.open('http://localhost:5173/index.html?source=external', '_blank');
```

#### 使用 Electron 或 WebView 的应用
```javascript
// 在 WebView 中执行 JavaScript
webview.executeJavaScript(`
  localStorage.setItem('external_log_data', ${JSON.stringify(logContent)});
  window.location.href = 'http://localhost:5173/index.html?source=external';
`);
```

---

## 方案 3：手动粘贴按钮

用户也可以：
1. 复制日志内容到剪贴板
2. 打开页面 `http://localhost:5173/index.html`
3. 点击 "📋 从剪贴板粘贴" 按钮

---

## 注意事项

### 浏览器权限
- 剪贴板 API 需要用户授权（首次使用时会提示）
- 某些浏览器在非 HTTPS 环境下可能限制剪贴板访问
- 建议使用 Chrome、Edge、Firefox 等现代浏览器

### 文件大小限制
- **剪贴板方式**：建议不超过 10MB
- **localStorage 方式**：建议不超过 5MB（浏览器限制通常为 5-10MB）
- 对于超大日志文件，建议使用文件上传功能

### URL 参数说明
- `?source=clipboard` - 从剪贴板读取日志
- `?source=external` - 从 localStorage 读取日志（key: `external_log_data`）

---

## 完整示例：Python 脚本

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
日志分析工具快速启动脚本
"""

import sys
import webbrowser
import pyperclip

def analyze_log(log_file_path, tool_url='http://localhost:5173/index.html'):
    """
    快速分析日志文件

    Args:
        log_file_path: 日志文件路径
        tool_url: 工具地址（默认本地开发环境）
    """
    try:
        # 读取日志文件
        with open(log_file_path, 'r', encoding='utf-8') as f:
            log_content = f.read()

        # 复制到剪贴板
        pyperclip.copy(log_content)
        print(f"✓ 已将日志内容复制到剪贴板 ({len(log_content)} 字符)")

        # 打开分析工具
        url = f"{tool_url}?source=clipboard"
        webbrowser.open(url)
        print(f"✓ 已打开日志分析工具: {url}")

    except FileNotFoundError:
        print(f"✗ 文件不存在: {log_file_path}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ 错误: {e}")
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python analyze_log.py <日志文件路径>")
        sys.exit(1)

    log_file = sys.argv[1]
    analyze_log(log_file)
```

使用方法：
```bash
# 安装依赖
pip install pyperclip

# 分析日志
python analyze_log.py /path/to/your/log.txt
```

---

## 生产环境部署

如果部署到生产环境（如 `https://yourdomain.com`），只需将 URL 替换为实际地址：

```javascript
// 开发环境
window.open('http://localhost:5173/index.html?source=clipboard');

// 生产环境
window.open('https://yourdomain.com/index.html?source=clipboard');
```
