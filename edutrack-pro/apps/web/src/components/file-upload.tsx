'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileUp, Paperclip, Trash2, UploadCloud } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, ProgressBar, useToast } from '@/components/ui';
import { cn, formatBytes } from '@/lib/utils';

export interface UploadedFile {
  id: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  key?: string;
}

interface Policy {
  maxBytes: number;
  allowedMimeTypes: string[];
  allowedExtensions?: string[];
  purposes?: string[];
}

/**
 * Drag-and-drop upload with progress.
 *
 * The browser only sends the bytes; the API re-checks the magic-number signature
 * and MIME type after upload (a renamed .exe is rejected server-side). Files are
 * stored privately and read back through an authorised, time-limited download
 * endpoint — never a public URL.
 */
export function FileUpload({
  purpose,
  accept,
  label = 'Attach a file',
  hint,
  multiple = false,
  disabled,
  onUploaded,
  compact,
}: {
  purpose: string;
  accept?: string;
  label?: string;
  hint?: string;
  multiple?: boolean;
  disabled?: boolean;
  onUploaded: (file: UploadedFile) => void;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    api
      .get<Policy>('/files/policy')
      .then(setPolicy)
      .catch(() => setPolicy(null));
  }, []);

  const acceptAttr = accept ?? policy?.allowedMimeTypes?.join(',') ?? 'application/pdf,image/jpeg,image/png';

  const uploadFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      setError(null);

      for (const file of list) {
        if (policy && file.size > policy.maxBytes) {
          const message = `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(policy.maxBytes)}.`;
          setError(message);
          toast.error('File too large', message);
          return;
        }
      }

      // One request per file keeps progress meaningful and lets a single bad file
      // fail without discarding the rest.
      const run = async () => {
        let index = 0;
        for (const file of list) {
          index += 1;
          const form = new FormData();
          form.append('file', file);
          // The purpose travels as a query parameter: the API validates it against
          // its allow-list and uses it as the storage folder.
          form.append('purpose', purpose); // kept for older servers that read a field
          setProgress(Math.round(((index - 1) / list.length) * 100));
          try {
            const uploaded = await api.upload<UploadedFile>(`/files/upload?purpose=${encodeURIComponent(purpose)}`, form);
            setProgress(Math.round((index / list.length) * 100));
            onUploaded(uploaded);
            toast.success('Uploaded', `${uploaded.fileName} is attached.`);
          } catch (caught) {
            const message = caught instanceof ApiError ? caught.message : 'The upload failed.';
            setError(message);
            toast.error('Upload rejected', message);
          }
        }
        setProgress(null);
        if (inputRef.current) inputRef.current.value = '';
        if (captureRef.current) captureRef.current.value = '';
      };
      void run();
    },
    [onUploaded, policy, purpose, toast],
  );

  return (
    <div className={cn('space-y-2', disabled && 'opacity-60')}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled && event.dataTransfer?.files?.length) uploadFiles(event.dataTransfer.files);
        }}
        className={cn(
          'rounded-xl border-2 border-dashed px-4 text-center transition',
          compact ? 'py-3' : 'py-6',
          dragging ? 'border-brand bg-brand-soft' : 'border-slate-300 bg-slate-50',
        )}
      >
        <UploadCloud className="mx-auto mb-1 h-5 w-5 text-slate-400" aria-hidden />
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {hint ?? 'PDF, JPEG or PNG · drag files here, or choose from this device'}
          {policy ? ` · max ${formatBytes(policy.maxBytes)}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>
            <FileUp className="h-4 w-4" aria-hidden /> Choose file{multiple ? 's' : ''}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => captureRef.current?.click()}>
            <Camera className="h-4 w-4" aria-hidden /> Take a photo
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={acceptAttr}
          multiple={multiple}
          onChange={(event) => event.target.files && uploadFiles(event.target.files)}
        />
        {/* capture="environment" opens the rear camera on phones — the usual way
            a guardian photographs a learner's exercise book. */}
        <input
          ref={captureRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => event.target.files && uploadFiles(event.target.files)}
        />
      </div>

      {progress !== null ? <ProgressBar value={progress} label={`Uploading… ${progress}%`} /> : null}
      {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}

/** Read-only chip for an attached file with an authorised open action. */
export function FileChip({ fileId, fileName, onRemove }: { fileId: string; fileName: string; onRemove?: () => void }) {
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      const url = await api.objectUrl(fileId);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Revoke shortly after: enough time for the new tab to load the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (caught) {
      window.alert(caught instanceof ApiError ? caught.message : 'That file could not be opened.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      <button type="button" className="truncate text-left font-medium text-royal hover:underline" onClick={open} disabled={busy}>
        {fileName}
      </button>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${fileName}`} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600">
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
