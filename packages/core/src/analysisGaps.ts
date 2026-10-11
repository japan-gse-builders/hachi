import type { Locale } from './types.js';

/**
 * The two halves of a call's analysis that can fail on their own. `review` is the model reading
 * the transcript; `voice` is the recording being measured (response time, self-repairs).
 */
export type AnalysisPart = 'review' | 'voice';

/**
 * Why a part could not be done, as a category staff can act on. The raw error stays in the call
 * record and the logs: it names providers, status codes and schema paths, none of which tell a
 * care worker anything, and some of which may one day carry text from the call.
 */
export type AnalysisFailure =
  | 'model_unavailable'
  | 'model_rejected'
  | 'model_invalid_output'
  | 'recording_missing'
  | 'recording_unreadable'
  | 'unknown';

export interface AnalysisGap {
  part: AnalysisPart;
  failure: AnalysisFailure;
}

export const ANALYSIS_FAILURE_LABELS: Record<Locale, Record<AnalysisFailure, string>> = {
  ja: {
    model_unavailable: 'AI モデルの一時的な障害',
    model_rejected: 'AI モデルが依頼を受け付けなかった',
    model_invalid_output: 'AI モデルの出力が不正',
    recording_missing: '録音を取得できない',
    recording_unreadable: '録音が読めない',
    unknown: '原因不明のエラー',
  },
  en: {
    model_unavailable: 'AI model temporarily unavailable',
    model_rejected: 'AI model refused the request',
    model_invalid_output: 'AI model returned unusable output',
    recording_missing: 'Recording could not be fetched',
    recording_unreadable: 'Recording could not be read',
    unknown: 'Unexpected error',
  },
};

export interface AnalysisGapText {
  /** What nobody has looked at in this call, in plain words. */
  notChecked: string;
  /** What did run, so the gap is not read as "nothing was checked at all". */
  checked: string;
}

/**
 * The sentences staff read next to a call whose analysis is incomplete. Written per combination
 * rather than assembled from parts, because each one has to say exactly which rules still ran: the
 * point of showing a gap is that it must never be mistaken for a call in which nothing was wrong.
 */
export function describeAnalysisGaps(gaps: readonly AnalysisGap[], locale: Locale): AnalysisGapText | null {
  const review = gaps.some((g) => g.part === 'review');
  const voice = gaps.some((g) => g.part === 'voice');
  if (!review && !voice) return null;
  if (locale === 'ja') {
    if (review && voice) {
      return {
        notChecked: '食事と水分（R2）、話し方の変化（R3）、通話の要約、決まった質問への回答、誰かに電話してほしいという依頼は判定できていない。',
        checked: '急な異変（R1）はキーワードのルールでのみ確認済み。',
      };
    }
    if (review) {
      return {
        notChecked: '食事と水分（R2）、話題のつながり（R3）、通話の要約、決まった質問への回答、誰かに電話してほしいという依頼は判定できていない。',
        checked: '急な異変（R1）はキーワードのルールでのみ確認済み。',
      };
    }
    return {
      notChecked: '録音からの応答の速さと言い直しの計測（R3）はできていない。',
      checked: '急な異変（R1）、食事と水分（R2）、通話の要約は通常どおり確認済み。',
    };
  }
  if (review && voice) {
    return {
      notChecked: 'Meals and drinks (R2), changes in speech (R3), the call summary, the set questions and any request to ring someone have not been checked.',
      checked: 'Sudden emergencies (R1) were checked by keyword rules only.',
    };
  }
  if (review) {
    return {
      notChecked: 'Meals and drinks (R2), how the conversation held together (R3), the call summary, the set questions and any request to ring someone have not been checked.',
      checked: 'Sudden emergencies (R1) were checked by keyword rules only.',
    };
  }
  return {
    notChecked: 'Response time and self-repairs from the recording (R3) have not been measured.',
    checked: 'Sudden emergencies (R1), meals and drinks (R2) and the call summary were checked as usual.',
  };
}
