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

  it('does not depend on whether the past time is in the same clause as the symptom', () => {
    expect(categories('I had chest pain years ago and I still do today')).toEqual(['chest_pain']);
    expect(categories("I had chest pains last year and they've come back this morning")).toEqual(['chest_pain']);
    expect(categories('I had chest pain years ago and it never came back')).toEqual([]);
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

describe('detectR1: further wordings of current danger', () => {
  it.each<[string, R1Category]>([
    ["I can't seem to catch my breath", 'breathing'],
    ['I can hardly breathe', 'breathing'],
    ['I can barely get enough air', 'breathing'],
    ['It hurts to breathe', 'breathing'],
    ["I'm struggling for breath", 'breathing'],
    ['I keep having to stop for breath', 'breathing'],
    ["I'm gasping for air", 'breathing'],
    ["I'm choking", 'breathing'],
    ['A fishbone is stuck in my throat', 'breathing'],
    ["I had a fall and I can't get myself up", 'unable_to_move'],
    ["I can't get back up", 'unable_to_move'],
    ["I can't get up off the floor", 'unable_to_move'],
    ["I can't get up from the floor", 'unable_to_move'],
    ["I'm still on the kitchen floor", 'unable_to_move'],
    ["I've been on the floor since last night", 'unable_to_move'],
    ["I'm stuck in the bath", 'unable_to_move'],
    ["My legs won't hold me", 'unable_to_move'],
    ['My back hurts too much to move', 'unable_to_move'],
    ['My words keep coming out jumbled', 'stroke_signs'],
    ['My mouth is drooping on one side', 'stroke_signs'],
    ["I can't raise my right arm", 'stroke_signs'],
    ['My left hand has gone all weak', 'stroke_signs'],
    ['My arm is floppy', 'stroke_signs'],
    ["I've been feeling ever so faint", 'loss_of_consciousness'],
    ['I feel faint', 'loss_of_consciousness'],
    ['Could you get someone to come round, please?', 'calling_for_help'],
    ['Can you send someone?', 'calling_for_help'],
    ['Send help now', 'calling_for_help'],
    ['I think I need a doctor, dear', 'calling_for_help'],
  ])('%s -> %s', (text, category) => {
    expect(categories(text)).toContain(category);
  });

  it('does not read errands or bookings as calls for help', () => {
    for (const text of ['Can you send someone to fix the boiler?', 'I need help with my shopping', 'I need a doctor to look at my knee', "I need a doctor's note for the gym"]) {
      expect(detectR1(text)).toEqual([]);
    }
  });
});

describe('detectR1: figures of speech', () => {
  it.each(['Oh, you gave me a heart attack, the phone rang just as I sat down!', "You'll give me a heart attack one of these days", 'The bill nearly gave us a heart attack'])('%s', (text) => {
    expect(detectR1(text)).toEqual([]);
  });

  it('a real heart attack is still caught', () => {
    expect(categories("I'm having a heart attack")).toEqual(['chest_pain']);
    expect(categories('I think I gave myself a fright, I might be having a heart attack')).toEqual(['chest_pain']);
  });

  it('breathlessness from laughing, told as past, is not an emergency', () => {
    expect(detectR1('I was gasping for air, I laughed so much')).toEqual([]);
    expect(detectR1('We were giggling so hard I was out of breath')).toEqual([]);
  });

  it('breathlessness told in the present, or still going, is caught even with laughter', () => {
    expect(categories("I'm gasping for air")).toEqual(['breathing']);
    expect(categories("I was laughing and now I can't breathe")).toEqual(['breathing']);
    expect(categories('I was gasping for air after laughing and I still am')).toEqual(['breathing']);
  });

  it('a racing heart while watching something exciting, now over, is not an emergency', () => {
    expect(detectR1('My heart was racing when I watched the sumo final')).toEqual([]);
    expect(detectR1('My heart was pounding with excitement at the match')).toEqual([]);
  });

  it('a racing heart now, or one that has not settled, is caught', () => {
    expect(categories('My heart is racing')).toEqual(['chest_pain']);
    expect(categories('My heart was racing when I watched the news and it still is')).toEqual(['chest_pain']);
    expect(categories('My heart was pounding this morning and it won\'t slow down')).toEqual(['chest_pain']);
  });
});

describe('detectR1: brief symptoms that have passed', () => {
  it.each([
    'I was out of breath at the top of the hill, but I sat down for a minute and I was fine',
    'I was a bit breathless after the stairs, but it passed once I sat down',
    'I felt a bit faint earlier, but the nurse checked me. I am fine now',
    'A bit of rice got stuck in my throat but I coughed it up',
  ])('%s', (text) => {
    expect(detectR1(text)).toEqual([]);
  });

  it('breathlessness that has not passed is caught', () => {
    expect(categories('I was out of breath this morning and I still am')).toEqual(['breathing']);
    expect(categories('I was out of breath after the stairs and it has not passed')).toEqual(['breathing']);
    expect(categories('I was short of breath, it went away but now it is back again')).toEqual(['breathing']);
    expect(categories('I got out of breath on the stairs')).toEqual(['breathing']);
  });

  it('a present symptom is never dropped for a reassurance', () => {
    expect(categories("I'm out of breath, but I'm fine")).toEqual(['breathing']);
    expect(categories("I can't breathe, I'm fine really, don't fuss")).toEqual(['breathing']);
    expect(categories("It's probably nothing but my chest is tight")).toEqual(['chest_pain']);
  });

  it('chest pain that has eased is still caught', () => {
    expect(categories('My chest was tight earlier but it eased off')).toEqual(['chest_pain']);
  });
});

describe('detectR1: long-standing limits are not falls', () => {
  it.each([
    "I can't get up the hill with my trolley anymore",
    "I can't get up the stairs, so I sleep downstairs",
    "I can't get up from the floor cushions easily, so I use a chair",
    "I can't stand for long these days",
    "I can't stand the heat",
    "I can't move the wardrobe on my own",
  ])('%s', (text) => {
    expect(detectR1(text)).toEqual([]);
  });

  it('falls and being stuck are caught even with a word like "anymore"', () => {
    expect(categories("I fell and I can't get up")).toEqual(['unable_to_move']);
    expect(categories("I can't get up anymore, I've been on the floor since lunch")).toEqual(['unable_to_move']);
    expect(categories("I can't get up easily, I've fallen in the kitchen")).toEqual(['unable_to_move']);
    expect(categories("I can't get up, please help")).toEqual(['calling_for_help', 'unable_to_move']);
  });

  it('does not match inside other words', () => {
    expect(detectR1("I can't get upset about it")).toEqual([]);
  });
});

describe('detectR1: who the symptom belongs to', () => {
  it.each([
    'I watched a drama where a man had a heart attack in the street',
    "I'm reading a mystery where the old lady collapses and can't breathe",
    'In the film the main character is gasping for breath',
    'Mrs Sato had a heart attack on the bus',
    "She fell and can't get up",
    'Someone on the news was choking',
  ])('%s', (text) => {
    expect(detectR1(text)).toEqual([]);
  });

  it('the resident is still the subject after naming others', () => {
    expect(categories("My husband says I can't breathe at night")).toEqual(['breathing']);
    expect(categories("I rang my son and can't get up")).toEqual(['unable_to_move']);
    expect(categories("I watched a drama and now I can't breathe")).toEqual(['breathing']);
    expect(categories('The doctor said it was nothing, but my chest hurts')).toEqual(['chest_pain']);
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
