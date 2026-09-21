'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Circle, CircleCheck, CircleAlert } from 'lucide-react';
import { apiFetch, jsonBody } from '@/lib/api';
import { navigateTo } from '@/lib/navigate';
import { qk } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RiseIn } from '@/components/shared/RiseIn';

interface McpServer {
  id: string;
  name: string;
  connectionStatus: 'CONNECTED' | 'ERROR' | 'NOT_CONNECTED';
  lastError: string | null;
}

export default function McpServerConnections() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * A connect that fails at the authorization server comes back as a redirect
   * to this page carrying `mcp_error`. The param is dropped again once shown,
   * so a refresh does not repeat an error the user has already read. It goes
   * through the toast as text, never as markup — it is a message relayed from
   * a third-party server.
   */
  const connectError = searchParams.get('mcp_error');
  useEffect(() => {
    if (!connectError) return;
    toast.error(connectError);
    const remaining = new URLSearchParams(searchParams.toString());
    remaining.delete('mcp_error');
    const query = remaining.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [connectError, pathname, router, searchParams]);

  const { data: servers = [], isPending, isError } = useQuery({
    queryKey: qk.mcpServers.userList(),
    queryFn: ({ signal }) => apiFetch<McpServer[]>('/api/mcp-servers', { signal }),
  });

  const connectMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ authorizationUrl: string }>(`/api/mcp-servers/${id}/connect`, jsonBody('POST')),
    onSuccess: ({ authorizationUrl }) => {
      navigateTo(authorizationUrl);
    },
    onError: () => toast.error('Failed to start connection'),
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/mcp-servers/${id}/disconnect`, jsonBody('POST')),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.mcpServers.userList() }),
    onError: () => toast.error('Failed to disconnect'),
  });

  // Nothing is rendered while the list loads: a placeholder card here would
  // only be taken away again for the two outcomes that render nothing (no
  // servers registered, or a list this user has none of), so the section
  // rises into place once it has something to say instead of appearing and
  // then vanishing.
  if (isPending) return null;

  // Rendering nothing here is indistinguishable from a deployment with no MCP servers.
  if (isError) {
    return (
      <RiseIn>
        <Card>
          <CardHeader>
            <CardTitle>MCP Servers</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">Couldn&rsquo;t load your MCP server connections.</p>
          </CardContent>
        </Card>
      </RiseIn>
    );
  }

  if (servers.length === 0) return null;

  return (
    <RiseIn>
      <Card>
        <CardHeader>
          <CardTitle>MCP Servers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {servers.map((server) => (
            <div key={server.id} className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  {server.connectionStatus === 'CONNECTED' && <CircleCheck className="size-4 text-success" />}
                  {server.connectionStatus === 'ERROR' && <CircleAlert className="size-4 text-destructive" />}
                  {server.connectionStatus === 'NOT_CONNECTED' && <Circle className="size-4 text-muted-foreground" />}
                  <span className="text-sm font-medium">{server.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {server.connectionStatus === 'CONNECTED' ? 'Connected' : server.connectionStatus === 'ERROR' ? 'Needs reconnecting' : 'Not connected'}
                  </span>
                </div>
                {server.lastError && <p className="mt-1 text-xs text-destructive">{server.lastError}</p>}
              </div>
              {server.connectionStatus === 'CONNECTED' ? (
                <Button variant="destructive" size="sm" onClick={() => disconnectMutation.mutate(server.id)}>
                  Disconnect
                </Button>
              ) : (
                <Button size="sm" onClick={() => connectMutation.mutate(server.id)}>
                  {server.connectionStatus === 'ERROR' ? 'Reconnect' : 'Connect'}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </RiseIn>
  );
}
