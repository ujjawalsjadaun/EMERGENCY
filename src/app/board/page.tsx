import type { Metadata } from "next";
import { BoardApp } from "@/components/board-app";

export const metadata: Metadata = { title: "Campus Pulse" };

export default function BoardPage() {
  return <BoardApp />;
}
