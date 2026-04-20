'use client';

import { useState, useRef, useEffect } from 'react';

type FeedbackType = 'FEATURE_REQUEST' | 'BUG';
type Step = 'type' | 'form';

interface UploadedImage {
  id: string;
  filename: string;
  url: string;
}

export default function FeedbackModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<FeedbackType | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
    }
  }, [open]);

  const reset = () => {
    setStep('type');
    setType(null);
    setTitle('');
    setDescription('');
    setImage(null);
    setUploading(false);
    setSubmitting(false);
    setSubmitted(false);
    setError(null);
  };

  const handleOpen = () => {
    reset();
    setOpen(true);
  };

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => setOpen(false), 150);
  };

  const handleSelectType = (t: FeedbackType) => {
    setType(t);
    setStep('form');
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Upload failed');
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

  const insertMarkdown = (prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = description.slice(start, end);
    const replacement = `${prefix}${selected}${suffix}`;
    const newDesc = description.slice(0, start) + replacement + description.slice(end);
    setDescription(newDesc);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = start + prefix.length;
      textarea.selectionEnd = start + prefix.length + selected.length;
    }, 0);
  };

  const handleSubmit = async () => {
    if (!type || !title.trim() || !description.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: title.trim(),
          description: description.trim(),
          imageId: image?.id || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to submit feedback');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
        Feedback
      </button>
    );
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center transition-colors duration-150 ${visible ? 'bg-black/50' : 'bg-black/0'}`}
        onClick={handleClose}
      >
        <div
          className={`w-full max-w-md rounded-lg bg-white p-6 shadow-xl transition-all duration-150 dark:bg-gray-900 ${visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div key={submitted ? 'submitted' : step} className="animate-fadeIn">
          {submitted ? (
            <div className="text-center">
              <div className="mb-3 text-3xl">{'\u2713'}</div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Thank you!</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Your feedback has been submitted.</p>
              <button
                onClick={handleClose}
                className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          ) : step === 'type' ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Give us feedback</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Tell us how we could make the product more useful for you.</p>
                </div>
                <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">&times;</button>
              </div>
              <div className="space-y-2">
                <button
                  onClick={() => handleSelectType('FEATURE_REQUEST')}
                  className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <span className="text-xl">{'\u{1F4A1}'}</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Feature Request</span>
                </button>
                <button
                  onClick={() => handleSelectType('BUG')}
                  className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <span className="text-xl">{'\u{1F41B}'}</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Bug</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {type === 'FEATURE_REQUEST' ? '\u{1F4A1} Feature Request' : '\u{1F41B} Bug'}
                </h2>
                <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">&times;</button>
              </div>

              <input
                type="text"
                placeholder="Have something to say?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="mb-3 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />

              <div className="mb-1">
                <textarea
                  ref={textareaRef}
                  placeholder="Describe your request"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={5000}
                  rows={4}
                  className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => insertMarkdown('**', '**')}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    title="Bold"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('*', '*')}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    title="Italic"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 4h4m-2 0v16m-4 0h8" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('\n- ', '')}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    title="List"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('[', '](url)')}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    title="Link"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 disabled:opacity-50"
                    title="Upload image"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handleUpload}
                    className="hidden"
                  />
                </div>
              </div>

              {image && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                  <span className="truncate text-gray-600 dark:text-gray-400">{image.filename}</span>
                  <button
                    onClick={() => setImage(null)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    &times;
                  </button>
                </div>
              )}

              {error && (
                <p className="mb-3 text-sm text-red-500">{error}</p>
              )}

              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setStep('type'); setType(null); }}
                  className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  &larr;
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!title.trim() || !description.trim() || submitting}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Create A New Post'}
                </button>
              </div>
            </>
          )}
          </div>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes feedbackFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: feedbackFadeIn 150ms ease-out;
        }
      `}} />
    </>
  );
}
