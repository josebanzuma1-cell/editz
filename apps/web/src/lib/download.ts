/**
 * Hands the finished file to the user.
 *
 * A plain anchor with `download`, not a navigation: the blob lives in this
 * tab's memory and there is no URL to send anyone. That is the point — on the
 * client path the result never existed anywhere else, so there is nothing to
 * fetch, nothing to expire and nothing to delete.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some engines; a tick is
  // enough for the click to have been taken.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `holiday.mov` compressed to mp4 becomes `holiday-compressed.mp4`. */
export function outputFilename(sourceName: string, suffix: string, extension: string): string {
  const dot = sourceName.lastIndexOf('.');
  const stem = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${stem}-${suffix}.${extension}`;
}
