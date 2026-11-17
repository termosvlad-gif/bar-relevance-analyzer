import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "БАР — ИИ-агент контент-фабрики · Stage 4.0",
  description: "Передача полного SEO-отчёта БАР агенту для последующей экспертизы и согласования правок.",
};

export default function AgentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
