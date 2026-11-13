import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI SEO Editor — разбор ТЗ БАР",
  description: "Импорт Markdown-статьи и технического задания БАР, разбор рекомендаций по зонам и редакционная сортировка.",
};

export default function EditorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
