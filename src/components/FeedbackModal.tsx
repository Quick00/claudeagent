'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TiptapLink from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { apiFetch, jsonBody } from '@/lib/api';
import {
  ArrowLeft,
  Bold,
  Bug,
  CircleCheck,
  Image as ImageIcon,
  Italic,
  Lightbulb,
  Link as LinkIcon,
  List,
  MessageSquarePlus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { markdownProseClass } from '@/components/shared/MarkdownContent';

type FeedbackType = 'FEATURE_REQUEST' | 'BUG';
type Step = 'type' | 'form';

interface UploadedImage {
  id: string;
  filename: string;
  url: string;
}

interface FeedbackModalProps {
  /** Standard shadcn Dialog control. Omit both to fall back to an internal
   * trigger button (used when the modal manages its own visibility). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

async function safeResponseError(res: Response, fallback: string): Promise<string> {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    return data.error || fallback;
  }
  const text = await res.text();
  return text || fallback;
}

export default function FeedbackModal({ open: openProp, onOpenChange: onOpenChangeProp }: FeedbackModalProps) {
  const { status } = useSession();
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? (openProp ?? false) : internalOpen;

  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<FeedbackType | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const feedbackMutation = useMutation({
    mutationFn: (payload: { type: FeedbackType; title: string; description: string; imageId?: string }) =>
      apiFetch('/api/feedback', jsonBody('POST', payload)),
    onSuccess: () => setSubmitted(true),
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to submit feedback'),
  });

  const onEditorUpdate = useCallback(({ editor: e }: { editor: ReturnType<typeof useEditor> }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (e) setDescription((e.storage as any).markdown.getMarkdown());
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, blockquote: false, horizontalRule: false }),
      TiptapLink.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Describe your request' }),
      Markdown,
    ],
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[5rem] max-h-40 overflow-y-auto px-3 py-2',
      },
    },
    onUpdate: onEditorUpdate,
    immediatelyRender: false,
  });

  const reset = useCallback(() => {
    setStep('type');
    setType(null);
    setTitle('');
    setDescription('');
    setImage(null);
    setUploading(false);
    setSubmitted(false);
    setError(null);
  }, []);

  // The Dialog can be opened either by our own trigger or, when controlled,
  // by a parent (the shell's user menu) — either way the form must start
  // clean, so this reacts to `open` rather than to a click handler.
  useEffect(() => {
    if (open) {
      reset();
      editor?.commands.clearContent();
      feedbackMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setOpen = (next: boolean) => {
    onOpenChangeProp?.(next);
    if (!controlled) setInternalOpen(next);
  };

  const handleSelectType = (t: FeedbackType) => {
    setType(t);
    setStep('form');
  };

  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (status !== 'authenticated') {
      setError('Please sign in to upload images');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Only PNG, JPEG, GIF, and WebP images are allowed');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('File must be under 5 MB');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        setError(await safeResponseError(res, 'Upload failed'));
        return;
      }
      const data = await res.json();
      setImage({ id: data.id, filename: data.filename, url: data.url });
    } catch {
      setError('Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = () => {
    if (!type || !title.trim() || !description.trim() || feedbackMutation.isPending || uploading) return;
    if (status !== 'authenticated') {
      setError('Please sign in to submit feedback');
      return;
    }
    setError(null);
    feedbackMutation.mutate({
      type,
      title: title.trim(),
      description: description.trim(),
      imageId: image?.id || undefined,
    });
  };

  const openLink = () => {
    setLinkUrl(editor?.getAttributes('link').href ?? '');
    setLinkPopoverOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (url) {
      editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    } else {
      editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    }
    setLinkPopoverOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button variant="secondary" className="w-full justify-center gap-2">
            <MessageSquarePlus className="size-4" />
            Feedback
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <div key={submitted ? 'submitted' : step} className="animate-in fade-in-0">
          {submitted ? (
            <div className="text-center">
              <CircleCheck className="mx-auto mb-3 size-10 text-success" />
              <DialogTitle>Thank you!</DialogTitle>
              <DialogDescription className="mt-1">
                Your feedback has been submitted.
              </DialogDescription>
              <Button className="mt-4" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          ) : step === 'type' ? (
            <>
              <DialogHeader>
                <DialogTitle>Give us feedback</DialogTitle>
                <DialogDescription>
                  Tell us how we could make the product more useful for you.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-2">
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start gap-3 py-3 text-left"
                  onClick={() => handleSelectType('FEATURE_REQUEST')}
                >
                  <Lightbulb className="size-5" />
                  <span className="text-sm font-medium">Feature Request</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start gap-3 py-3 text-left"
                  onClick={() => handleSelectType('BUG')}
                >
                  <Bug className="size-5" />
                  <span className="text-sm font-medium">Bug</span>
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {type === 'FEATURE_REQUEST' ? (
                    <Lightbulb className="size-4" />
                  ) : (
                    <Bug className="size-4" />
                  )}
                  {type === 'FEATURE_REQUEST' ? 'Feature Request' : 'Bug'}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Describe your {type === 'FEATURE_REQUEST' ? 'feature request' : 'bug report'}
                </DialogDescription>
              </DialogHeader>

              <Input
                type="text"
                placeholder="Have something to say?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="mt-4 mb-3"
              />

              <div className="mb-3 rounded-md border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Toggle
                        size="sm"
                        aria-label="Bold"
                        pressed={editor?.isActive('bold') ?? false}
                        onPressedChange={() => editor?.chain().focus().toggleBold().run()}
                      >
                        <Bold />
                      </Toggle>
                    </TooltipTrigger>
                    <TooltipContent>Bold</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Toggle
                        size="sm"
                        aria-label="Italic"
                        pressed={editor?.isActive('italic') ?? false}
                        onPressedChange={() => editor?.chain().focus().toggleItalic().run()}
                      >
                        <Italic />
                      </Toggle>
                    </TooltipTrigger>
                    <TooltipContent>Italic</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Toggle
                        size="sm"
                        aria-label="Bullet list"
                        pressed={editor?.isActive('bulletList') ?? false}
                        onPressedChange={() => editor?.chain().focus().toggleBulletList().run()}
                      >
                        <List />
                      </Toggle>
                    </TooltipTrigger>
                    <TooltipContent>List</TooltipContent>
                  </Tooltip>
                  <Popover open={linkPopoverOpen} onOpenChange={setLinkPopoverOpen}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <Toggle
                            size="sm"
                            aria-label="Link"
                            pressed={editor?.isActive('link') ?? false}
                            onPressedChange={openLink}
                          >
                            <LinkIcon />
                          </Toggle>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent>Link</TooltipContent>
                    </Tooltip>
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Upload image"
                        disabled={uploading || status !== 'authenticated'}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <ImageIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Upload image</TooltipContent>
                  </Tooltip>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handleUpload}
                    className="hidden"
                  />
                </div>
                <EditorContent editor={editor} className={markdownProseClass('compact')} />
              </div>

              {image && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="truncate text-muted-foreground">{image.filename}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove image"
                    onClick={() => setImage(null)}
                  >
                    <X />
                  </Button>
                </div>
              )}

              {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

              <div className="flex items-center justify-between">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Back"
                      onClick={() => {
                        setStep('type');
                        setType(null);
                      }}
                    >
                      <ArrowLeft />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Back</TooltipContent>
                </Tooltip>
                <Button
                  onClick={handleSubmit}
                  disabled={!title.trim() || !description.trim() || feedbackMutation.isPending || uploading}
                >
                  {feedbackMutation.isPending ? 'Submitting...' : 'Create A New Post'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
