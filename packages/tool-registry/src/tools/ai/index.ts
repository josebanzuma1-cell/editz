/**
 * AI tools. All of these are `serverOnly` — Whisper and NLLB run on the worker,
 * not in the browser — and all of them are Pro. This is the tier that pays for
 * the free client-side tools, and African-language subtitling is the part
 * nobody else does well.
 *
 * Transcription is self-hosted faster-whisper. Audio is not sent to a
 * third-party API, and the pages say so, because for a lot of the people this
 * is built for that is the difference between using it and not.
 */
import { z } from 'zod';
import type { Operation } from '@editz/engine-core';
import { defineTool } from '../../types';

const VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'];
const AUDIO_MIME = ['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg', 'audio/mp4'];

/** The languages this is actually for. English and French are here because
 *  mixed-language recordings are the norm, not the exception. */
const LANGUAGES = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'sw', label: 'Swahili' },
  { value: 'lg', label: 'Luganda' },
  { value: 'am', label: 'Amharic' },
  { value: 'yo', label: 'Yoruba' },
  { value: 'ha', label: 'Hausa' },
  { value: 'so', label: 'Somali' },
  { value: 'rw', label: 'Kinyarwanda' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'ar', label: 'Arabic' },
];

const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.value !== 'auto');

const languageCode = z.enum([
  'auto',
  'sw',
  'lg',
  'am',
  'yo',
  'ha',
  'so',
  'rw',
  'en',
  'fr',
  'ar',
]);

const targetCode = z.enum(['sw', 'lg', 'am', 'yo', 'ha', 'so', 'rw', 'en', 'fr', 'ar']);

/* -------------------------------------------------------------------------- */
/* Auto subtitles                                                              */
/* -------------------------------------------------------------------------- */

const autoSubtitleParams = z.object({
  sourceLanguage: languageCode,
  output: z.enum(['burn', 'srt', 'vtt']),
  maxCharsPerLine: z.number().int().min(20).max(60),
  position: z.enum(['bottom', 'top']),
});

export const autoSubtitles = defineTool({
  slug: 'auto-subtitle-generator',
  name: 'Auto subtitle generator',
  kind: 'video',
  category: 'ai',
  icon: 'captions',
  accepts: [...VIDEO_MIME, ...AUDIO_MIME],
  multiFile: false,
  execution: 'server',
  serverOnly: true,
  params: autoSubtitleParams,
  defaults: { sourceLanguage: 'auto', output: 'burn', maxCharsPerLine: 42, position: 'bottom' },
  ui: {
    controls: [
      { key: 'sourceLanguage', kind: 'select', label: 'Spoken language', options: LANGUAGES },
      {
        key: 'output',
        kind: 'segmented',
        label: 'Give me',
        options: [
          { value: 'burn', label: 'Video with subtitles', hint: 'Always visible' },
          { value: 'srt', label: 'SRT file', hint: 'For YouTube and editors' },
          { value: 'vtt', label: 'VTT file', hint: 'For the web' },
        ],
      },
      {
        key: 'maxCharsPerLine',
        kind: 'number',
        label: 'Line length',
        unit: 'chars',
        min: 20,
        max: 60,
        showIf: (p) => p.output === 'burn',
      },
      {
        key: 'position',
        kind: 'segmented',
        label: 'Position',
        showIf: (p) => p.output === 'burn',
        options: [
          { value: 'bottom', label: 'Bottom' },
          { value: 'top', label: 'Top' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] =>
    p.output === 'burn'
      ? [
          { stage: 'filter', op: 'subtitles', path: 'subtitles.ass', burnIn: true },
          { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
          { stage: 'encode', op: 'audio', codec: 'copy' },
          { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
        ]
      : [],
  outputExtension: (p) => (p.output === 'burn' ? 'mp4' : p.output),
  copyStatus: 'draft',
  seo: {
    title: 'Auto subtitle generator — Swahili, Luganda and more | Editz',
    h1: 'Auto subtitle generator',
    description:
      'Generate subtitles automatically, including Swahili, Luganda, Amharic, Yoruba, Hausa and Somali. Burn them in or download SRT.',
    intro:
      'Transcription turns speech into timed lines of text. Most tools do this well for English and badly for everything else, which is why so much African-language video goes out with no captions at all. Editz runs a speech model that handles Swahili, Luganda, Amharic, Yoruba, Hausa, Somali and Kinyarwanda alongside English, French and Arabic, and it copes with the code-switching that happens naturally in a lot of recordings. You get an editable cue list before anything is finalised — automatic transcription is a first draft, not a finished one, and names and places are where it will need your help.',
    steps: [
      'Upload your video or audio and tell us what language is spoken, or let it detect.',
      'Review and fix the generated lines. Timings can be nudged.',
      'Burn the subtitles into the video, or download an SRT or VTT file.',
    ],
    faq: [
      {
        q: 'Which languages are supported?',
        a: 'Swahili, Luganda, Amharic, Yoruba, Hausa, Somali and Kinyarwanda, plus English, French and Arabic. Accuracy is highest for clear speech with little background noise, as it is for every system.',
      },
      {
        q: 'Is my audio sent to a third party?',
        a: 'No. Transcription runs on our own servers using a self-hosted model. Your audio is not passed to any external API, and the file is deleted within 24 hours.',
      },
      {
        q: 'Should I burn the subtitles in or download an SRT?',
        a: 'Burn them in for social media, where subtitles must be visible with the sound off and most platforms ignore a separate file. Download an SRT for YouTube, or if you are taking the video into an editor.',
      },
      {
        q: 'Why does this need an upload when other tools do not?',
        a: 'Speech recognition models are far too large to run in a browser tab. This one runs on our servers, and the meter tells you exactly how many megabytes that will cost you before you start.',
      },
    ],
    related: ['add-subtitles', 'video-translator', 'audio-translator', 'extract-audio'],
    keywords: [
      'auto subtitle generator',
      'swahili subtitles generator',
      'add luganda subtitles to video',
      'automatic captions african languages',
    ],
  },
});

/* -------------------------------------------------------------------------- */
/* Add subtitles (from a file)                                                 */
/* -------------------------------------------------------------------------- */

const addSubtitleParams = z.object({
  mode: z.enum(['burn', 'embed']),
  fontSize: z.number().int().min(12).max(72),
  position: z.enum(['bottom', 'top']),
  outline: z.boolean(),
});

export const addSubtitles = defineTool({
  slug: 'add-subtitles',
  name: 'Add subtitles to video',
  kind: 'video',
  category: 'ai',
  icon: 'subtitles',
  accepts: [...VIDEO_MIME, 'text/vtt', 'application/x-subrip'],
  multiFile: true,
  execution: 'auto',
  params: addSubtitleParams,
  defaults: { mode: 'burn', fontSize: 24, position: 'bottom', outline: true },
  ui: {
    controls: [
      {
        key: 'mode',
        kind: 'segmented',
        label: 'Subtitles',
        options: [
          { value: 'burn', label: 'Burned in', hint: 'Always visible, cannot be turned off' },
          { value: 'embed', label: 'Switchable', hint: 'A track the player can toggle' },
        ],
      },
      {
        key: 'fontSize',
        kind: 'number',
        label: 'Text size',
        unit: 'px',
        min: 12,
        max: 72,
        showIf: (p) => p.mode === 'burn',
      },
      {
        key: 'position',
        kind: 'segmented',
        label: 'Position',
        showIf: (p) => p.mode === 'burn',
        options: [
          { value: 'bottom', label: 'Bottom' },
          { value: 'top', label: 'Top' },
        ],
      },
      {
        key: 'outline',
        kind: 'toggle',
        label: 'Outline the text',
        hint: 'Keeps it readable over a bright background',
        showIf: (p) => p.mode === 'burn',
      },
    ],
  },
  buildOps: (_input, p): Operation[] =>
    p.mode === 'burn'
      ? [
          { stage: 'filter', op: 'subtitles', path: 'subtitles.srt', burnIn: true },
          { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
          { stage: 'encode', op: 'audio', codec: 'copy' },
          { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
        ]
      : [
          { stage: 'filter', op: 'subtitles', path: 'subtitles.srt', burnIn: false },
          { stage: 'encode', op: 'video', codec: 'copy' },
          { stage: 'encode', op: 'audio', codec: 'copy' },
          { stage: 'container', op: 'format', ext: 'mkv' },
        ],
  outputExtension: (p) => (p.mode === 'burn' ? 'mp4' : 'mkv'),
  copyStatus: 'draft',
  seo: {
    title: 'Add subtitles to a video — burn in SRT online | Editz',
    h1: 'Add subtitles to video',
    description:
      'Attach an SRT or VTT file to your video, burned in or as a switchable track. Runs in your browser.',
    intro:
      'If you already have a subtitle file, this puts it onto the video. Burned in means the text becomes part of the picture: it cannot be switched off, and it survives every platform, which is why social media subtitles are always burned in. Switchable keeps the subtitles as a separate track the viewer can turn on and off — better for a film, and useless on Instagram, which will simply ignore it.',
    steps: [
      'Add your video and your SRT or VTT file.',
      'Choose burned in or switchable, and set the look.',
      'Press Add subtitles to video and download it.',
    ],
    faq: [
      {
        q: 'Burned in or switchable?',
        a: 'Burned in for anything going on social media — most platforms ignore a separate track, and viewers scroll with the sound off. Switchable when the viewer should be able to choose.',
      },
      {
        q: 'My subtitles are out of sync. Can I fix that here?',
        a: 'Not yet — this tool applies the file as it is. The subtitle editor in the auto subtitle generator lets you nudge timings.',
      },
    ],
    related: ['auto-subtitle-generator', 'video-translator', 'cut-video', 'compress-video'],
    keywords: ['add subtitles to video online', 'burn srt into video free', 'hardcode subtitles'],
  },
});

/* -------------------------------------------------------------------------- */
/* Video translator                                                            */
/* -------------------------------------------------------------------------- */

const videoTranslatorParams = z.object({
  sourceLanguage: languageCode,
  targetLanguage: targetCode,
  output: z.enum(['burn', 'srt']),
});

export const videoTranslator = defineTool({
  slug: 'video-translator',
  name: 'Video translator',
  kind: 'video',
  category: 'ai',
  icon: 'languages',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'server',
  serverOnly: true,
  params: videoTranslatorParams,
  defaults: { sourceLanguage: 'auto', targetLanguage: 'sw', output: 'burn' },
  ui: {
    controls: [
      { key: 'sourceLanguage', kind: 'select', label: 'Spoken language', options: LANGUAGES },
      { key: 'targetLanguage', kind: 'select', label: 'Translate to', options: TARGET_LANGUAGES },
      {
        key: 'output',
        kind: 'segmented',
        label: 'Give me',
        options: [
          { value: 'burn', label: 'Video with subtitles' },
          { value: 'srt', label: 'SRT file' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] =>
    p.output === 'burn'
      ? [
          { stage: 'filter', op: 'subtitles', path: 'translated.ass', burnIn: true },
          { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
          { stage: 'encode', op: 'audio', codec: 'copy' },
          { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
        ]
      : [],
  outputExtension: (p) => (p.output === 'burn' ? 'mp4' : 'srt'),
  copyStatus: 'draft',
  seo: {
    title: 'Translate a video — subtitles in Swahili, Luganda and more | Editz',
    h1: 'Video translator',
    description:
      'Transcribe a video and translate the subtitles into Swahili, Luganda, Amharic, Yoruba and more.',
    intro:
      'Translating a video happens in two steps: the speech is transcribed into text, then that text is translated. Both are done on our own servers. The translation pass covers the pairs that matter here — English into Swahili, Swahili into English, Luganda, Amharic, Yoruba, Hausa, Somali, Kinyarwanda — rather than treating them as an afterthought behind the European languages. You can review the result before it is applied, which is worth doing: machine translation handles plain statements well and idiom badly.',
    steps: [
      'Upload your video and choose the language spoken in it.',
      'Choose the language you want it translated into.',
      'Review the translated lines, then burn them in or download an SRT.',
    ],
    faq: [
      {
        q: 'How good is the translation?',
        a: 'Good enough that a viewer follows what is happening; not good enough to publish unreviewed. Plain speech translates well, idiom and humour do not. Read it through before you export.',
      },
      {
        q: 'Can it dub the video into another language?',
        a: 'Not yet. This produces translated subtitles. Synthesised voice-over is on the roadmap.',
      },
    ],
    related: ['auto-subtitle-generator', 'audio-translator', 'add-subtitles', 'text-to-speech'],
    keywords: [
      'translate video subtitles',
      'english to swahili subtitles',
      'translate video to luganda',
    ],
  },
});

/* -------------------------------------------------------------------------- */
/* Audio translator                                                            */
/* -------------------------------------------------------------------------- */

const audioTranslatorParams = z.object({
  sourceLanguage: languageCode,
  targetLanguage: targetCode,
  output: z.enum(['text', 'srt']),
});

export const audioTranslator = defineTool({
  slug: 'audio-translator',
  name: 'Audio translator',
  kind: 'audio',
  category: 'ai',
  icon: 'languages',
  accepts: AUDIO_MIME,
  multiFile: false,
  execution: 'server',
  serverOnly: true,
  params: audioTranslatorParams,
  defaults: { sourceLanguage: 'auto', targetLanguage: 'en', output: 'text' },
  ui: {
    controls: [
      { key: 'sourceLanguage', kind: 'select', label: 'Spoken language', options: LANGUAGES },
      { key: 'targetLanguage', kind: 'select', label: 'Translate to', options: TARGET_LANGUAGES },
      {
        key: 'output',
        kind: 'segmented',
        label: 'Give me',
        options: [
          { value: 'text', label: 'Plain text' },
          { value: 'srt', label: 'Timed SRT' },
        ],
      },
    ],
  },
  buildOps: (): Operation[] => [],
  outputExtension: (p) => (p.output === 'text' ? 'txt' : 'srt'),
  copyStatus: 'draft',
  seo: {
    title: 'Audio translator — transcribe and translate a recording | Editz',
    h1: 'Audio translator',
    description:
      'Turn a recording into translated text, including Swahili, Luganda, Amharic and Yoruba.',
    intro:
      'This transcribes a recording and translates it, which is what you want for an interview, a voice note or a meeting rather than a video. Plain text is the right output for notes and quoting; timed SRT keeps every line attached to the moment it was said, which matters if the recording is going to be edited later. Everything runs on our own servers rather than being handed to a third-party API.',
    steps: [
      'Upload the recording and say what language is spoken.',
      'Choose the language to translate into.',
      'Download the text, or a timed SRT.',
    ],
    faq: [
      {
        q: 'How long can the recording be?',
        a: 'Up to 500 MB on the free tier and 4 GB on Pro. Long recordings queue and take a while — you can leave the page and come back.',
      },
      {
        q: 'Does it separate different speakers?',
        a: 'Not yet. Everything is transcribed as one continuous stream. Speaker labelling is on the roadmap.',
      },
    ],
    related: ['auto-subtitle-generator', 'video-translator', 'extract-audio', 'text-to-speech'],
    keywords: ['translate audio online', 'transcribe swahili audio', 'voice note translator'],
  },
});

/* -------------------------------------------------------------------------- */
/* Text to speech                                                              */
/* -------------------------------------------------------------------------- */

const ttsParams = z.object({
  // Not `.min(1)`: `defaults` is the initial state of the form, and an empty
  // box is the correct initial state. The page keeps the action disabled until
  // there is something to say.
  text: z.string().max(5000),
  language: targetCode,
  voice: z.enum(['female', 'male']),
  speed: z.number().min(0.5).max(2),
});

export const textToSpeech = defineTool({
  slug: 'text-to-speech',
  name: 'Text to speech',
  kind: 'audio',
  category: 'ai',
  icon: 'speech',
  accepts: [],
  multiFile: false,
  execution: 'server',
  serverOnly: true,
  params: ttsParams,
  defaults: { text: '', language: 'en', voice: 'female', speed: 1 },
  ui: {
    controls: [
      {
        key: 'text',
        kind: 'text',
        label: 'Text',
        placeholder: 'Type or paste what should be spoken',
        maxLength: 5000,
      },
      { key: 'language', kind: 'select', label: 'Language', options: TARGET_LANGUAGES },
      {
        key: 'voice',
        kind: 'segmented',
        label: 'Voice',
        options: [
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
        ],
      },
      { key: 'speed', kind: 'number', label: 'Speed', unit: '×', min: 0.5, max: 2, step: 0.1 },
    ],
  },
  buildOps: (): Operation[] => [
    { stage: 'encode', op: 'audio', codec: 'mp3', bitrateKbps: 192 },
    { stage: 'container', op: 'format', ext: 'mp3' },
  ],
  outputExtension: () => 'mp3',
  copyStatus: 'draft',
  seo: {
    title: 'Text to speech — natural voices including Swahili | Editz',
    h1: 'Text to speech',
    description:
      'Turn written text into spoken audio, with voices for Swahili, English and more. Download as MP3.',
    intro:
      'Text to speech reads what you type aloud and gives you an audio file. It is useful for narration over a video, for accessibility, and for anyone who would rather listen to a document than read it. Voice coverage is strongest in English and Swahili; other languages vary in how natural they sound, and the honest answer is that African-language speech synthesis is still well behind English. Short sentences and correct punctuation make a noticeable difference — the model uses punctuation to decide where to pause.',
    steps: [
      'Type or paste your text.',
      'Pick a language, a voice and a speaking speed.',
      'Press Text to speech and download the MP3.',
    ],
    faq: [
      {
        q: 'How much text can I convert at once?',
        a: 'Five thousand characters, which is roughly six minutes of speech. Split longer documents into sections.',
      },
      {
        q: 'Can I use the audio commercially?',
        a: 'Yes. What you generate is yours to use, including in monetised videos.',
      },
    ],
    related: ['audio-translator', 'add-music-to-video', 'audio-converter', 'video-translator'],
    keywords: ['text to speech free', 'swahili text to speech', 'tts mp3 download'],
  },
});
