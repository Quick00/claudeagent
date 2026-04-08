'use client';

import { use } from 'react';
import ChatPage from '@/components/ChatPage';

export default function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ChatPage initialConversationId={id} />;
}
