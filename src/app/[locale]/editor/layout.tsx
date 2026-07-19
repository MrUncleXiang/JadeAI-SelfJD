import { WorkspaceAuthGate } from '@/components/auth/workspace-auth-gate';

export default function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-screen overflow-hidden bg-zinc-50"><WorkspaceAuthGate>{children}</WorkspaceAuthGate></div>;
}
