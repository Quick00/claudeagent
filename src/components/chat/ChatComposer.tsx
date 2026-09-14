'use client';

import { useCallback, useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { StarBorder } from '@/components/shared/StarBorder';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Attachment } from './useConversation';

type PendingImage = {
  file: File;
  preview: string;
};

type ChatComposerProps = {
  onSend: (message: string, attachments: Attachment[]) => void;
  disabled: boolean;
};

const MAX_FILES = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function ChatComposer({ onSend, disabled }: ChatComposerProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    setImages((prev) => {
      const accepted: PendingImage[] = [];
      for (const file of Array.from(files)) {
        if (prev.length + accepted.length >= MAX_FILES) break;
        if (!ACCEPTED_TYPES.includes(file.type)) continue;
        if (file.size > MAX_FILE_SIZE) continue;
        accepted.push({ file, preview: URL.createObjectURL(file) });
      }
      return accepted.length > 0 ? [...prev, ...accepted].slice(0, MAX_FILES) : prev;
    });
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if ((!trimmed && images.length === 0) || disabled || uploading) return;

    let uploaded: Attachment[] = [];

    if (images.length > 0) {
      setUploading(true);
      try {
        uploaded = await Promise.all(
          images.map(async (img) => {
            const formData = new FormData();
            formData.append('file', img.file);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!res.ok) throw new Error('Upload failed');
            const data = await res.json();
            return {
              id: data.id as string,
              filename: data.filename as string,
              mimeType: img.file.type,
              size: img.file.size,
            };
          }),
        );
      } catch {
        toast.error('Could not upload those images. Try again.');
        return;
      } finally {
        setUploading(false);
      }
    }

    for (const img of images) URL.revokeObjectURL(img.preview);

    onSend(trimmed || 'Please look at the attached image(s).', uploaded);
    setInput('');
    setImages([]);
  }, [input, images, disabled, uploading, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  return (
    <div className="border-t border-border bg-background p-4">
      <div className="mx-auto max-w-3xl">
        {images.length > 0 && (
          <div className="mb-3 flex gap-2">
            {images.map((img, i) => (
              <div key={img.preview} className="relative">
                {/* A blob: preview has no intrinsic size for next/image to work with. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.preview}
                  alt={img.file.name}
                  className="size-16 rounded-lg border border-border object-cover"
                />
                <Button
                  variant="secondary"
                  size="icon-xs"
                  className="absolute -top-1.5 -right-1.5 rounded-full"
                  onClick={() => removeImage(i)}
                >
                  <X />
                  <span className="sr-only">{`Remove ${img.file.name}`}</span>
                </Button>
              </div>
            ))}
          </div>
        )}
        <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
          {/*
            * The star border clips its children, so InputGroup's own focus
            * ring would be cut off — it is suppressed there and raised to the
            * wrapper, which sits outside the clip.
            */}
          <StarBorder className="focus-within:ring-3 focus-within:ring-ring/50">
            <InputGroup className="rounded-xl border-transparent bg-background focus-within:border-transparent has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupAddon align="inline-start">
              <Tooltip>
                <TooltipTrigger asChild>
                  <InputGroupButton
                    size="icon-sm"
                    disabled={disabled || uploading || images.length >= MAX_FILES}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip />
                    <span className="sr-only">Attach image</span>
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>Attach an image (up to {MAX_FILES})</TooltipContent>
              </Tooltip>
            </InputGroupAddon>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {/* `field-sizing-content` on Textarea grows it as you type — no resize effect.
                `min-h-0` overrides Textarea's own `min-h-16` floor so a single line sizes to
                exactly its line height + padding; otherwise the group centres the paperclip
                and Send addons against a box taller than the first line of text. */}
            <InputGroupTextarea
              aria-label="Message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask a question about the platform..."
              disabled={disabled || uploading}
              rows={1}
              className="min-h-0 max-h-48"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                variant="default"
                size="sm"
                className="rounded-lg px-4"
                disabled={disabled || uploading || (!input.trim() && images.length === 0)}
                onClick={handleSubmit}
              >
                {uploading ? 'Uploading...' : 'Send'}
              </InputGroupButton>
            </InputGroupAddon>
            </InputGroup>
          </StarBorder>
        </div>
      </div>
    </div>
  );
}
