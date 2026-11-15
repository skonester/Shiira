// Fractional pane bounds; the renderer adds a 6px gutter inside each rectangle.
export function splitRects(count, layout = 'columns', ratio = 0.5) {
  if (!Number.isInteger(count) || count < 2 || count > 4) return [];
  ratio = Math.max(0.2, Math.min(0.8, Number(ratio) || 0.5));
  if (count === 2) return layout === 'rows'
    ? [{ x: 0, y: 0, width: 1, height: ratio }, { x: 0, y: ratio, width: 1, height: 1 - ratio }]
    : [{ x: 0, y: 0, width: ratio, height: 1 }, { x: ratio, y: 0, width: 1 - ratio, height: 1 }];
  if (layout === 'rows') return Array.from({ length: count }, (_, i) => ({ x: 0, y: i / count, width: 1, height: 1 / count }));
  if (layout === 'columns') return Array.from({ length: count }, (_, i) => ({ x: i / count, y: 0, width: 1 / count, height: 1 }));
  if (count === 3) return [{ x: 0, y: 0, width: .5, height: 1 }, { x: .5, y: 0, width: .5, height: .5 }, { x: .5, y: .5, width: .5, height: .5 }];
  return Array.from({ length: 4 }, (_, i) => ({ x: (i % 2) / 2, y: Math.floor(i / 2) / 2, width: .5, height: .5 }));
}
