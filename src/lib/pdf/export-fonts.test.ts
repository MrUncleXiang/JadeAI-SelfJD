import { describe, expect, it } from 'vitest';
import { join } from 'path';

import { generateHtml } from '@/app/api/resume/[id]/export/builders';
import type { ResumeWithSections } from '@/app/api/resume/[id]/export/utils';

import {
  EXPORT_LOCAL_FONT_CSS,
  buildFileBackedExportFontCSS,
  buildMonoFontStack,
  buildSansFontStack,
  buildSerifFontStack,
  composeExportFontCSS,
  resolveLocalCjkFontFiles,
} from './export-fonts';

describe('export font fallbacks [RES-002]', () => {
  it('builds CJK-safe font stacks and drops CSS injection attempts', () => {
    expect(buildSansFontStack('Inter')).toBe(
      "'Inter', 'Noto Sans SC', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'WenQuanYi Zen Hei', 'Arial Unicode MS', 'Arial', 'Helvetica', sans-serif",
    );
    expect(buildSerifFontStack()).toContain("'Noto Serif CJK SC'");
    expect(buildMonoFontStack()).toContain("'Noto Sans Mono CJK SC'");

    const unsafe = buildSansFontStack('Inter; color:red');
    expect(unsafe).not.toContain('color:red');
    expect(unsafe).toContain("'Noto Sans CJK SC'");
  });

  it('resolves packaged Noto Sans SC OTF files for file-backed embedding', () => {
    const files = resolveLocalCjkFontFiles(process.cwd());
    expect(files.regular).toBe(join(process.cwd(), 'public', 'fonts', 'NotoSansSC-Regular.otf'));
    expect(files.bold).toBe(join(process.cwd(), 'public', 'fonts', 'NotoSansSC-Bold.otf'));

    const css = buildFileBackedExportFontCSS(files);
    expect(css).toContain("font-family: 'Noto Sans SC'");
    expect(css).toContain("font-family: 'Inter'");
    expect(css).toContain('NotoSansSC-Regular.otf');
    expect(css).toContain('format(\'opentype\')');
  });

  it('renders export HTML with local CJK font aliases instead of Google Fonts', async () => {
    const resume = {
      id: 'resume-font-test',
      userId: 'user-font-test',
      title: '中文 PDF 导出测试',
      template: 'modern',
      language: 'zh',
      themeConfig: { fontFamily: 'Inter' },
      sections: [
        {
          id: 'personal-info',
          resumeId: 'resume-font-test',
          type: 'personal_info',
          title: '个人信息',
          visible: true,
          order: 0,
          content: {
            fullName: '张三',
            jobTitle: 'Unity 客户端工程师',
            email: 'zhangsan@example.com',
          },
        },
        {
          id: 'summary',
          resumeId: 'resume-font-test',
          type: 'summary',
          title: '个人简介',
          visible: true,
          order: 1,
          content: { text: '中文正文和 English text 都应在 PDF 中可读。' },
        },
      ],
    } as unknown as ResumeWithSections;
    const html = await generateHtml(resume, true);

    expect(html).toContain('中文正文和 English text');
    expect(html).toContain('--jade-export-sans');
    expect(html).toContain('Noto Sans CJK SC');
    expect(html).toContain('Microsoft YaHei');
    expect(html).toContain('[style*="Inter"]');
    expect(html).toContain('NotoSansSC-Regular.otf');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    expect(composeExportFontCSS()).toContain(EXPORT_LOCAL_FONT_CSS.trim().slice(0, 40));
  });
});
