'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@editz/ui';

export function DropZone({
  accept,
  multiple,
  onFiles,
}: {
  accept: string[];
  multiple: boolean;
  onFiles: (files: File[]) => void;
}) {
  const t = useTranslations('tool');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(multiple ? Array.from(list) : [list[0]!]);
    },
    [multiple, onFiles],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handle(e.dataTransfer.files);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-14 text-center',
        'transition-colors duration-(--duration-state)',
        dragging ? 'border-signal bg-signal/5' : 'border-hairline-strong',
      )}
    >
      <p className="font-display text-xl font-semibold tracking-tight text-text-on-ink">
        {multiple ? t('dropPromptMulti') : t('dropPrompt')}
      </p>
      <p className="text-sm text-text-on-ink-muted">
        {multiple ? t('orChooseMulti') : t('orChoose')}
      </p>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        multiple={multiple}
        {...(accept.length > 0 ? { accept: accept.join(',') } : {})}
        onChange={(e) => handle(e.target.files)}
      />
      <Button type="button" variant="primary" size="lg" onClick={() => inputRef.current?.click()}>
        {multiple ? t('chooseFiles') : t('chooseFile')}
      </Button>
    </div>
  );
}
