/**
 * Font stacks used by server-side resume/interview export.
 *
 * PDF rendering happens on the self-hosted server, so the exported artifact must
 * prefer fonts that are available locally on common Linux VPS images after the
 * documented CJK font package is installed.  The generated PDF embeds the used
 * glyphs, which keeps Chinese text readable when the file is opened later on
 * Windows/macOS machines that do not have the same Linux fonts.
 */

export const EXPORT_CJK_SAMPLE = '中文字体导出检测';

const CSS_UNSAFE_CHARS = /[;{}<>]/;

function quoteFontFamily(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || CSS_UNSAFE_CHARS.test(trimmed)) return null;
  const normalized = trimmed.replace(/["'\\]/g, '');
  return normalized ? `'${normalized}'` : null;
}

const SANS_FALLBACKS = [
  'Noto Sans SC',
  'Noto Sans CJK SC',
  'Source Han Sans SC',
  'Microsoft YaHei',
  'PingFang SC',
  'Hiragino Sans GB',
  'WenQuanYi Zen Hei',
  'Arial Unicode MS',
  'Arial',
  'Helvetica',
];

const SERIF_FALLBACKS = [
  'Noto Serif SC',
  'Noto Serif CJK SC',
  'Source Han Serif SC',
  'SimSun',
  'Songti SC',
  'PMingLiU',
  'Georgia',
  'Times New Roman',
];

const MONO_FALLBACKS = [
  'JetBrains Mono',
  'Fira Code',
  'Noto Sans Mono CJK SC',
  'WenQuanYi Zen Hei Mono',
  'Microsoft YaHei Mono',
  'Consolas',
  'Courier New',
];

function buildStack(preferred: string | undefined, fallbacks: string[], generic: string): string {
  const ordered = [preferred, ...fallbacks]
    .map((font) => (font ? quoteFontFamily(font) : null))
    .filter((font): font is string => Boolean(font));
  return [...new Set(ordered), generic].join(', ');
}

export function buildSansFontStack(preferred?: string): string {
  return buildStack(preferred, SANS_FALLBACKS, 'sans-serif');
}

export function buildSerifFontStack(preferred?: string): string {
  return buildStack(preferred, SERIF_FALLBACKS, 'serif');
}

export function buildMonoFontStack(preferred?: string): string {
  return buildStack(preferred, MONO_FALLBACKS, 'monospace');
}

export const EXPORT_SANS_FONT_STACK = buildSansFontStack('Inter');
export const EXPORT_SERIF_FONT_STACK = buildSerifFontStack();
export const EXPORT_MONO_FONT_STACK = buildMonoFontStack();

/**
 * Local aliases normalize Google's web-font family names to fonts actually
 * installed on Linux (`fonts-noto-cjk` exposes `Noto Sans CJK SC`, not
 * `Noto Sans SC`).  No external network request is required for PDF export.
 */
export const EXPORT_LOCAL_FONT_CSS = `
  @font-face {
    font-family: 'Noto Sans SC';
    src: local('Noto Sans CJK SC'), local('Noto Sans CJK SC Regular'), local('Microsoft YaHei'), local('WenQuanYi Zen Hei');
    font-style: normal;
    font-weight: 300 900;
    font-display: swap;
  }
  @font-face {
    font-family: 'Noto Serif SC';
    src: local('Noto Serif CJK SC'), local('Noto Serif CJK SC Regular'), local('SimSun'), local('Songti SC');
    font-style: normal;
    font-weight: 300 900;
    font-display: swap;
  }
  @font-face {
    font-family: 'Noto Sans Mono CJK SC';
    src: local('Noto Sans Mono CJK SC'), local('WenQuanYi Zen Hei Mono'), local('Microsoft YaHei Mono');
    font-style: normal;
    font-weight: 300 900;
    font-display: swap;
  }
  :root, :host {
    --jade-export-sans: ${EXPORT_SANS_FONT_STACK};
    --jade-export-serif: ${EXPORT_SERIF_FONT_STACK};
    --jade-export-mono: ${EXPORT_MONO_FONT_STACK};
    --font-sans: var(--jade-export-sans);
    --font-mono: var(--jade-export-mono);
    --default-font-family: var(--jade-export-sans);
    --default-mono-font-family: var(--jade-export-mono);
  }
  html, body, .resume-export {
    font-family: var(--jade-export-sans);
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .resume-export code,
  .resume-export pre,
  .resume-export kbd,
  .resume-export samp,
  .resume-export [style*="monospace"],
  .resume-export [style*="JetBrains"],
  .resume-export [style*="Consolas"],
  .resume-export [style*="Courier"] {
    font-family: var(--jade-export-mono) !important;
  }
  .resume-export [style*="Georgia"],
  .resume-export [style*="Times New Roman"],
  .resume-export [style*="serif"] {
    font-family: var(--jade-export-serif) !important;
  }
`;
