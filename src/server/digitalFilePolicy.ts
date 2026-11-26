// Pure, zero-dependency digital product file policy shared by frontend and backend.
// Supports audio (.mp3, .wav, ...), video (.mp4, .mov, .mkv, ...), documents, images,
// archives, ebooks, fonts, CAD/design, and other non-executable file types while blocking
// active web scripts and executable binaries for user and platform safety.

export const MAX_DIGITAL_FILE_SIZE = 200 * 1024 * 1024; // 200 MB for admin uploads
export const MAX_DIGITAL_DOWNLOAD_BYTES = 250 * 1024 * 1024; // 250 MB proxy download cap

export const BLOCKED_DIGITAL_EXTENSIONS = new Set([
  // Active web markup / scripts (XSS vectors if rendered)
  'html', 'htm', 'xhtml', 'shtml', 'mhtml', 'mht', 'svg', 'svgz',
  'js', 'mjs', 'cjs', 'jse', 'vbs', 'vbe', 'hta',
  // Server-side executable scripts
  'php', 'phtml', 'phar', 'asp', 'aspx', 'jsp', 'jspx', 'cgi',
  // OS executables, installers, dynamic libraries & shell scripts
  'exe', 'msi', 'msp', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl',
  'dll', 'sys', 'drv', 'ps1', 'psm1', 'wsf', 'wsh', 'reg', 'lnk', 'inf',
  'sh', 'bash', 'zsh',
]);

export const DANGEROUS_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-csh',
  'application/x-httpd-php',
]);

export const DIGITAL_EXTENSION_TO_MIME: Record<string, string> = {
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  wma: 'audio/x-ms-wma',
  amr: 'audio/amr',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  mid: 'audio/midi',
  midi: 'audio/midi',

  // Video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  ogv: 'video/ogg',
  ts: 'video/mp2t',

  // Documents & E-Books
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  djvu: 'image/vnd.djvu',

  // Images & Design
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  psd: 'image/vnd.adobe.photoshop',
  ai: 'application/postscript',
  eps: 'application/postscript',

  // Archives & Bundles
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',

  // Fonts, Data & Subtitles
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'text/plain; charset=utf-8',
  yml: 'text/plain; charset=utf-8',
  srt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  ics: 'text/calendar; charset=utf-8',
  vcf: 'text/vcard; charset=utf-8',
};

const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wma', 'amr', 'aiff', 'aif', 'mid', 'midi']);
const VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', '3gp', '3g2', 'mpeg', 'mpg', 'ogv', 'ts']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'ico', 'avif', 'heic', 'heif', 'psd', 'ai', 'eps', 'cdr']);
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']);
const DOCUMENT_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'md', 'csv', 'tsv', 'epub', 'mobi', 'azw3', 'djvu', 'pages', 'numbers', 'key']);

export type DigitalFileKind = 'audio' | 'video' | 'pdf' | 'image' | 'archive' | 'document' | 'file';

export function getDigitalFileExtension(fileName: string): string {
  const clean = String(fileName || '').trim();
  const dotIdx = clean.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === clean.length - 1) return '';
  return clean.slice(dotIdx + 1).toLowerCase().trim();
}

export function isValidExtensionSyntax(ext: string): boolean {
  return /^[a-z0-9]{1,15}$/.test(ext);
}

export function isAllowedDigitalExtension(ext: string): boolean {
  const normalized = String(ext || '').toLowerCase().trim();
  if (!isValidExtensionSyntax(normalized)) return false;
  if (BLOCKED_DIGITAL_EXTENSIONS.has(normalized)) return false;
  return true;
}

export function getDigitalExtensionError(ext: string): string {
  const normalized = String(ext || '').toLowerCase().trim();
  if (!normalized) {
    return 'File name must include a valid file extension (for example .mp3, .mp4, .pdf, .zip, .docx, .png).';
  }
  if (BLOCKED_DIGITAL_EXTENSIONS.has(normalized)) {
    return `Executable or web-script file type (.${normalized}) is not allowed for security. Wrap code templates inside a .zip archive instead.`;
  }
  return `Unsupported or invalid file extension (.${normalized}). Use a standard file extension such as .mp3, .mp4, .pdf, .zip, .docx, or .png.`;
}

export function getCanonicalDigitalMime(ext: string, declaredMime?: string | null): string {
  const normalizedExt = String(ext || '').toLowerCase().trim();
  const mapped = DIGITAL_EXTENSION_TO_MIME[normalizedExt];
  if (mapped) {
    // Strip charset suffix for Firebase Storage contentType metadata consistency
    return mapped.split(';')[0].trim();
  }
  const cleanDeclared = String(declaredMime || '').split(';')[0].toLowerCase().trim();
  if (cleanDeclared && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(cleanDeclared) && !DANGEROUS_MIME_TYPES.has(cleanDeclared)) {
    return cleanDeclared;
  }
  return 'application/octet-stream';
}

export function resolveSafeDownloadContentType(ext: string, upstreamContentType?: string | null): string {
  const normalizedExt = String(ext || '').toLowerCase().trim();
  const mapped = DIGITAL_EXTENSION_TO_MIME[normalizedExt];
  if (mapped) return mapped;

  const cleanUpstream = String(upstreamContentType || '').split(';')[0].toLowerCase().trim();
  if (
    cleanUpstream &&
    /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(cleanUpstream) &&
    !DANGEROUS_MIME_TYPES.has(cleanUpstream)
  ) {
    return cleanUpstream;
  }
  return 'application/octet-stream';
}

export function getDigitalFileKind(fileNameOrExt: string): DigitalFileKind {
  const raw = String(fileNameOrExt || '').trim().toLowerCase();
  const ext = raw.includes('.') ? getDigitalFileExtension(raw) : raw;
  if (ext === 'pdf') return 'pdf';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (DOCUMENT_EXTS.has(ext)) return 'document';
  return 'file';
}

export function getDigitalFileBadgeLabel(fileNameOrExt: string): string {
  const raw = String(fileNameOrExt || '').trim();
  const ext = raw.includes('.') ? getDigitalFileExtension(raw) : raw.toLowerCase();
  return ext ? ext.toUpperCase().slice(0, 8) : 'FILE';
}

export function getDigitalFileTypeHint(fileNameOrExt: string): {
  kind: DigitalFileKind;
  badge: string;
  badgeClass: string;
  label: string;
} {
  const kind = getDigitalFileKind(fileNameOrExt);
  const badge = getDigitalFileBadgeLabel(fileNameOrExt);
  switch (kind) {
    case 'audio':
      return { kind, badge, badgeClass: 'bg-purple-100 text-purple-800 border-purple-200', label: 'Audio' };
    case 'video':
      return { kind, badge, badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-200', label: 'Video' };
    case 'pdf':
      return { kind, badge, badgeClass: 'bg-rose-100 text-rose-800 border-rose-200', label: 'PDF' };
    case 'image':
      return { kind, badge, badgeClass: 'bg-amber-100 text-amber-800 border-amber-200', label: 'Image' };
    case 'archive':
      return { kind, badge, badgeClass: 'bg-teal-100 text-teal-800 border-teal-200', label: 'Archive' };
    case 'document':
      return { kind, badge, badgeClass: 'bg-blue-100 text-blue-800 border-blue-200', label: 'Document' };
    default:
      return { kind, badge, badgeClass: 'bg-slate-100 text-slate-700 border-slate-200', label: 'Digital File' };
  }
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
