const MAX_COLUMNS = 6;
const MIN_READABLE_WIDTH = 72;
const MAX_CARD_WIDTH = 220;
const COLUMN_CHANGE_MARGIN = 0.03;

export function measureTeamLayout({ width, height, count, ratio, gap, fixedColumns, previousColumns, maxAutoColumns = MAX_COLUMNS, scale = 1, minimumWidth }) {
  const maxWidth = Math.min(width, MAX_CARD_WIDTH, MAX_CARD_WIDTH * scale);
  const widthFor = columns => Math.max(0, Math.min(maxWidth, (width - gap * (columns - 1)) / columns));
  const readableWidth = minimumWidth === undefined
    ? Math.min(MIN_READABLE_WIDTH, maxWidth)
    : Math.min(minimumWidth, MAX_CARD_WIDTH, MAX_CARD_WIDTH * scale);

  const maxOccupiedColumns = Math.min(MAX_COLUMNS, Math.max(1, count));
  if (fixedColumns) {
    const columns = Math.min(fixedColumns, maxOccupiedColumns);
    return { columns, cardWidth: Math.max(readableWidth, widthFor(columns)) };
  }

  const candidates = [];
  for (let columns = 1; columns <= Math.min(maxOccupiedColumns,maxAutoColumns); columns++) {
    const rows = Math.max(1, Math.ceil(count / columns));
    const horizontalWidth = widthFor(columns);
    const verticalWidth = Math.max(0, (height - gap * (rows - 1)) * ratio / rows);
    candidates.push({ columns, horizontalWidth, rows, cardWidth: Math.min(horizontalWidth, verticalWidth) });
  }

  const best = candidates.reduce((largest, item) => item.cardWidth > largest.cardWidth ? item : largest);
  if (best.cardWidth < readableWidth) {
    // When readable cards require scrolling, choose the arrangement with the shortest scroll.
    const fitting = candidates.filter(item => item.horizontalWidth >= readableWidth);
    const shortest = fitting.reduce((first, item) => item.rows < first.rows ? item : first, candidates[0]);
    return { columns: shortest.columns, cardWidth: readableWidth };
  }

  const previous = candidates.find(item => item.columns === previousColumns);
  const chosen = previous && previous.cardWidth >= readableWidth &&
    previous.cardWidth >= best.cardWidth * (1 - COLUMN_CHANGE_MARGIN) ? previous : best;
  return { columns: chosen.columns, cardWidth: chosen.cardWidth };
}
