'use client';

import { useState, useRef, useCallback } from 'react';

interface PendingImage {
  file: File;
  preview: string;
}

interface UploadedAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface ChatInputProps {
  onSend: (message: string, attachments: UploadedAttachment[]) => void;
  disabled: boolean;
}

const MAX_FILES = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const valid: PendingImage[] = [];

    for (const file of fileArray) {
      if (images.length + valid.length >= MAX_FILES) break;
      if (!ACCEPTED_TYPES.includes(file.type)) continue;
      if (file.size > MAX_FILE_SIZE) continue;
      valid.push({ file, preview: URL.createObjectURL(file) });
    }

    if (valid.length > 0) {
      setImages((prev) => [...prev, ...valid].slice(0, MAX_FILES));
    }
  }, [images.length]);

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

    let uploaded: UploadedAttachment[] = [];

    if (images.length > 0) {
      setUploading(true);
      try {
        const uploadPromises = images.map(async (img) => {
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
        });
        uploaded = await Promise.all(uploadPromises);
      } catch {
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    // Clean up preview URLs
    for (const img of images) {
      URL.revokeObjectURL(img.preview);
    }

    onSend(trimmed || 'Please look at the attached image(s).', uploaded);
    setInput('');
    setImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, images, disabled, uploading, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div className="border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="mx-auto max-w-3xl">
        {images.length > 0 && (
          <div className="mb-3 flex gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative">
                <img
                  src={img.preview}
                  alt={img.file.name}
                  className="h-16 w-16 rounded-lg border border-gray-200 object-cover dark:border-gray-600"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-xs text-white hover:bg-gray-900"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className="flex items-end gap-3"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading || images.length >= MAX_FILES}
            className="mb-1 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            title="Attach image"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
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
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the platform..."
            disabled={disabled || uploading}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
          />
          <button
            onClick={handleSubmit}
            disabled={disabled || uploading || (!input.trim() && images.length === 0)}
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
          >
            {uploading ? 'Uploading...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
