# 输入渲染测试：Markdown 源文本
> 用途：把本文件内容“原样复制”到 UI 的「用户输入」里，观察渲染是否符合预期（换行/空格/Markdown/公式）。

## 1) 普通段落（包含“硬换行”）
这是一段普通文本，下面两行之间只有一个换行符（没有空行）。
第二行：如果 UI 正确保留换行，这里应当另起一行。
第三行：这行中间有多空格用于对齐：A    B    C（A/B/C 之间各 4 个空格）。

这一段有空行分隔，所以应当是另一个段落。

────

## 2) 终端输出（fenced code block，应保持对齐）
```bash
kino@gearup:~/src/codex-sidecar$ ./run.sh
[sidecar] config_home=/home/kino/src/codex-sidecar/config/sidecar
[sidecar] codex_home=/home/kino/.codex
[sidecar] server_url=http://127.0.0.1:8787

PID    COMMAND              RSS
12142  node                 107076
5767   python3              26612
```

## 3) 列表（ul/ol + 续行合并）
- 第一项：这是一行很长很长很长的内容，用来测试列表渲染。
  这一行是续行（两空格缩进），应当仍然属于同一个列表项（不应变成新段落）。
- 第二项：含有 `inline code` 和 **加粗**。

1. item one
2. item two

## 4) 表格
| 名称 | 值 |
|---|---:|
| a | 1 |
| b | 2 |

## 5) 数学公式（KaTeX：行内 + 块级）
行内：设 $a^2 + b^2 = c^2$。

块级：
$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## 6) 反引号边界测试（不应吞掉后续内容）
- 两个反引号：``（应当按普通文本显示）
- 三个反引号：```（应当按普通文本显示）
- 未闭合反引号：`（后面的内容不应被吞掉）
- 组合：这里有 `正常的 code span`，以及紧跟着的 `` 两个反引号。
