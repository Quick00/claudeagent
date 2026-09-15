'use client';

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TiptapLink from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { Bold, Heading2, Italic, Link as LinkIcon, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { markdownProseClass } from '@/components/shared/MarkdownContent';
import { cn } from '@/lib/utils';

/** `tiptap-markdown` augments the editor storage but ships no types for it. */
function readMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
}

function ToolbarToggle({
  label,
  icon: Icon,
  pressed,
  onPress,
  asPopoverTrigger,
}: {
  label: string;
  icon: ComponentType;
  pressed: boolean;
  onPress: () => void;
  asPopoverTrigger?: boolean;
}) {
  const toggle = (
    <Toggle size="sm" aria-label={label} pressed={pressed} onPressedChange={onPress}>
      <Icon />
    </Toggle>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {asPopoverTrigger ? <PopoverTrigger asChild>{toggle}</PopoverTrigger> : toggle}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export interface MarkdownEditorProps {
  /** Markdown source. Changing it from outside replaces the document. */
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /**
   * Headings, code blocks, quotes and rules. Off for short free text such as
   * feedback; on wherever the stored value is a real document, so existing
   * markdown survives the round trip instead of being flattened on save.
   */
  blocks?: boolean;
  /** Sizing for the writing area — every caller wants its own height. */
  editorClassName?: string;
  /** Extra toolbar controls, rendered after the built-in ones. */
  toolbarExtra?: ReactNode;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  blocks = false,
  editorClassName = 'min-h-[5rem] max-h-40 overflow-y-auto',
  toolbarExtra,
  id,
  'aria-label': ariaLabel,
  className,
}: MarkdownEditorProps) {
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  // `onUpdate` is captured when the editor is built; a ref keeps the latest
  // handler without tearing the editor down on every parent render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      // `link: false` everywhere — StarterKit ships its own Link, and
      // registering both warns about a duplicate extension.
      StarterKit.configure(
        blocks
          ? { link: false }
          : { link: false, heading: false, codeBlock: false, code: false, blockquote: false, horizontalRule: false },
      ),
      TiptapLink.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Markdown,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: cn('outline-none px-3 py-2', editorClassName),
        ...(id ? { id } : {}),
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
    },
    onUpdate: ({ editor: e }) => onChangeRef.current(readMarkdown(e)),
    immediatelyRender: false,
  });

  // Reflect resets and other outside writes. Comparing against the serialised
  // document first keeps the caret still while the user is typing, since the
  // value coming back is the one we just emitted.
  useEffect(() => {
    if (!editor || value === readMarkdown(editor)) return;
    editor.commands.setContent(value);
  }, [editor, value]);

  const openLink = () => {
    setLinkUrl(editor?.getAttributes('link').href ?? '');
    setLinkPopoverOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    const chain = editor?.chain().focus().extendMarkRange('link');
    if (url) chain?.setLink({ href: url }).run();
    else chain?.unsetLink().run();
    setLinkPopoverOpen(false);
  };

  return (
    <div
      className={cn(
        'rounded-md border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        className,
      )}
    >
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
        <ToolbarToggle
          label="Bold"
          icon={Bold}
          pressed={editor?.isActive('bold') ?? false}
          onPress={() => editor?.chain().focus().toggleBold().run()}
        />
        <ToolbarToggle
          label="Italic"
          icon={Italic}
          pressed={editor?.isActive('italic') ?? false}
          onPress={() => editor?.chain().focus().toggleItalic().run()}
        />
        {blocks && (
          <ToolbarToggle
            label="Heading"
            icon={Heading2}
            pressed={editor?.isActive('heading', { level: 2 }) ?? false}
            onPress={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
        )}
        <ToolbarToggle
          label="Bullet list"
          icon={List}
          pressed={editor?.isActive('bulletList') ?? false}
          onPress={() => editor?.chain().focus().toggleBulletList().run()}
        />
        <Popover open={linkPopoverOpen} onOpenChange={setLinkPopoverOpen}>
          <ToolbarToggle
            label="Link"
            icon={LinkIcon}
            pressed={editor?.isActive('link') ?? false}
            onPress={openLink}
            asPopoverTrigger
          />
          <PopoverContent className="w-64">
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={linkUrl}
                placeholder="https://example.com"
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyLink();
                  }
                }}
              />
              <Button size="sm" onClick={applyLink}>
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {toolbarExtra}
      </div>
      <EditorContent editor={editor} className={markdownProseClass('compact')} />
    </div>
  );
}
