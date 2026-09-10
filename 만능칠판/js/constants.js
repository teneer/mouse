export const VERSION = '4.0.0';
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;
export const DEFAULT_BG = '#D6B588';
export const SERIAL_PROPS = ['id', 'isHighlighter'];
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;
export const uid = () => crypto.randomUUID();
export const clone = value => structuredClone(value);
export function emptyContent(width = 1280, height = 720) {
  return {canvas: {version: '5.3.1', objects: [], background: DEFAULT_BG},
    frame: {width, height, cx: 0, cy: 0}};
}
