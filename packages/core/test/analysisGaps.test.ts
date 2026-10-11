import { describe, expect, it } from 'vitest';
import { ANALYSIS_FAILURE_LABELS, describeAnalysisGaps, type AnalysisFailure } from '../src/analysisGaps.js';

describe('describeAnalysisGaps', () => {
  it('says nothing for a call with no gaps', () => {
    expect(describeAnalysisGaps([], 'en')).toBeNull();
  });

  it('names meals (R2) as unchecked when the review failed, and R1 as checked by rules only', () => {
    const t = describeAnalysisGaps([{ part: 'review', failure: 'model_unavailable' }], 'en')!;
    expect(t.notChecked).toContain('Meals and drinks (R2)');
    expect(t.notChecked).toContain('request to ring someone');
    expect(t.checked).toContain('(R1)');
    expect(t.checked).toContain('keyword rules only');
  });

  it('keeps R2 as checked when only the recording failed', () => {
    const t = describeAnalysisGaps([{ part: 'voice', failure: 'recording_unreadable' }], 'en')!;
    expect(t.notChecked).toContain('(R3)');
    expect(t.notChecked).not.toContain('(R2)');
    expect(t.checked).toContain('meals and drinks (R2)');
  });

  it('covers both parts at once, in both languages', () => {
    const gaps = [
      { part: 'review', failure: 'model_rejected' },
      { part: 'voice', failure: 'recording_missing' },
    ] as const;
    expect(describeAnalysisGaps(gaps, 'en')!.notChecked).toContain('changes in speech (R3)');
    expect(describeAnalysisGaps(gaps, 'ja')!.notChecked).toContain('食事と水分（R2）');
  });

  it('has a label for every failure in every locale', () => {
    const failures: AnalysisFailure[] = ['model_unavailable', 'model_rejected', 'model_invalid_output', 'recording_missing', 'recording_unreadable', 'unknown'];
    for (const locale of ['en', 'ja'] as const) {
      for (const f of failures) expect(ANALYSIS_FAILURE_LABELS[locale][f]).toBeTruthy();
    }
  });
});
