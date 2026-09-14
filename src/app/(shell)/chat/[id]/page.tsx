import { ChatThread } from '@/components/chat/ChatThread';

export const metadata = { title: 'Chat' };

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed so switching conversations remounts with clean state.
  return <ChatThread key={id} initialConversationId={id} />;
}
