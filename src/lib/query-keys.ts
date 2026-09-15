/**
 * Every query key in the app, in one place.
 *
 * Keys are hierarchical so a mutation can invalidate a whole area with one
 * call: `invalidateQueries({ queryKey: qk.conversations.all })` catches both
 * the list and every individual conversation. Inventing key arrays at call
 * sites is what makes invalidation silently miss — a typo'd key invalidates
 * nothing and fails quietly, so always come through here.
 */
export const qk = {
  conversations: {
    all: ['conversations'] as const,
    list: () => [...qk.conversations.all, 'list'] as const,
    detail: (id: string) => [...qk.conversations.all, 'detail', id] as const,
    adminList: () => [...qk.conversations.all, 'admin-list'] as const,
  },
  claude: {
    all: ['claude'] as const,
    status: () => [...qk.claude.all, 'status'] as const,
  },
  flags: {
    all: ['flags'] as const,
    forConversation: (id: string) => [...qk.flags.all, 'conversation', id] as const,
    notifications: () => [...qk.flags.all, 'notifications'] as const,
    adminNotifications: () => [...qk.flags.all, 'admin-notifications'] as const,
    adminList: (status?: string) => [...qk.flags.all, 'admin-list', status ?? 'all'] as const,
  },
  feedback: {
    all: ['feedback'] as const,
    adminList: (status?: string) => [...qk.feedback.all, 'admin-list', status ?? 'all'] as const,
  },
  users: {
    all: ['users'] as const,
    list: () => [...qk.users.all, 'list'] as const,
    conversations: (userId: string) => [...qk.users.all, userId, 'conversations'] as const,
  },
  adminConversation: {
    messages: (id: string) => ['admin-conversation', id, 'messages'] as const,
  },
  repos: {
    all: ['repos'] as const,
    list: () => [...qk.repos.all, 'list'] as const,
    gitlabSearch: (q: string) => [...qk.repos.all, 'gitlab-search', q] as const,
  },
  knowledge: {
    all: ['knowledge'] as const,
    attention: () => [...qk.knowledge.all, 'attention'] as const,
    graph: () => [...qk.knowledge.all, 'graph'] as const,
    entries: () => [...qk.knowledge.all, 'entries'] as const,
    dashboard: () => [...qk.knowledge.all, 'dashboard'] as const,
    search: (q: string) => [...qk.knowledge.all, 'search', q] as const,
  },
  settings: {
    all: ['settings'] as const,
    admin: () => [...qk.settings.all, 'admin'] as const,
  },
} as const;
