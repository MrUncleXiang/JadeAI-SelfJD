# PDF/DOCX 导出字体运维

关联需求：RES-002。

## 背景

简历 PDF 由服务端 Chromium 渲染。如果 VPS 没有中文字体，Chromium 会生成缺少中文字形的
PDF，用户在 Windows 11 下载打开时会看到方框占位符。导出链路必须优先使用服务端本机 CJK
字体，并让 PDF 嵌入实际使用的字形，避免依赖用户电脑安装相同字体。

## 生产字体依赖

Ubuntu / Debian 自托管实例至少安装：

```bash
sudo apt-get update
sudo apt-get install -y fonts-noto-cjk fonts-noto-cjk-extra fonts-wqy-zenhei fontconfig poppler-utils
fc-cache -f
```

推荐验证：

```bash
fc-list :lang=zh | head
fc-match 'Noto Sans CJK SC'
fc-match 'WenQuanYi Zen Hei'
```

## 应用侧策略

- PDF/HTML 导出不再依赖 `fonts.googleapis.com`。
- `src/lib/pdf/export-fonts.ts` 定义本机优先的字体栈：
  - Sans：`Noto Sans CJK SC`、`Microsoft YaHei`、`PingFang SC`、`WenQuanYi Zen Hei` 等；
  - Serif：`Noto Serif CJK SC`、`SimSun`、`Songti SC` 等；
  - Mono：`Noto Sans Mono CJK SC`、`WenQuanYi Zen Hei Mono` 等。
- `@font-face` 使用 `local(...)` 将 `Noto Sans SC` 等网页字体名映射到 Linux 实际字体名。
- DOCX 的中文字体继续使用 `Microsoft YaHei`，让 Windows Word 打开时优先使用系统字体。

## 验收步骤

1. 导出一份包含中文、英文和多 Section 的简历 PDF。
2. 在服务器上检查文本可抽取：

```bash
pdftotext exported.pdf - | grep -E '个人简介|技能|项目|中文'
```

3. 检查字体嵌入状态：

```bash
pdffonts exported.pdf
```

预期：字体行的 `emb` 列为 `yes`，且 `pdftotext` 能输出中文正文。

4. 下载到 Windows 11，分别用 Microsoft Edge / Adobe Reader 打开，中文不应显示为方框。

## 故障处理

- 如果 `fc-list :lang=zh` 没有输出，说明服务器缺少中文字体，按上面的安装命令修复。
- 如果 `pdftotext` 无法输出中文，检查当前部署版本是否包含 `src/lib/pdf/export-fonts.ts`。
- 如果只有 Windows 打开异常而服务器 `pdftotext` 正常，优先确认 PDF 是否来自修复前的旧导出文件。
