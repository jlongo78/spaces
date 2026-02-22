export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 bg-zinc-950" style={{ marginLeft: 0 }}>
      {children}
    </div>
  );
}
