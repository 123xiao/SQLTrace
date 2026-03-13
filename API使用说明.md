# 外部程序调用 API 说明

本工具支持外部程序通过剪贴板快速传递日志内容，实现一键分析。

## 使用方式

### 基本流程
1. 外部程序将日志内容复制到剪贴板
2. 打开页面：`http://localhost:5173/index.html?source=clipboard`
3. 页面自动读取剪贴板内容并解析

### 权限处理
- 首次使用时，浏览器会请求剪贴板读取权限
- 如果用户拒绝权限，页面会友好提示用户手动粘贴或重新授权
- 支持的浏览器：Chrome、Edge、Firefox、Safari 等现代浏览器

---

## 调用示例

### JavaScript 示例
```javascript
// 将日志内容复制到剪贴板
const logContent = `你的日志内容...`;
await navigator.clipboard.writeText(logContent);

// 打开页面（会自动读取剪贴板）
window.open('http://localhost:5173/index.html?source=clipboard', '_blank');
```

### Python 示例
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

### C# 示例
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

### Java 示例
```java
import java.awt.Toolkit;
import java.awt.datatransfer.StringSelection;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;

// 读取日志文件
String logContent = new String(Files.readAllBytes(Paths.get("log.txt")));

// 复制到剪贴板
StringSelection selection = new StringSelection(logContent);
Toolkit.getDefaultToolkit().getSystemClipboard().setContents(selection, null);

// 打开页面
Runtime.getRuntime().exec("cmd /c start http://localhost:5173/index.html?source=clipboard");
```

---

## 手动粘贴方式

用户也可以手动操作：
1. 复制日志内容到剪贴板
2. 打开页面 `http://localhost:5173/index.html`
3. 点击 "📋 从剪贴板粘贴" 按钮

---

## 注意事项

### 浏览器兼容性
- **推荐浏览器**：Chrome 66+、Edge 79+、Firefox 63+、Safari 13.1+
- **权限要求**：需要用户授权剪贴板读取权限
- **HTTPS 要求**：某些浏览器在非 HTTPS 环境下可能限制剪贴板访问

### 文件大小限制
- **推荐大小**：不超过 10MB
- **最大支持**：取决于浏览器内存限制
- 对于超大日志文件，建议使用文件上传功能

### 错误处理
页面会自动处理以下情况：
- ✓ 剪贴板为空 → 提示用户先复制日志内容
- ✓ 权限被拒绝 → 提示用户在浏览器设置中允许访问剪贴板
- ✓ 读取失败 → 提示用户点击「从剪贴板粘贴」按钮或手动粘贴

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

        # 检查文件大小
        size_mb = len(log_content.encode('utf-8')) / (1024 * 1024)
        if size_mb > 10:
            print(f"⚠️  警告：文件较大 ({size_mb:.2f} MB)，可能影响性能")
            response = input("是否继续？(y/n): ")
            if response.lower() != 'y':
                print("已取消")
                return

        # 复制到剪贴板
        pyperclip.copy(log_content)
        print(f"✓ 已将日志内容复制到剪贴板 ({len(log_content)} 字符)")

        # 打开分析工具
        url = f"{tool_url}?source=clipboard"
        webbrowser.open(url)
        print(f"✓ 已打开日志分析工具: {url}")
        print("\n提示：如果浏览器提示权限请求，请点击「允许」")

    except FileNotFoundError:
        print(f"✗ 文件不存在: {log_file_path}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ 错误: {e}")
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python analyze_log.py <日志文件路径>")
        print("\n示例:")
        print("  python analyze_log.py /path/to/your/log.txt")
        print("  python analyze_log.py C:\\logs\\app.log")
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

---

## 常见问题

### Q: 为什么读取剪贴板失败？
A: 可能的原因：
1. 浏览器不支持 Clipboard API
2. 用户拒绝了剪贴板权限
3. 在非 HTTPS 环境下使用（部分浏览器限制）

解决方案：使用现代浏览器，并在首次提示时允许剪贴板访问。

### Q: 如何在企业内网环境使用？
A: 将工具部署到内网服务器，然后使用内网地址调用即可。

### Q: 支持哪些日志格式？
A: 支持多种日志格式，包括：
- Spring Boot 日志
- Logback 日志
- 自定义格式
- 智能识别模式（推荐）

