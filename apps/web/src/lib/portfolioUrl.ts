export const portfolioHome =
  import.meta.env.VITE_PORTFOLIO_URL?.trim() || "https://connorjpepin.com/";

export const portfolioProjects = `${portfolioHome.replace(/\/$/, "")}/#projects`;
