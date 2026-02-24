import { Sidebar } from "@/components/layout/sidebar";

export default function DesktopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-56">
        {children}
      </main>
    </div>
  );
}
