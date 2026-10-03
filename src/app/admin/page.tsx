import type { Metadata } from "next";
import { AdminApp } from "@/components/admin-app";

export const metadata: Metadata = { title: "Command Center" };

export default function AdminPage() {
  return <AdminApp />;
}
