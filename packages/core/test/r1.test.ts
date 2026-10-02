import { describe, expect, it } from 'vitest';
import { detectR1, normalizeUtterance, R1Monitor, type R1Category } from '../src/r1.js';

function categories(text: string): R1Category[] {
  return detectR1(text).map((s) => s.category).sort();
}

describe('detectR1: clear present-tense claims (DET-01, DET-05)', () => {
  it.each<[string, R1Category]>([
    ['My chest hurts so much.', 'chest_pain'],
    ['I have a terrible pain in my chest', 'chest_pain'],
    ['There is a lot of pressure across my chest right now', 'chest_pain'],
    ['My chest feels tight', 'chest_pain'],
    ['I think I am having a heart attack', 'chest_pain'],
    ['My heart is racing and pounding', 'chest_pain'],
    ["I can't breathe", 'breathing'],
    ['I cannot breathe properly', 'breathing'],
    ['I can not breathe', 'breathing'],
    ["I'm not able to breathe", 'breathing'],
    ['It is hard to breathe today', 'breathing'],
    ["I'm really short of breath", 'breathing'],
    ['I fell and I can’t get up', 'unable_to_move'],
    ["I'm on the floor, I can't move", 'unable_to_move'],
    ['I have been stuck on the floor since this morning', 'unable_to_move'],
    ['My left side is numb, numbness down my arm', 'stroke_signs'],
    ['I feel weak on one side', 'stroke_signs'],
    ['My words are slurring', 'stroke_signs'],
    ["I can't lift my arm", 'stroke_signs'],
    ['I think I fainted earlier', 'loss_of_consciousness'],
    ["I feel like I'm about to faint", 'loss_of_consciousness'],
    ["I'm bleeding and it won't stop", 'severe_bleeding'],
    ['I was coughing up blood this morning', 'severe_bleeding'],
    ["I'm dying", 'fear_of_dying'],
    ['I feel like I am going to die', 'fear_of_dying'],
    ['Please call an ambulance', 'calling_for_help'],
    ['Please help me', 'calling_for_help'],
  ])('%s -> %s', (text, category) => {
    expect(categories(text)).toContain(category);
  });

  it('detects several categories in one utterance', () => {
    expect(categories("My chest hurts and I can't breathe")).toEqual(['breathing', 'chest_pain']);
  });

  it('returns the verbatim utterance as the quote (DET-06)', () => {
    const [s] = detectR1('  My CHEST hurts.  ');
    expect(s?.quote).toBe('My CHEST hurts.');
    expect(s?.matched).toBe('chest hurts');
  });
});

describe('detectR1: indirect and understated expressions are still caught (DET-02)', () => {
  it.each([
    "It's nothing serious, but my chest hurts a little",
    "Not a big deal, but my chest feels a bit funny",
    'Oh it is probably nothing, my chest is kind of tight',
    "I don't know why, my chest feels strange",
    "I don't think it is serious, but I can't catch my breath",
    "My chest isn't right today",
  ])('%s', (text) => {
    const signals = detectR1(text);
    expect(signals.length).toBeGreaterThan(0);
  });

  it('marks understated claims as hedged with lower confidence, never dropping them', () => {
    const [s] = detectR1('Not a big deal, but my chest hurts a bit');
    expect(s?.hedged).toBe(true);
    expect(s?.confidence).toBeLessThan(0.9);
    expect(s?.confidence).toBeGreaterThan(0.5);
  });

  it('gives clear claims high confidence', () => {
    const [s] = detectR1('My chest hurts');
    expect(s?.hedged).toBe(false);
    expect(s?.confidence).toBe(0.9);
  });
});

describe('detectR1: negations are not treated as current symptoms (DET-02)', () => {
  it.each([
    'No chest pain today',
    "I don't have any chest pain",
    "My chest doesn't hurt anymore",
    "I haven't had any trouble breathing",
    'Never been short of breath',
    'Nothing wrong with my chest',
    'There is no pressure in my chest',
    "I'm not dying, don't worry",
    'Without any pain in my chest',
  ])('%s', (text) => {
    expect(detectR1(text)).toEqual([]);
  });

  it('a negated clause does not hide a separate positive clause', () => {
    expect(categories("No fever, but I can't breathe")).toEqual(['breathing']);
    expect(categories("I haven't slept well and my chest hurts")).toEqual(['chest_pain']);
  });
});

describe('detectR1: past events are not treated as current symptoms (DET-02)', () => {
  it.each([
    'Years ago I had a heart attack',
    'I had chest pain a few months ago',
    'When I was young, I used to get short of breath',
    'Back then my chest hurt all the time',
    'Last year I fainted in the garden',
    'In 2019 I had a heart attack',
    'I used to have chest pain but now it is fine',
  ])('%s', (text) => {
    expect(detectR1(text)).toEqual([]);
  });

  it('ongoing symptoms that started in the past are current', () => {
    expect(categories('My chest has been hurting since two weeks ago')).toEqual(['chest_pain']);
    expect(categories('I had a heart attack years ago and my chest hurts again')).toEqual(['chest_pain']);
    expect(categories('Years ago, I had chest pain, and I still do today')).toEqual(['chest_pain']);
  });
});

describe("detectR1: other people's events are not the resident's (DET-02)", () => {
  it.each([
    'My friend was in hospital with chest pain',
    'My husband had a heart attack',
    "She said she can't breathe at night",
    'My neighbour fell and could not get up',
    "My sister's chest hurts",
    'He passed out at the station',
  ])('%s', (text) => {
    expect(detectR1(text)).toEqual([]);
  });

  it('first-person claims in a sentence about others are still caught', () => {
    expect(categories('My daughter says my chest pain is nothing, but it hurts')).toEqual(['chest_pain']);
  });
});

describe('detectR1: hypotheticals and idioms', () => {
  it.each([
    'If I ever had chest pain I would call the doctor',
    'In case I get short of breath I keep my inhaler nearby',
    "I'm dying to see my grandson",
    "I'm dying for a cup of tea",
  ])('%s', (text) => {
    expect(detectR1(text)).toEqual([]);
  });

  it('does not flag ordinary small talk', () => {
    for (const text of [
      'I made toast this morning and watched the birds',
      'Can you help me remember the name of that film?',
      'My grandson is coming on Sunday',
      '',
      '   ',
    ]) {
      expect(detectR1(text)).toEqual([]);
    }
  });
});

describe('normalizeUtterance', () => {
  it('normalizes case, curly apostrophes, and negated ability', () => {
    expect(normalizeUtterance('I CAN’T  breathe')).toBe("i can't breathe");
    expect(normalizeUtterance('I cant breathe')).toBe("i can't breathe");
    expect(normalizeUtterance('I am not able to stand')).toBe('i am unable to stand');
  });
});

describe('R1Monitor', () => {
  it('detects a claim split across streaming fragments of one turn', () => {
    const m = new R1Monitor();
    expect(m.push('Well, my chest', { startMs: 1000, endMs: 1500 })).toEqual([]);
    const signals = m.push('it feels really tight', { startMs: 1500, endMs: 2600 });
    expect(signals.map((s) => s.category)).toEqual(['chest_pain']);
    expect(signals[0]?.startMs).toBe(1000);
    expect(signals[0]?.endMs).toBe(2600);
    expect(m.hasEmergency).toBe(true);
  });

  it('emits each category only once per call', () => {
    const m = new R1Monitor();
    expect(m.push('My chest hurts')).toHaveLength(1);
    m.endTurn();
    expect(m.push('My chest still hurts')).toEqual([]);
    expect(m.push("and I can't breathe").map((s) => s.category)).toEqual(['breathing']);
  });

  it('does not join separate turns', () => {
    const m = new R1Monitor();
    m.push('My chest');
    m.endTurn();
    expect(m.push('is fine, thank you, it hurts to laugh though')).toEqual([]);
    expect(m.hasEmergency).toBe(false);
  });

  it('ignores empty fragments', () => {
    const m = new R1Monitor();
    expect(m.push('   ')).toEqual([]);
  });
});
