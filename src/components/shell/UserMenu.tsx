'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { LogOut, MessageSquarePlus, Monitor, Moon, Sun } from 'lucide-react';
import FeedbackModal from '@/components/FeedbackModal';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { ShellUser } from './AppShell';

/** "Ada Lovelace" → "AL", "ada@example.com" → "A", nothing → "?". */
function initials(user: ShellUser): string {
  const source = user.name?.trim() || user.email?.trim() || '';
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
  return letters
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function UserMenu({
  user,
  showLabel = false,
  className,
}: {
  user: ShellUser;
  /** The mobile footer has room for the name; the rail does not. */
  showLabel?: boolean;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const label = user.name ?? user.email ?? 'Account';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={showLabel ? 'default' : 'icon'}
            className={cn(showLabel ? 'w-full justify-start gap-2' : 'rounded-full', className)}
          >
            <Avatar size="sm">
              {user.image && <AvatarImage src={user.image} alt="" />}
              <AvatarFallback>{initials(user)}</AvatarFallback>
            </Avatar>
            {showLabel ? <span className="truncate">{label}</span> : <span className="sr-only">{label}</span>}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate font-medium">{label}</span>
            {user.email && (
              <span className="text-muted-foreground truncate text-xs font-normal">
                {user.email}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            Theme
          </DropdownMenuLabel>
          <div className="px-2 pb-1.5">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={theme ?? 'system'}
              onValueChange={(value) => value && setTheme(value)}
              className="w-full *:flex-1"
            >
              <ToggleGroupItem value="system" aria-label="System theme">
                <Monitor />
              </ToggleGroupItem>
              <ToggleGroupItem value="light" aria-label="Light theme">
                <Sun />
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label="Dark theme">
                <Moon />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setFeedbackOpen(true)}>
            <MessageSquarePlus />
            Send feedback
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
