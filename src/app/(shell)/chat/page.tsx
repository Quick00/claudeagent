import { ChatThread } from '@/components/chat/ChatThread';

export const metadata = { title: 'Chat' };

// Deliberately no key on the id: the first message replaces the URL with
// /chat/[id] via replaceState, and remounting here would drop the optimistic
// bubble mid-stream.
export default function NewChatPage() {
  return <ChatThread initialConversationId={null} />;
}
