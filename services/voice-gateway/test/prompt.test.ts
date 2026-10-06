import { describe, expect, it } from 'vitest';
import { screenItem } from '@hachi/core';
import type { CallMemory, CallRecord } from '@hachi/store';
import { buildSystemInstruction, EMERGENCY_TOOL_GUIDANCE, emergencyCue, openingCue, priorContext, resumeCue, wrapUpCue } from '../src/prompt.js';

describe('buildSystemInstruction', () => {
  const prompt = buildSystemInstruction('Maggie');

  it('discloses that Hachi is an AI and that the call is recorded', () => {
    expect(prompt).toContain('Greet Maggie by name');
    expect(prompt).toMatch(/AI assistant/);
    expect(prompt).toMatch(/recorded/);
  });

  it('asks about feelings and meals today and yesterday', () => {
    expect(prompt).toMatch(/how they are feeling/);
    expect(prompt).toMatch(/eaten today/);
    expect(prompt).toMatch(/yesterday/);
  });

  it('contains the safety rules', () => {
    expect(prompt).toMatch(/not a doctor/);
    expect(prompt).toMatch(/Never diagnose/);
    expect(prompt).toMatch(/call report_emergency immediately/);
    expect(prompt).toMatch(/Never say "let's wait and see"/);
    expect(prompt).toMatch(/Do not pretend to remember/);
    expect(prompt).toMatch(/wrong_person/);
    expect(prompt).toMatch(/voicemail/);
    expect(prompt).toMatch(/more than two tool calls in a row/);
    expect(prompt).toMatch(/\[System\]/);
  });

  it('has no resume section for a fresh call', () => {
    expect(prompt).not.toMatch(/conversation so far/);
  });

  it('includes the earlier conversation when resuming', () => {
    const resumed = buildSystemInstruction('Maggie', [
      { speaker: 'agent', text: 'How are you feeling?', startMs: 0, endMs: 1000 },
      { speaker: 'resident', text: 'Pretty good.', startMs: 1500, endMs: 2500 },
    ]);
    expect(resumed).toContain('Hachi: How are you feeling?');
    expect(resumed).toContain('Maggie: Pretty good.');
    expect(resumed).toMatch(/Do not start the greeting again/);
  });

  it('says there are no set questions when the day brings none', () => {
    expect(prompt).toMatch(/There are none today/);
    expect(prompt).not.toMatch(/Answers to read out/);
  });

  it('gives a screening question in its published words with its options read out', () => {
    const withItems = buildSystemInstruction('Maggie', [], undefined, [screenItem('uls3.left_out')]);
    expect(withItems).toContain('"How often do you feel left out?"');
    expect(withItems).toContain('Answers to read out: Hardly ever or never / Some of the time / Often.');
    expect(withItems).toMatch(/ask each one in exactly these words/);
    expect(withItems).toMatch(/Do not reword a question/);
    expect(withItems).toMatch(/Never guess an answer on their behalf/);
  });

  it('speaks a recall window as part of the question it belongs to', () => {
    const withItems = buildSystemInstruction('Maggie', [], undefined, [screenItem('phq2.down')]);
    expect(withItems).toContain('Over the last two weeks, how often have you been bothered by "feeling down, depressed, or hopeless?"');
  });

  describe('when the resident wants more than a check-in', () => {
    it('offers to tell someone rather than staying on the line', () => {
      expect(prompt).toMatch(/lonely, that they miss someone, or that they would like to keep talking/);
      expect(prompt).toContain('"Would you like me to tell your family or a friend that you would like a phone call?"');
      expect(prompt).toMatch(/you have to go soon/);
    });

    it('reads a spoken number back one digit at a time, which is the only way to catch a wrong one', () => {
      expect(prompt).toMatch(/read every digit back to them one at a time/);
      expect(prompt).toMatch(/Do not shorten it, do not group the digits/);
    });

    it('takes no for an answer and promises nothing on the other person\u2019s behalf', () => {
      expect(prompt).toMatch(/do not ask again in this call/);
      expect(prompt).toMatch(/Never promise that the person will call/);
    });
  });

  it('holds a sensitive question back until the resident has settled', () => {
    const sensitive = buildSystemInstruction('Maggie', [], undefined, [screenItem('uls3.isolated')]);
    expect(sensitive).toMatch(/Ask this one late in the call, gently/);
    const plain = buildSystemInstruction('Maggie', [], undefined, [screenItem('kcl.out_weekly')]);
    expect(plain).not.toMatch(/late in the call/);
  });
});

describe('priorContext', () => {
  const analysed = (id: string, date: string, memory: CallMemory, intake: 'normal' | 'poor' = 'normal'): CallRecord =>
    ({
      id,
      residentId: 'res-1',
      source: 'live',
      status: 'completed',
      channel: 'pstn',
      startedAt: `${date}T01:00:00.000Z`,
      localDate: date,
      analysisPending: false,
      createdAt: `${date}T01:00:00.000Z`,
      analysis: { at: `${date}T01:10:00.000Z`, turns: 1, intake: { date, status: intake }, memory },
    });

  it('keeps the newest facts, drops duplicates and asks about a missed meal', () => {
    const calls = [
      analysed('new', '2026-10-02', { topics: ['Ken\nvisiting'], plans: ['picnic'], likes: ['tea'] }, 'poor'),
      analysed('old', '2026-10-01', { topics: ['picnic'], plans: ['a '.repeat(80)], likes: ['tea'] }),
      { ...analysed('skip', '2026-09-30', { topics: ['ignored'], plans: [], likes: [] }), analysis: undefined },
    ];
    const prior = priorContext(calls);
    expect(prior.mealFollowUp).toBe(true);
    expect(prior.facts[0]).toBe('(2026-10-02) plan: picnic');
    expect(prior.facts).toContain('(2026-10-02) talked about: Ken visiting');
    expect(prior.facts.filter((f) => f.includes('tea'))).toHaveLength(1);
    expect(prior.facts.some((f) => f.includes('ignored'))).toBe(false);
    expect(prior.facts.every((f) => f.length < 160)).toBe(true);

    const prompt = buildSystemInstruction('Maggie', [], prior);
    expect(prompt).toContain('Notes from earlier calls');
    expect(prompt).toContain('had not been eating well');
    expect(buildSystemInstruction('Maggie', [], { facts: [], mealFollowUp: false })).not.toContain('Notes from earlier calls');
  });

  it('caps the list at ten facts', () => {
    const memory = { topics: Array.from({ length: 12 }, (_, i) => `topic ${i}`), plans: [], likes: [] };
    expect(priorContext([analysed('c', '2026-10-02', memory)]).facts).toHaveLength(10);
  });
});

describe('cues', () => {
  it('are system messages addressed with the name', () => {
    for (const cue of [openingCue('Maggie'), resumeCue('Maggie'), wrapUpCue('Maggie'), emergencyCue('Maggie')]) {
      expect(cue.startsWith('[System]')).toBe(true);
      expect(cue).toContain('Maggie');
    }
    expect(wrapUpCue('Maggie')).toContain('end_call');
  });

  it('ask when it started, which is what decides a stroke treatment', () => {
    expect(emergencyCue('Maggie')).toMatch(/ask once, gently, when it started/);
    expect(EMERGENCY_TOOL_GUIDANCE).toMatch(/ask once, gently, when it started/);
  });

  it('tell the resident to call 119 during an emergency', () => {
    expect(emergencyCue('Maggie')).toMatch(/one one nine/);
    expect(EMERGENCY_TOOL_GUIDANCE).toMatch(/one one nine/);
    expect(EMERGENCY_TOOL_GUIDANCE).toMatch(/family and care staff/);
  });
});
