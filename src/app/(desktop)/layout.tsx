import { Sidebar } from "@/components/layout/sidebar";
import { UpdateBanner } from "@/components/layout/update-banner";

export default function DesktopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-56 flex flex-col">
        <UpdateBanner />
        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}
