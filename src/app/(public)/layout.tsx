export default function PublicLayout({ children }: { children: React.ReactNode }) {
  // Login, pending and maintenance render outside the shell. They supply a
  // Card; this centres it.
  return (
    <div className="bg-muted/40 flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
