'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { apiFetch, jsonBody } from '@/lib/api';
import {
  ArrowLeft,
  Bug,
  CircleCheck,
  Image as ImageIcon,
  Lightbulb,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MarkdownEditor } from '@/components/shared/MarkdownEditor';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const feedbackMutation = useMutation({
    mutationFn: (payload: { type: FeedbackType; title: string; description: string; imageId?: string }) =>
      apiFetch('/api/feedback', jsonBody('POST', payload)),
    onSuccess: () => setSubmitted(true),
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to submit feedback'),
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

              <MarkdownEditor
                className="mb-3"
                value={description}
                onChange={setDescription}
                placeholder="Describe your request"
                toolbarExtra={
                  <>
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
                  </>
                }
              />

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
