import { BottomNav } from '@/components/mobile/bottom-nav';

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100">
      <div className="pb-20">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
