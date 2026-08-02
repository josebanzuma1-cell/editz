import { z } from 'zod';
import type { AudioCodec, ContainerExt, Operation } from '@editz/engine-core';
import { defineTool } from '../../types';

const AUDIO_MIME = ['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/mp4'];
const VIDEO_MIME = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
];

const EXT_BY_CODEC: Record<Exclude<AudioCodec, 'copy'>, ContainerExt> = {
  mp3: 'mp3',
  aac: 'm4a',
  opus: 'opus',
  flac: 'flac',
};

/* -------------------------------------------------------------------------- */
/* Cut audio                                                                   */
/* -------------------------------------------------------------------------- */

const cutAudioParams = z
  .object({
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    fade: z.boolean(),
  })
  .refine((p) => p.endSec > p.startSec, {
    message: 'The end has to come after the start',
    path: ['endSec'],
  });

export const cutAudio = defineTool({
  slug: 'cut-audio',
  name: 'Cut audio',
  kind: 'audio',
  category: 'audio',
  icon: 'scissors',
  accepts: AUDIO_MIME,
  multiFile: false,
  execution: 'auto',
  params: cutAudioParams,
  defaults: { startSec: 0, endSec: 30, fade: true },
  ui: {
    controls: [
      { key: 'startSec', kind: 'time', label: 'Start', hintFromDuration: true },
      { key: 'endSec', kind: 'time', label: 'End', hintFromDuration: true },
      { key: 'fade', kind: 'toggle', label: 'Fade in and out', hint: 'Avoids a click at each end' },
    ],
  },
  buildOps: (_input, p): Operation[] => {
    const ops: Operation[] = [
      { stage: 'input', op: 'seek', startSec: p.startSec },
      { stage: 'input', op: 'duration', seconds: p.endSec - p.startSec },
    ];
    if (p.fade) {
      const length = p.endSec - p.startSec;
      ops.push({ stage: 'filter', op: 'fade', kind: 'in', startSec: 0, durationSec: 0.05 });
      ops.push({
        stage: 'filter',
        op: 'fade',
        kind: 'out',
        startSec: Math.max(0, length - 0.05),
        durationSec: 0.05,
      });
    }
    ops.push({ stage: 'encode', op: 'audio', codec: 'mp3', bitrateKbps: 192 });
    ops.push({ stage: 'container', op: 'format', ext: 'mp3' });
    return ops;
  },
  estimateOutput: (input, p) => {
    if (!input.durationSec) return null;
    return Math.round(input.bytes * Math.min(1, (p.endSec - p.startSec) / input.durationSec));
  },
  outputExtension: () => 'mp3',
  copyStatus: 'draft',
  seo: {
    title: 'Cut audio online — trim MP3 and WAV files | Editz',
    h1: 'Cut audio',
    description:
      'Trim an MP3, WAV or M4A to just the part you need, in your browser. Free, no upload.',
    intro:
      'Cutting audio keeps the section between a start and an end point and discards the rest. It is how you make a ringtone, pull a quote out of a recording, or drop the two minutes of silence at the start of a voice note. The fade option applies a very short ramp at each end, which removes the click you otherwise get when a waveform is chopped mid-cycle.',
    steps: [
      'Choose your audio file.',
      'Set the start and end points.',
      'Press Cut audio and download the trimmed file.',
    ],
    faq: [
      {
        q: 'Why does my cut click at the start?',
        a: 'Because the cut landed part-way through a wave. Turn fade on and the very short ramp at each end removes it.',
      },
      {
        q: 'What format do I get back?',
        a: 'MP3 at 192 kbps, which plays everywhere. Use the audio converter if you need something else.',
      },
    ],
    related: ['merge-audio', 'extract-audio', 'audio-converter', 'cut-video'],
    keywords: ['cut audio online', 'trim mp3 online free', 'make a ringtone'],
  },
});

/* -------------------------------------------------------------------------- */
/* Merge audio                                                                 */
/* -------------------------------------------------------------------------- */

const mergeAudioParams = z.object({
  crossfadeSec: z.number().min(0).max(10),
  normalize: z.boolean(),
});

export const mergeAudio = defineTool({
  slug: 'merge-audio',
  name: 'Merge audio',
  kind: 'audio',
  category: 'audio',
  icon: 'layers',
  accepts: AUDIO_MIME,
  multiFile: true,
  execution: 'auto',
  params: mergeAudioParams,
  defaults: { crossfadeSec: 0, normalize: true },
  ui: {
    controls: [
      { key: 'crossfadeSec', kind: 'number', label: 'Crossfade', unit: 'sec', min: 0, max: 10, step: 0.5 },
      {
        key: 'normalize',
        kind: 'toggle',
        label: 'Even out the volume',
        hint: 'Stops one track being much louder than the next',
      },
    ],
  },
  buildOps: (_input, p, inputs): Operation[] => {
    const ops: Operation[] = [
      { stage: 'stream', op: 'concat', count: inputs?.length ?? 2, reencode: true },
    ];
    if (p.normalize) ops.push({ stage: 'filter', op: 'volume', gainDb: 0 });
    ops.push({ stage: 'encode', op: 'audio', codec: 'mp3', bitrateKbps: 192 });
    ops.push({ stage: 'container', op: 'format', ext: 'mp3' });
    return ops;
  },
  outputExtension: () => 'mp3',
  copyStatus: 'draft',
  seo: {
    title: 'Merge audio files online — join MP3s into one | Editz',
    h1: 'Merge audio',
    description: 'Join several audio files end to end into one track. Runs in your browser.',
    intro:
      'Merging plays your files one after another and writes them out as a single track. The two things that usually go wrong are volume and joins: recordings made at different times are rarely at the same level, and an abrupt switch between them is jarring. Evening out the volume fixes the first, and a short crossfade smooths the second.',
    steps: [
      'Add your audio files and drag them into order.',
      'Set a crossfade if you want the joins softened.',
      'Press Merge audio and download the result.',
    ],
    faq: [
      {
        q: 'Do the files need to be the same format?',
        a: 'No. They are decoded and re-encoded to a common format, so you can mix MP3, WAV and M4A freely.',
      },
      {
        q: 'Can I overlap two tracks instead of joining them?',
        a: 'Not here — this joins end to end. Use add music to video if you want two sources playing at once.',
      },
    ],
    related: ['cut-audio', 'add-music-to-video', 'audio-converter', 'merge-video'],
    keywords: ['merge audio online', 'join mp3 files free', 'combine audio tracks'],
  },
});

/* -------------------------------------------------------------------------- */
/* Add music to video                                                          */
/* -------------------------------------------------------------------------- */

const addMusicParams = z.object({
  mode: z.enum(['replace', 'mix']),
  musicVolume: z.number().min(0).max(200),
  originalVolume: z.number().min(0).max(200),
  loopMusic: z.boolean(),
});

export const addMusicToVideo = defineTool({
  slug: 'add-music-to-video',
  name: 'Add music to video',
  kind: 'video',
  category: 'audio',
  icon: 'music',
  accepts: [...VIDEO_MIME, ...AUDIO_MIME],
  multiFile: true,
  execution: 'auto',
  params: addMusicParams,
  defaults: { mode: 'mix', musicVolume: 60, originalVolume: 100, loopMusic: true },
  ui: {
    controls: [
      {
        key: 'mode',
        kind: 'segmented',
        label: 'Original sound',
        options: [
          { value: 'mix', label: 'Keep and mix' },
          { value: 'replace', label: 'Replace it' },
        ],
      },
      { key: 'musicVolume', kind: 'number', label: 'Music', unit: '%', min: 0, max: 200, step: 5 },
      {
        key: 'originalVolume',
        kind: 'number',
        label: 'Original',
        unit: '%',
        min: 0,
        max: 200,
        step: 5,
        showIf: (p) => p.mode === 'mix',
      },
      {
        key: 'loopMusic',
        kind: 'toggle',
        label: 'Loop music if it is shorter than the video',
      },
    ],
  },
  buildOps: (_input, p): Operation[] => {
    const ops: Operation[] = [];
    if (p.mode === 'replace') {
      ops.push({ stage: 'stream', op: 'dropAudio' });
      ops.push({ stage: 'filter', op: 'volume', gainDb: gainFromPercent(p.musicVolume) });
    } else {
      ops.push({
        stage: 'stream',
        op: 'mixAudio',
        sources: 2,
        duckOriginalDb: gainFromPercent(p.originalVolume),
      });
      ops.push({ stage: 'filter', op: 'volume', gainDb: gainFromPercent(p.musicVolume) });
    }
    ops.push({ stage: 'encode', op: 'video', codec: 'copy' });
    ops.push({ stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 192 });
    ops.push({ stage: 'container', op: 'format', ext: 'mp4', faststart: true });
    return ops;
  },
  outputExtension: () => 'mp4',
  copyStatus: 'draft',
  seo: {
    title: 'Add music to a video online — free, no upload | Editz',
    h1: 'Add music to video',
    description:
      'Put a soundtrack over your video, keeping or replacing the original sound. Runs in your browser.',
    intro:
      'Adding music either replaces the original sound entirely or plays alongside it. Replacing is what you want over silent footage or when the original audio is unusable. Mixing keeps voices audible with music underneath, which only works if the music sits well below the speech — around 40 to 60 percent is usually right, and much higher will bury whatever anyone is saying. If your track is shorter than the video, looping fills the gap.',
    steps: [
      'Add your video, then add the music track.',
      'Choose whether to keep or replace the original sound, and set the levels.',
      'Press Add music to video and download the result.',
    ],
    faq: [
      {
        q: 'What if the music is shorter than the video?',
        a: 'Turn looping on and it repeats to fill the length. With looping off the video finishes in silence.',
      },
      {
        q: 'Why can I barely hear the speech?',
        a: 'The music is too loud relative to it. Drop the music to around 40 percent — it should sit under the voices, not next to them.',
      },
    ],
    related: ['mute-video', 'extract-audio', 'merge-audio', 'video-editor'],
    keywords: ['add music to video online', 'put song over video free', 'video background music'],
  },
});

function gainFromPercent(percent: number): number {
  if (percent <= 0) return -100;
  return Math.round(20 * Math.log10(percent / 100) * 10) / 10;
}

/* -------------------------------------------------------------------------- */
/* Extract audio                                                               */
/* -------------------------------------------------------------------------- */

const extractParams = z.object({
  format: z.enum(['mp3', 'aac', 'opus', 'flac']),
  bitrate: z.enum(['128', '192', '320']),
});

export const extractAudio = defineTool({
  slug: 'extract-audio',
  name: 'Extract audio from video',
  kind: 'video',
  category: 'audio',
  icon: 'audio-lines',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: extractParams,
  defaults: { format: 'mp3', bitrate: '192' },
  ui: {
    controls: [
      {
        key: 'format',
        kind: 'segmented',
        label: 'Format',
        options: [
          { value: 'mp3', label: 'MP3', hint: 'Plays everywhere' },
          { value: 'aac', label: 'M4A' },
          { value: 'opus', label: 'Opus', hint: 'Smallest' },
          { value: 'flac', label: 'FLAC', hint: 'Lossless, large' },
        ],
      },
      {
        key: 'bitrate',
        kind: 'segmented',
        label: 'Bitrate',
        showIf: (p) => p.format !== 'flac',
        options: [
          { value: '128', label: '128k' },
          { value: '192', label: '192k' },
          { value: '320', label: '320k' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    { stage: 'stream', op: 'dropVideo' },
    {
      stage: 'encode',
      op: 'audio',
      codec: p.format,
      ...(p.format === 'flac' ? {} : { bitrateKbps: Number(p.bitrate) }),
    },
    { stage: 'container', op: 'format', ext: EXT_BY_CODEC[p.format] },
  ],
  estimateOutput: (input, p) => {
    if (!input.durationSec) return null;
    const kbps = p.format === 'flac' ? 800 : Number(p.bitrate);
    return Math.round((kbps * 1000 * input.durationSec) / 8);
  },
  outputExtension: (p) => EXT_BY_CODEC[p.format],
  copyStatus: 'draft',
  seo: {
    title: 'Extract audio from video — MP4 to MP3 online | Editz',
    h1: 'Extract audio from video',
    description:
      'Pull the sound out of a video and save it as MP3, M4A, Opus or FLAC. Runs in your browser.',
    intro:
      'Extracting takes the audio track out of a video file and saves it on its own. The picture is discarded rather than converted, which is why this is much faster than a full conversion and why the result sounds exactly as good as the source did. For speech and most music 192 kbps MP3 is plenty; 320 is worth it for music you care about, and Opus gives you the same quality in a noticeably smaller file if whatever you are playing it on supports it.',
    steps: [
      'Choose your video.',
      'Pick a format and bitrate.',
      'Press Extract audio and download the file.',
    ],
    faq: [
      {
        q: 'Will this improve the sound quality?',
        a: 'No — nothing can. Extracting preserves what the video already contained. Choosing 320 kbps for a source recorded at 128 gives you a bigger file that sounds the same.',
      },
      {
        q: 'Which format should I pick?',
        a: 'MP3 unless you have a reason otherwise. Opus for the smallest file, FLAC if you need it lossless and do not mind the size.',
      },
    ],
    related: ['mute-video', 'audio-converter', 'cut-audio', 'video-converter'],
    keywords: ['extract audio from video', 'mp4 to mp3 online free', 'video to audio converter'],
  },
});

/* -------------------------------------------------------------------------- */
/* Audio recorder                                                              */
/* -------------------------------------------------------------------------- */

const recorderParams = z.object({
  format: z.enum(['webm', 'mp3']),
  echoCancellation: z.boolean(),
  noiseSuppression: z.boolean(),
});

export const audioRecorder = defineTool({
  slug: 'audio-recorder',
  name: 'Record audio',
  kind: 'audio',
  category: 'audio',
  icon: 'mic',
  accepts: [],
  multiFile: false,
  // MediaRecorder, not wasm. There is no server path and nothing to upload.
  execution: 'client',
  params: recorderParams,
  defaults: { format: 'mp3', echoCancellation: true, noiseSuppression: true },
  ui: {
    // Captures from the microphone rather than taking a file, so the page is
    // an app, not a drop zone.
    surface: 'app',
    controls: [
      {
        key: 'format',
        kind: 'segmented',
        label: 'Save as',
        options: [
          { value: 'mp3', label: 'MP3' },
          { value: 'webm', label: 'WebM', hint: 'No conversion step' },
        ],
      },
      { key: 'echoCancellation', kind: 'toggle', label: 'Echo cancellation' },
      { key: 'noiseSuppression', kind: 'toggle', label: 'Noise suppression' },
    ],
  },
  buildOps: (_input, p): Operation[] =>
    p.format === 'mp3'
      ? [
          { stage: 'encode', op: 'audio', codec: 'mp3', bitrateKbps: 192 },
          { stage: 'container', op: 'format', ext: 'mp3' },
        ]
      : [],
  outputExtension: (p) => (p.format === 'mp3' ? 'mp3' : 'webm'),
  copyStatus: 'draft',
  seo: {
    title: 'Online voice recorder — record audio in your browser | Editz',
    h1: 'Record audio',
    description:
      'Record from your microphone straight in the browser. Nothing is uploaded and no app is needed.',
    intro:
      'This records from your microphone using the browser itself — no app, no account, and no upload. The recording is held on your device and saved when you stop. Echo cancellation helps when you are recording near a speaker; noise suppression pulls down steady background sound like a fan or traffic. Both are handled by the browser before the audio is ever written, so they cost nothing in processing time.',
    steps: [
      'Allow microphone access when your browser asks.',
      'Press record, speak, and press stop.',
      'Download the recording.',
    ],
    faq: [
      {
        q: 'Is my recording uploaded?',
        a: 'No. It exists only in your browser until you download it. Nothing is sent anywhere at any point.',
      },
      {
        q: 'How long can I record?',
        a: 'As long as your device has memory for. Very long recordings are better done in sections.',
      },
    ],
    related: ['cut-audio', 'audio-converter', 'screen-recorder', 'camera-recorder'],
    keywords: ['online voice recorder', 'record audio in browser', 'free microphone recorder'],
  },
});
