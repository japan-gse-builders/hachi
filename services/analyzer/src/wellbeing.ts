import { domainStates, isWellbeingTagId, wellbeingTag, type CallTag, type Turn, type WellbeingTagId } from '@hachi/core';
import type { CallWellbeing } from '@hachi/store';
import type { ModelReview, ModelTag } from './model.js';

/** Tags the resident said in so many words need less certainty than tags the model inferred. */
export const MIN_SAID_CONFIDENCE = 0.5;
export const MIN_INFERRED_CONFIDENCE = 0.75;
/** Mood read into small talk too easily turns the family's mood tile to "good". */
export const MIN_INFERRED_MOOD_CONFIDENCE = 0.9;
export const HEADLINE_MAX_CHARS = 200;

const QUOTE_MARKS = /["“”‘「」『』]/;
/** FAM-03: no diagnoses, medical labels or remarks on how the resident speaks in front of family. */
const NOT_FOR_FAMILY = [
  /\b(dementia|alzheimer\S*|depress\S*|diagnos\S*|disease|disorder|syndrome|cognitive|stroke|parkinson\S*|delirium|infection|confus\S*)\b/i,
  /\b(speech|slurr\S*|stammer\S*|stutter\S*|mumbl\S*|medication\S*|medicine\S*|pills?)\b/i,
  /\b(spoke|speaking|talked|talking)\s+(very\s+|more\s+|a\s+bit\s+|rather\s+)?(slow\S*|unclear\S*|halting\S*)/i,
];
/** Without a mood tag the family's mood tile says "not talked about", so the headline must not say otherwise. */
const MOOD_WORDS = [
  /\b(cheer\S*|happy|happily|upbeat|content|contented|jolly|chirpy|relaxed|calm|lonely|anxious|worried|sad|gloomy|glum|irritab\S*|grumpy|frustrated|stressed|nervous|spirits|mood)\b/i,
  /\b(feel\S*|felt|seem\S*|sound\S*)\s+(a\s+bit\s+|a\s+little\s+|quite\s+|rather\s+)?(down|low|flat)\b/i,
];

const minConfidence = (id: WellbeingTagId, basis: ModelTag['basis']) =>
  basis === 'said' ? MIN_SAID_CONFIDENCE : wellbeingTag(id).domain === 'mood' ? MIN_INFERRED_MOOD_CONFIDENCE : MIN_INFERRED_CONFIDENCE;
const stronger = (a: CallTag, b: CallTag) => (a.basis !== b.basis ? a.basis === 'said' : a.confidence > b.confidence);

/**
 * Keeps tags from the vocabulary that point at a resident turn with enough confidence; one per
 * id, preferring what was said over what was inferred.
 */
export function groundTags(tags: ModelTag[], transcript: Turn[]): CallTag[] {
  const kept = new Map<string, CallTag>();
  for (const t of tags) {
    if (!isWellbeingTagId(t.id) || transcript[t.turn]?.speaker !== 'resident' || t.confidence < minConfidence(t.id, t.basis)) continue;
    const tag: CallTag = { id: t.id, turn: t.turn, basis: t.basis, confidence: t.confidence };
    const prev = kept.get(t.id);
    if (!prev || stronger(tag, prev)) kept.set(t.id, tag);
  }
  return [...kept.values()];
}

/**
 * One plain sentence for family, or nothing if it quotes the resident, uses words family should
 * not see, or describes a mood that no kept tag backs.
 */
export function familyHeadline(text: string, tags: readonly CallTag[]): string | undefined {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s || s.length > HEADLINE_MAX_CHARS || QUOTE_MARKS.test(s) || NOT_FOR_FAMILY.some((re) => re.test(s))) return undefined;
  const moodTagged = tags.some((t) => wellbeingTag(t.id).domain === 'mood');
  if (!moodTagged && MOOD_WORDS.some((re) => re.test(s))) return undefined;
  return s;
}

export function wellbeingFrom(review: ModelReview, transcript: Turn[]): CallWellbeing {
  const tags = groundTags(review.tags, transcript);
  const headline = familyHeadline(review.headline, tags);
  return { tags, domains: domainStates(tags.map((t) => t.id)), ...(headline ? { headline } : {}) };
}
