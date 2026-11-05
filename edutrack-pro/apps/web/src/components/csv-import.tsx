'use client';

import { useRef, useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, Note, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface ImportOutcome {
  total?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: Array<{ row: number; field?: string; message: string; value?: string }>;
  generatedCredentials?: Array<{ name: string; email: string; temporaryPassword: string }>;
  preview?: Array<Record<string, unknown>>;
}

/**
 * CSV import for registers.
 *
 * Two-stage on purpose: the first pass runs the API's `?dryRun=true` validation
 * so the school sees exactly which rows would fail and why, and only then does
 * the real import run. Nothing is written until the operator confirms.
 */
export function CsvImport({
  endpoint,
  templatePath,
  entityLabel,
  onImported,
}: {
  endpoint: string;
  templatePath: string;
  entityLabel: string;
  onImported?: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [mode, setMode] = useState<'idle' | 'validating' | 'importing'>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = async (withDryRun: boolean) => {
    if (!file) return;
    setMode(withDryRun ? 'validating' : 'importing');
    setError(null);
    if (withDryRun) setOutcome(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.upload<ImportOutcome>(`${endpoint}${withDryRun ? '?dryRun=true' : ''}`, form);
      setOutcome(result);
      if (withDryRun) {
        const problems = result?.errors?.length ?? 0;
        toast[problems ? 'warning' : 'success'](
          problems ? 'Validation found problems' : 'Validation passed',
          problems ? `${problems} row(s) need attention before importing.` : `${result?.total ?? 0} row(s) look good.`,
        );
      } else {
        toast.success('Import complete', `${result?.created ?? 0} created · ${result?.updated ?? 0} updated · ${result?.skipped ?? 0} skipped.`);
        setFile(null);
        if (inputRef.current) inputRef.current.value = '';
        onImported?.();
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The import could not be processed.');
    } finally {
      setMode('idle');
    }
  };

  const downloadTemplate = async () => {
    try {
      const csv = await api.exportText(templatePath);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = templatePath.split('/').pop()?.replace('template', 'template') ?? 'import-template.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Template unavailable', 'Could not download the CSV template right now.');
    }
  };

  const errors = outcome?.errors ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={downloadTemplate}>
          <Download className="h-4 w-4" aria-hidden /> Download template
        </Button>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <FileUp className="h-4 w-4" aria-hidden /> Choose CSV
        </Button>
        {file ? <span className="text-xs text-slate-600">{file.name}</span> : <span className="text-xs text-slate-500">No file selected</span>}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setOutcome(null);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!file || mode !== 'idle'} loading={mode === 'validating'} onClick={() => void send(true)}>
          Check the file (no changes)
        </Button>
        <Button
          size="sm"
          disabled={!file || mode !== 'idle' || !outcome || errors.length > 0}
          loading={mode === 'importing'}
          onClick={() => void send(false)}
          title={!outcome ? 'Validate the file first' : errors.length ? 'Fix the reported rows first' : undefined}
        >
          Import {entityLabel}
        </Button>
      </div>

      {error ? <Note tone="warning" title="Import failed">{error}</Note> : null}

      {outcome ? (
        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <p className="font-medium text-slate-800">
            {outcome.total ?? 0} row(s) read · {outcome.created ?? 0} created · {outcome.updated ?? 0} updated · {outcome.skipped ?? 0} skipped ·{' '}
            <span className={cn(errors.length ? 'text-rose-700' : 'text-success-strong')}>{errors.length} error(s)</span>
          </p>
          {errors.length ? (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs text-rose-700">
              {errors.slice(0, 50).map((item, index) => (
                <li key={index}>
                  Row {item.row}
                  {item.field ? ` · ${item.field}` : ''}: {item.message}
                  {item.value ? ` (got "${item.value}")` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {outcome.generatedCredentials?.length ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
              <p className="text-xs font-semibold text-amber-900">Temporary passwords — share once, then change at first sign-in</p>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
                {outcome.generatedCredentials.slice(0, 20).map((credential, index) => (
                  <li key={index}>
                    {credential.name} · {credential.email} · <code>{credential.temporaryPassword}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
