import { useId, useRef, useState } from 'react';
import { formatDay, shortValue } from '../speech';
import type { ComparedAnswer, SpeechComparison } from '../types';

interface Playing {
  key: string;
  stopAtSec: number;
}

/**
 * F02, staff only: what changed in the flagged call, and the usual and flagged answers to the same
 * set questions side by side. Each answer plays on its own, and stops at the end of the answer.
 */
export function SpeechCompareCard({ comparison, name = 'them' }: { comparison: SpeechComparison; name?: string }) {
  const headingId = useId();
  const audio = useRef<HTMLAudioElement>(null);
  const seekTo = useRef(0);
  const [playing, setPlaying] = useState<Playing | null>(null);

  const stop = () => {
    audio.current?.pause();
    setPlaying(null);
  };

  const play = (key: string, url: string, startMs: number, endMs: number) => {
    const el = audio.current;
    if (!el) return;
    if (playing?.key === key) return stop();
    // Setting the position before the file has loaded is not reliable everywhere, so it is set again once it has.
    seekTo.current = Math.max(0, startMs / 1000);
    if (el.src !== url) el.src = url;
    el.currentTime = seekTo.current;
    setPlaying({ key, stopAtSec: endMs / 1000 });
    void el.play().catch(() => setPlaying(null));
  };

  const onTimeUpdate = () => {
    const el = audio.current;
    if (el && playing && el.currentTime >= playing.stopAtSec) stop();
  };

  const hasPairs = comparison.questions.length > 0;
  return (
    <section className="stack case-speech-compare" aria-labelledby={headingId}>
      <h3 id={headingId}>Usual calls and this call</h3>
      <p className="meta">
        Usual calls with a recording: {comparison.usualRecordings} of {comparison.usualCalls}.{' '}
        {comparison.recentRecording ? 'This call has a recording.' : 'This call has no recording.'}
      </p>
      <ul className="speech-compare-changes" aria-label="What changed in this call">
        {comparison.changes.map((c) => (
          <li key={c.feature}>
            <strong>{c.label}</strong>{' '}
            <span className="meta">
              usual {shortValue(c.feature, c.baselineMean)}, this call {shortValue(c.feature, c.recentMean)}
            </span>
          </li>
        ))}
      </ul>

      {comparison.message && <p role="status">{comparison.message}</p>}

      {comparison.questions.map((q) => (
        <figure key={q.itemId} className="speech-compare-pair stack stack-s">
          <figcaption>
            <strong>“{q.question}”</strong>
          </figcaption>
          <div className="speech-compare-sides">
            <AnswerSide label="Usual" answer={q.usual} name={name} playing={playing} onPlay={play} keyPrefix={`${q.itemId}-usual`} />
            <AnswerSide label="This call" answer={q.recent} name={name} playing={playing} onPlay={play} keyPrefix={`${q.itemId}-recent`} />
          </div>
        </figure>
      ))}

      {hasPairs && <p className="meta">Each answer plays from just before the resident starts to answer, and stops when the answer ends.</p>}
      <audio ref={audio} preload="none" aria-label="Answer recording" onTimeUpdate={onTimeUpdate} onEnded={() => setPlaying(null)} onLoadedMetadata={() => {
        if (audio.current) audio.current.currentTime = seekTo.current;
      }}>
        <track kind="captions" />
      </audio>
    </section>
  );
}

function AnswerSide({
  label,
  answer,
  name,
  playing,
  onPlay,
  keyPrefix,
}: {
  label: string;
  answer: ComparedAnswer;
  name: string;
  playing: Playing | null;
  onPlay: (key: string, url: string, startMs: number, endMs: number) => void;
  keyPrefix: string;
}) {
  const key = `${keyPrefix}-${answer.callId}`;
  const isPlaying = playing?.key === key;
  return (
    <div className="speech-compare-side stack stack-s">
      <p className="meta">
        {label} · {formatDay(answer.at)}
      </p>
      <p>
        <strong>{answer.answer}</strong>
      </p>
      <blockquote className="quote">
        <p className="line-clamp">“{answer.quote}”</p>
      </blockquote>
      {answer.audioUrl ? (
        <button
          type="button"
          aria-label={`${isPlaying ? 'Stop' : 'Play'} ${label.toLowerCase()} answer from ${formatDay(answer.at)}`}
          onClick={() => onPlay(key, answer.audioUrl!, answer.startMs, answer.endMs)}
        >
          {isPlaying ? 'Stop' : 'Play'}
        </button>
      ) : (
        <p className="meta">No recording of this call, so there is nothing to play for {name}.</p>
      )}
    </div>
  );
}
