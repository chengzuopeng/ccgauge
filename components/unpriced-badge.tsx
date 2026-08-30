export function UnpricedBadge({ label, title }: { label: string; title: string }) {
  return (
    <span
      className="pill bg-warning/10 text-warning border border-warning/20 text-[10px] whitespace-nowrap"
      title={title}
    >
      {label}
    </span>
  );
}
