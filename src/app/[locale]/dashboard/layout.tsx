import { Header } from '@/components/layout/header';
import { WorkspaceAuthGate } from '@/components/auth/workspace-auth-gate';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8"><WorkspaceAuthGate>{children}</WorkspaceAuthGate></main>
    </div>
  );
}
