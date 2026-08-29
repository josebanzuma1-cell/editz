/**
 * Recorders. All three use MediaRecorder and getDisplayMedia/getUserMedia, not
 * wasm — so they are `execution: 'client'` with no server fallback, and their
 * landing pages open an app rather than a parameter panel.
 */
import { z } from 'zod';
import type { Operation } from '@editz/engine-core';
import { defineTool } from '../../types';

const commonBase = {
  kind: 'video',
  category: 'record',
  accepts: [] as string[],
  multiFile: false,
  execution: 'client',
} as const;

/* -------------------------------------------------------------------------- */
/* Screen recorder                                                             */
/* -------------------------------------------------------------------------- */

const screenParams = z.object({
  source: z.enum(['screen', 'window', 'tab']),
  microphone: z.boolean(),
  systemAudio: z.boolean(),
  format: z.enum(['webm', 'mp4']),
});

export const screenRecorder = defineTool({
  ...commonBase,
  slug: 'screen-recorder',
  name: 'Screen recorder',
  icon: 'monitor',
  params: screenParams,
  defaults: { source: 'screen', microphone: true, systemAudio: false, format: 'mp4' },
  ui: {
    surface: 'app',
    controls: [
      {
        key: 'source',
        kind: 'segmented',
        label: 'Record',
        options: [
          { value: 'screen', label: 'Whole screen' },
          { value: 'window', label: 'One window' },
          { value: 'tab', label: 'One tab' },
        ],
      },
      { key: 'microphone', kind: 'toggle', label: 'Record my microphone' },
      {
        key: 'systemAudio',
        kind: 'toggle',
        label: 'Record system sound',
        hint: 'Chrome and Edge only, and only when sharing a tab',
      },
      {
        key: 'format',
        kind: 'segmented',
        label: 'Save as',
        options: [
          { value: 'mp4', label: 'MP4', hint: 'Converted after recording' },
          { value: 'webm', label: 'WebM', hint: 'Saves instantly' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] =>
    p.format === 'mp4'
      ? [
          { stage: 'encode', op: 'video', codec: 'h264', crf: 23, preset: 'veryfast' },
          { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 },
          { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
        ]
      : [],
  outputExtension: (p) => p.format,
  copyStatus: 'draft',
  seo: {
    title: 'Screen recorder — record your screen online, free | Editz',
    h1: 'Screen recorder',
    description:
      'Record your screen with sound, in the browser. No install, no watermark, nothing uploaded.',
    intro:
      'Records what is on your screen using the browser itself, so there is nothing to install and no account. You can capture the whole screen, one window, or a single browser tab — the tab option is the one to pick for a demo, because it excludes your notifications and everything else you have open. Recording stays on your device the entire time and is saved when you stop. WebM saves the instant you stop; MP4 needs a short conversion afterwards but plays anywhere.',
    steps: [
      'Choose what to record and whether to include your microphone.',
      'Press record, and pick the screen or window your browser asks for.',
      'Press stop and download the recording.',
    ],
    faq: [
      {
        q: 'Is my recording uploaded?',
        a: 'No. It exists in your browser until you download it. Nothing is sent anywhere, which is worth knowing before you record something confidential.',
      },
      {
        q: 'Can I record the sound coming from my computer?',
        a: 'Only in Chrome and Edge, and only when you share a tab rather than the whole screen. That restriction comes from the browsers, not from us.',
      },
      {
        q: 'Is there a time limit or a watermark?',
        a: 'No watermark and no fixed limit. In practice you are limited by your device memory, so break very long recordings into sections.',
      },
    ],
    related: ['camera-recorder', 'presentation-recorder', 'cut-video', 'compress-video'],
    keywords: ['screen recorder online free', 'record screen in browser', 'screen recorder no watermark'],
  },
});

/* -------------------------------------------------------------------------- */
/* Camera recorder                                                             */
/* -------------------------------------------------------------------------- */

const cameraParams = z.object({
  camera: z.enum(['front', 'back']),
  resolution: z.enum(['1080p', '720p', '480p']),
  mirror: z.boolean(),
  format: z.enum(['webm', 'mp4']),
});

export const cameraRecorder = defineTool({
  ...commonBase,
  slug: 'camera-recorder',
  name: 'Camera recorder',
  icon: 'video',
  params: cameraParams,
  defaults: { camera: 'front', resolution: '720p', mirror: true, format: 'mp4' },
  ui: {
    surface: 'app',
    controls: [
      {
        key: 'camera',
        kind: 'segmented',
        label: 'Camera',
        options: [
          { value: 'front', label: 'Front' },
          { value: 'back', label: 'Back' },
        ],
      },
      {
        key: 'resolution',
        kind: 'segmented',
        label: 'Quality',
        options: [
          { value: '480p', label: '480p' },
          { value: '720p', label: '720p' },
          { value: '1080p', label: '1080p' },
        ],
      },
      {
        key: 'mirror',
        kind: 'toggle',
        label: 'Mirror the preview',
        hint: 'Only the preview — the recording is not mirrored',
      },
      {
        key: 'format',
        kind: 'segmented',
        label: 'Save as',
        options: [
          { value: 'mp4', label: 'MP4' },
          { value: 'webm', label: 'WebM' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] =>
    p.format === 'mp4'
      ? [
          { stage: 'encode', op: 'video', codec: 'h264', crf: 23, preset: 'veryfast' },
          { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 },
          { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
        ]
      : [],
  outputExtension: (p) => p.format,
  copyStatus: 'draft',
  seo: {
    title: 'Webcam recorder — record video online free | Editz',
    h1: 'Camera recorder',
    description:
      'Record from your webcam or phone camera in the browser. No install, no watermark, nothing uploaded.',
    intro:
      'Records from your camera straight in the browser. Nothing is installed and nothing is uploaded — the video is held on your device and saved when you stop. The preview is mirrored by default because an unmirrored view of yourself is disconcerting to talk to, but the recording itself is never mirrored, which is why writing behind you reads correctly in the file even though it looked backwards while you were recording.',
    steps: [
      'Allow camera access when your browser asks.',
      'Choose a camera and quality, then press record.',
      'Press stop and download the video.',
    ],
    faq: [
      {
        q: 'Why does the preview look mirrored but the recording does not?',
        a: 'The preview is flipped so it feels like a mirror while you talk. The recording keeps the true image. If you want the file mirrored too, run it through flip video.',
      },
      {
        q: 'Does this work on a phone?',
        a: 'Yes, in a recent mobile browser, and you can switch between the front and back cameras.',
      },
    ],
    related: ['screen-recorder', 'audio-recorder', 'flip-video', 'compress-video'],
    keywords: ['webcam recorder online', 'record video in browser free', 'online camera recorder'],
  },
});

/* -------------------------------------------------------------------------- */
/* Presentation recorder                                                       */
/* -------------------------------------------------------------------------- */

const presentationParams = z.object({
  layout: z.enum(['corner', 'side', 'screen-only']),
  cameraSize: z.enum(['small', 'medium', 'large']),
  microphone: z.boolean(),
});

export const presentationRecorder = defineTool({
  ...commonBase,
  slug: 'presentation-recorder',
  name: 'Presentation recorder',
  icon: 'presentation',
  params: presentationParams,
  defaults: { layout: 'corner', cameraSize: 'small', microphone: true },
  ui: {
    surface: 'app',
    controls: [
      {
        key: 'layout',
        kind: 'segmented',
        label: 'Layout',
        options: [
          { value: 'corner', label: 'Camera in the corner' },
          { value: 'side', label: 'Side by side' },
          { value: 'screen-only', label: 'Screen only' },
        ],
      },
      {
        key: 'cameraSize',
        kind: 'segmented',
        label: 'Camera size',
        showIf: (p) => p.layout === 'corner',
        options: [
          { value: 'small', label: 'Small' },
          { value: 'medium', label: 'Medium' },
          { value: 'large', label: 'Large' },
        ],
      },
      { key: 'microphone', kind: 'toggle', label: 'Record my microphone' },
    ],
  },
  buildOps: (): Operation[] => [
    { stage: 'encode', op: 'video', codec: 'h264', crf: 23, preset: 'veryfast' },
    { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ],
  outputExtension: () => 'mp4',
  copyStatus: 'draft',
  seo: {
    title: 'Presentation recorder — slides and camera together | Editz',
    h1: 'Presentation recorder',
    description:
      'Record your slides and yourself at the same time, in the browser. No install, nothing uploaded.',
    intro:
      'Records your screen and your camera at once and combines them into one video. Camera in the corner is the format people expect from a recorded lecture or a product walkthrough — your slides fill the frame and you sit in the corner. Side by side gives you more presence and suits a talk where you matter as much as the material. Both are composited on your device as you record, so you get one finished file rather than two you have to line up afterwards.',
    steps: [
      'Choose a layout and allow screen and camera access.',
      'Press record and present.',
      'Press stop and download the finished video.',
    ],
    faq: [
      {
        q: 'Do I get one file or two?',
        a: 'One. The camera and screen are combined live while you record, so there is nothing to line up afterwards.',
      },
      {
        q: 'Can I move the camera bubble?',
        a: 'Not while recording — pick the corner and size before you start.',
      },
    ],
    related: ['screen-recorder', 'camera-recorder', 'cut-video', 'compress-video'],
    keywords: ['presentation recorder online', 'record slides with webcam', 'screen and camera recorder'],
  },
});
