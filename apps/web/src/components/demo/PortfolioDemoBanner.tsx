import { portfolioProjects } from "@/lib/portfolioUrl";

export function PortfolioDemoBanner() {
  return (
    <div className="shrink-0 border-b border-trellis-border bg-trellis-surface px-4 py-2 text-center text-sm text-trellis-muted">
      <span>Trellis demo on Connor Pepin&apos;s portfolio — </span>
      <a href={portfolioProjects} className="font-medium text-trellis-accent hover:underline">
        Back to portfolio
      </a>
    </div>
  );
}
