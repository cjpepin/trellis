interface Props {
  title: string;
  x: number;
  y: number;
}

export function NodeTooltip({ title, x, y }: Props) {
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-field border border-trellis-accent/20 bg-trellis-surface-2 px-3 py-2 text-xs text-trellis-text shadow-glow"
      style={{ left: x + 14, top: y - 12 }}
    >
      {title}
    </div>
  );
}
