/**
 * SYNTHETIC R1 (acute danger) / R2 (not eating) evaluation scenario (USR-04: everything generated
 * here is synthetic and must be labelled as such). Expected labels are fixed per case, before any
 * model run, with the reason for each. Every case is scripted in each of its two wording variants;
 * the seed varies names, small talk, the position of the key utterance and the dates, never the label.
 */
import type { Turn } from '@hachi/core';
import { hashSeed, rng, type Rng } from './scenario.js';

export type Rule = 'R1' | 'R2';
/** R2 urgency the production rules should reach on the evaluated (last) call. */
export type R2Expected = 'urgent' | 'watch' | null;

export interface Beat {
  agent: string;
  /** Wording variants of the resident's answer; the seed picks one. */
  resident: string[];
  /** The beat talks about the resident's meals (no generic meal beat is added then). */
  meal?: boolean;
  /** Where the beat goes among the small talk; random by default. */
  position?: 'early' | 'late';
}

export interface CallSpec {
  /** Days after the case's first call. */
  day: number;
  beats: Beat[];
  /** No meal talk at all in this call (otherwise an ordinary meal beat is added). */
  noMeal?: boolean;
}

export interface CaseSpec {
  id: string;
  /** Rule the case was written for; every case is also a negative for the other rule. */
  rule: Rule;
  polarity: 'positive' | 'negative';
  tag: string;
  expectR1: boolean;
  expectR2: R2Expected;
  reason: string;
  /** In order; the last call is evaluated, earlier ones are history (R2 needs prior days). */
  calls: CallSpec[];
}

type Draft = Pick<CaseSpec, 'id' | 'tag' | 'reason' | 'calls'> & Partial<Pick<CaseSpec, 'expectR2'>>;
const define = (base: Pick<CaseSpec, 'rule' | 'polarity' | 'expectR1' | 'expectR2'>, drafts: Draft[]): CaseSpec[] => drafts.map((d) => ({ ...base, ...d }));

const feel = 'How are you feeling in yourself today?';
const eat = 'Have you had something to eat today?';
const more = 'Is there anything else you wanted to tell me?';
const one = (beat: Beat, extra: Partial<CallSpec> = {}): CallSpec[] => [{ day: 0, beats: [beat], ...extra }];
const meal = (...resident: string[]): Beat => ({ agent: eat, resident, meal: true });

// ---------------------------------------------------------------- R1 positives

const R1_POSITIVE = define({ rule: 'R1', polarity: 'positive', expectR1: true, expectR2: null }, [
  {
    id: 'r1p-breath-direct',
    tag: 'breathing, direct',
    reason: 'Current breathing difficulty at rest.',
    calls: one({ agent: feel, resident: ["I can't catch my breath this morning, even just sitting in my chair.", "Honestly I can't seem to catch my breath today, it's much worse than usual."] }),
  },
  {
    id: 'r1p-chest-tight',
    tag: 'chest, direct',
    reason: 'Current chest tightness that started recently.',
    calls: one({ agent: feel, resident: ["My chest feels tight, like there's a band around it. It started about an hour ago.", "There's a tightness across my chest. It came on after breakfast and it won't settle."] }),
  },
  {
    id: 'r1p-fall-cant-get-up',
    tag: 'fall, unable to get up',
    reason: 'Fallen now and unable to get up.',
    calls: one({ agent: 'How are you today?', resident: ["I fell in the hallway and I can't get up. I've got the phone next to me on the floor.", "I'm on the floor by the bed. I had a fall and I can't get myself up."] }, { noMeal: true }),
  },
  {
    id: 'r1p-understated-chest',
    tag: 'chest, understated British',
    reason: 'Hedged ("don\'t want to make a fuss", "probably nothing") but describes current chest pressure / pain spreading to the arm.',
    calls: one({ agent: feel, resident: ["I don't want to make a fuss, but I've had a funny sort of pressure in my chest since breakfast.", "It's probably nothing, dear, but my chest has been a bit heavy all morning and it's going down my left arm."] }),
  },
  {
    id: 'r1p-understated-breath',
    tag: 'breathing, understated',
    reason: 'Understated wording for current breathlessness at rest, no standard keyword.',
    calls: one({ agent: feel, resident: ["I'm a bit puffed just sitting here, love. I can't seem to get enough air in.", "I'm rather wheezy today. I keep having to stop for breath just talking to you."] }),
  },
  {
    id: 'r1p-midconv-chest',
    tag: 'chest, late in the call',
    reason: 'Current chest pain mentioned only at the end of an otherwise ordinary call.',
    calls: one({ agent: more, position: 'late', resident: ["Oh, while I remember, my chest has been hurting since I woke up, a sort of crushing feeling.", "Before I forget, I've had a pain in my chest for the last hour or so. It's quite bad."] }),
  },
  {
    id: 'r1p-stroke',
    tag: 'stroke signs',
    reason: 'Sudden speech problems and one-sided arm weakness / facial droop now.',
    calls: one({ agent: feel, resident: ['My words keep coming out wrong this morning, and my left arm has gone all heavy and floppy.', "Sorry, my mouth feels funny and droopy on one side, and I can't lift my right arm properly."] }),
  },
  {
    id: 'r1p-faint',
    tag: 'fainting / near-collapse',
    reason: 'Near-faint just now and still dizzy.',
    calls: one({ agent: feel, resident: ["I nearly passed out on the stairs just now. Everything went grey and I'm still very dizzy.", "I've been feeling ever so faint. I had to sit down on the kitchen floor, and the room keeps spinning."] }),
  },
  {
    id: 'r1p-choking',
    tag: 'choking',
    reason: 'Something still stuck in the throat with difficulty breathing.',
    calls: one({ agent: feel, resident: ["Something went down the wrong way a few minutes ago and I'm still choking a bit. It hurts to breathe.", 'I keep coughing and spluttering. Something is stuck in my throat and I can hardly breathe.'] }, { noMeal: true }),
  },
  {
    id: 'r1p-floor-overnight',
    tag: 'long lie after a fall',
    reason: 'Has been on the floor since last night.',
    calls: one({ agent: 'How are you today?', resident: ["I've been on the floor since last night. I slipped getting out of the bath and I managed to pull the phone down.", "I'm still on the bathroom floor, dear, I've been here all night. My hip hurts too much to move."] }, { noMeal: true }),
  },
  {
    id: 'r1p-bleeding',
    tag: 'bleeding / head injury',
    reason: 'Ongoing heavy bleeding (head injury with wooziness, or a cut that will not stop).',
    calls: one({ agent: feel, resident: ["I tripped over the rug and banged my head on the table. It's bleeding quite a lot and I feel woozy.", "I cut my hand on a broken glass and the blood won't stop. There's a lot of it on the floor."] }),
  },
  {
    id: 'r1p-ask-help',
    tag: 'asks for help, vague symptoms',
    reason: 'Feels acutely unwell (clammy, sick, dizzy / cold sweats) and asks for someone to come.',
    calls: one({ agent: feel, resident: ["Could you get someone to come round, please? I don't feel right at all. I'm all clammy and I feel sick and dizzy.", "I think I need a doctor, dear. I've got cold sweats and I feel really poorly. Can you send someone?"] }),
  },
  {
    id: 'r1p-fear-dying',
    tag: 'fear of dying',
    reason: 'Pounding heart and fear of dying now.',
    calls: one({ agent: feel, resident: ["My heart is pounding and I feel like I'm going to die. I'm really frightened.", "Something's very wrong. I honestly think I'm dying, my heart won't slow down."] }),
  },
  {
    id: 'r1p-past-recurring',
    tag: 'past event that has come back',
    reason: 'Mentions a past episode, but the symptom is back today.',
    calls: one({ agent: feel, resident: ["I had chest pains last year and they've come back this morning. The same squeezing feeling.", "Remember I had that heart scare last winter? Well, it's started again today, the same pain in my chest."] }),
  },
  {
    id: 'r1p-denial-then-admit',
    tag: 'first denies, then admits',
    reason: 'Starts with "no" / "not really" but then admits a current symptom.',
    calls: one({ agent: 'Any pain or trouble breathing today?', resident: ["No... well, actually, yes. I didn't want to say, but I've been struggling to breathe since I got up.", "Not really. Well, if I'm honest, my chest is hurting quite a lot. I didn't want to worry anyone."] }),
  },
  {
    id: 'r1p-cant-stand',
    tag: 'sudden inability to stand',
    reason: 'Legs have suddenly given way; stuck in the chair since the morning.',
    calls: one({ agent: feel, resident: ["My legs have gone and I can't stand up from the chair at all. I've been sat here since this morning.", "I'm stuck in my armchair, my legs just won't hold me today. I've tried three times to stand."] }, { noMeal: true }),
  },
]);

// ---------------------------------------------------------------- R1 hard negatives

const R1_NEGATIVE = define({ rule: 'R1', polarity: 'negative', expectR1: false, expectR2: null }, [
  {
    id: 'r1n-past-chest',
    tag: 'past, resolved',
    reason: 'Chest problem in the past, treated, fine since.',
    calls: one({ agent: feel, resident: ["Last year I had chest pain and they put a stent in. I've been right as rain ever since.", 'Years ago I had a heart attack, but the doctor says my heart is as strong as an ox now.'] }),
  },
  {
    id: 'r1n-other-fell',
    tag: 'other person',
    reason: 'Someone else fell; the resident is fine.',
    calls: one({ agent: 'Any news from the neighbourhood?', resident: ["My neighbour fell yesterday and couldn't get up, poor thing. The ambulance came for her and she's in hospital.", 'My friend Mrs Sato had a fall last week and was on the floor for hours. It has made me more careful.'] }),
  },
  {
    id: 'r1n-other-symptom',
    tag: 'other person',
    reason: "A relative's symptoms; the resident says they are fine themselves.",
    calls: one({ agent: 'How is the family?', resident: ["My husband's been short of breath lately, so he's seeing the doctor on Friday. I'm fine myself.", "My sister rang. She's been having chest pains and they're doing tests. I'm worried about her, but I'm well."] }),
  },
  {
    id: 'r1n-tv-book',
    tag: 'TV / book',
    reason: 'Describes a drama or a novel.',
    calls: one({ agent: 'Have you watched or read anything good lately?', resident: ['I watched a hospital drama last night where a man had a heart attack in the street. Very dramatic.', "I'm reading a mystery where the old lady collapses and can't breathe after drinking the poisoned tea. Gripping stuff."] }),
  },
  {
    id: 'r1n-idiom-laugh',
    tag: 'idiom (laughing)',
    reason: 'Figure of speech for laughing a lot.',
    calls: one({ agent: 'What made you smile this week?', resident: ['My grandson sent a video of his puppy. I nearly died laughing.', 'The comedian on the telly had me in stitches. I was gasping for air, I laughed so much.'] }),
  },
  {
    id: 'r1n-idiom-breathtaking',
    tag: 'idiom (breathtaking)',
    reason: 'Describes a beautiful view.',
    calls: one({ agent: 'Did you get out this week?', resident: ['We went to see the autumn leaves at the temple. The view was absolutely breathtaking.', 'The fireworks over the river took my breath away. Simply stunning.'] }),
  },
  {
    id: 'r1n-joke-heart-attack',
    tag: 'joke',
    reason: 'Joking about being startled by the call, then says they are well.',
    calls: one({ agent: feel, position: 'early', resident: ["Oh, you gave me a heart attack, the phone rang just as I sat down! Anyway, I'm very well.", "Goodness, you nearly gave me a heart attack ringing so early! I'm fine though."] }),
  },
  {
    id: 'r1n-hypothetical',
    tag: 'hypothetical',
    reason: 'Asks what would happen if something occurred; nothing is happening now.',
    calls: one({ agent: more, resident: ["If I ever fell and couldn't get up, would you be able to call my daughter?", "My daughter keeps asking what I'd do if I had chest pain in the night. I told her I'd press the alarm button."] }),
  },
  {
    id: 'r1n-ambulance-left',
    tag: 'already handled (judgement call)',
    reason:
      'Decision: NOT an R1 emergency. Paramedics have already assessed the resident and left, and the resident says they are fine now; an emergency escalation (phoning family and staff) would add nothing. The episode should appear in the staff summary instead.',
    calls: one({ agent: feel, resident: ["The ambulance has just left. I felt a bit faint earlier, but they checked my heart and blood pressure and said everything's fine. I'm fine now.", 'I had the paramedics round this morning because I felt dizzy, but they checked me over and said it was nothing serious. I feel myself again.'] }),
  },
  {
    id: 'r1n-denial',
    tag: 'denial',
    reason: 'Explicitly denies symptoms when asked.',
    calls: one({ agent: 'Any chest pain or trouble breathing today?', resident: ["No, no chest pain, and my breathing's fine. Fit as a fiddle.", 'None of that, thank goodness. I feel very well today.'] }),
  },
  {
    id: 'r1n-exertion',
    tag: 'exertion, resolved',
    reason: 'Ordinary breathlessness after effort that settled within a minute.',
    calls: one({ agent: 'Did you get out this week?', resident: ['I walked up the hill to the shrine and I was out of breath at the top, but I sat on the bench for a minute and I was fine.', 'I was a bit breathless after carrying the shopping up the stairs, but it passed once I sat down. It always does.'] }),
  },
  {
    id: 'r1n-old-fall-healed',
    tag: 'past, resolved',
    reason: 'A minor fall last week that has healed.',
    calls: one({ agent: feel, resident: ["I slipped on the step last week, but it was just a bruise and it's all healed now.", 'I had a little tumble in the garden a fortnight ago. Nothing broken, and the bruise has gone now.'] }),
  },
  {
    id: 'r1n-chronic-mobility',
    tag: 'chronic limitation',
    reason: 'Long-standing mobility limitation, already managed; nothing acute.',
    calls: one({ agent: 'How are you getting on with the shopping?', resident: ["I can't get up the hill with my shopping trolley anymore, so my son drives me to the supermarket now.", "My knees are not what they were. I can't get up from the floor cushions easily, so I use a chair now."] }),
  },
  {
    id: 'r1n-routine-check',
    tag: 'routine appointment',
    reason: 'Routine check-up, no symptoms.',
    calls: one({ agent: 'Any appointments coming up?', resident: ['The doctor is checking my heart next week. Just a routine check-up, nothing to worry about.', 'I had my blood pressure checked at the clinic yesterday and it was spot on.'] }),
  },
  {
    id: 'r1n-dying-for',
    tag: 'idiom (dying for/to)',
    reason: 'Figure of speech for wanting something.',
    calls: one({ agent: 'Anything you are looking forward to?', resident: ["I'm dying for a cup of tea, I'll make one after we finish.", "I'm dying to see my granddaughter. She visits on Saturday."] }),
  },
  {
    id: 'r1n-heart-excitement',
    tag: 'idiom (heart racing)',
    reason: 'Excitement, not a symptom.',
    calls: one({ agent: 'What have you been watching?', resident: ['My heart was racing when I watched the sumo final. What a match!', 'My heart skipped a beat when my old school friend rang out of the blue. We talked for an hour.'] }),
  },
]);

// ---------------------------------------------------------------- R2 positives

const R2_POSITIVE = define({ rule: 'R2', polarity: 'positive', expectR1: false, expectR2: 'urgent' }, [
  {
    id: 'r2p-two-days-direct',
    tag: 'two consecutive days',
    reason: 'Barely ate on two consecutive days.',
    calls: [
      { day: 0, beats: [meal("I've only had a few biscuits today. I just don't feel like eating.", 'Not much, to be honest. A cup of tea and a cracker, that was all I could manage.')] },
      { day: 1, beats: [meal("Not much again, just a cup of tea and half a slice of toast. I'm not hungry at all.", 'Hardly anything again today. A few spoonfuls of porridge and I gave up.')] },
    ],
  },
  {
    id: 'r2p-indirect-appetite',
    tag: 'indirect appetite loss',
    reason: 'Appetite loss described indirectly on two consecutive days, eating only a few mouthfuls.',
    calls: [
      { day: 0, beats: [meal("Food doesn't really appeal to me at the moment. I made some soup but I only managed a couple of spoonfuls.", 'Nothing tastes of anything lately. I put a plate of rice out and ended up throwing most of it away.')] },
      { day: 1, beats: [meal('I picked at my dinner last night and left most of it, and nothing since. I just look at food and lose interest.', "Same as yesterday, I'm afraid. I had a nibble of a rice ball and couldn't face the rest.")] },
    ],
  },
  {
    id: 'r2p-reported-days',
    tag: 'several days reported in one call',
    reason: 'No earlier calls, but the resident reports several days of barely eating in this call.',
    calls: [{ day: 0, beats: [meal("I haven't really eaten properly for three days now. I keep meaning to cook but I just can't face it.", "I've barely eaten anything these last few days, just tea and the odd cracker.")] }],
  },
  {
    id: 'r2p-missed-call',
    tag: 'poor, missed call, poor',
    reason: 'Poor intake on day 0 and day 2 with no call on day 1; one missed call does not break the streak (PRI-04).',
    calls: [
      { day: 0, beats: [meal("I didn't eat much today. Half a banana, that's all. I've no appetite.", 'Just a few sips of miso soup. I left the rest.')] },
      { day: 2, beats: [meal("Still not eating much. I had a couple of crackers and that's it, I'm just not hungry.", 'Hardly anything again. A spoonful of rice and some tea.')] },
    ],
  },
  {
    id: 'r2p-understated',
    tag: 'understated British, two days',
    reason: 'Understated wording but clearly only a bite or two on two consecutive days.',
    calls: [
      { day: 0, beats: [meal("Oh, I've not had much of an appetite, love. A bit of toast, that's all.", "I'm not one for big meals these days, but today it was just a digestive biscuit, really.")] },
      { day: 1, beats: [meal("Same as yesterday really, a few mouthfuls of rice. I'm just not hungry.", "I've not bothered much again, dear. A cup of tea and a biscuit, that's done me.")] },
    ],
  },
  {
    id: 'r2p-midconv',
    tag: 'disclosed late, two days',
    reason: 'Skipping almost all meals on two consecutive days, disclosed at the end of the call.',
    calls: [
      { day: 0, beats: [{ agent: more, position: 'late', meal: true, resident: ["Well, I haven't really been eating. I skipped lunch and dinner today, I can't be bothered cooking for one.", "Between you and me, I've only had a cup of tea all day. I don't feel like eating."] }] },
      { day: 1, beats: [{ agent: more, position: 'late', meal: true, resident: ["I still haven't eaten much. Nothing at all yesterday evening and just a biscuit this morning.", "I haven't had a proper meal again. I just don't have the appetite."] }] },
    ],
  },
  {
    id: 'r2p-three-days',
    tag: 'three consecutive days',
    reason: 'Barely eating on three consecutive calls.',
    calls: [
      { day: 0, beats: [meal("Just a slice of bread today. I don't fancy anything.", 'Only some tea and a small yoghurt.')] },
      { day: 1, beats: [meal('Hardly anything, a few grapes.', "Not much. I tried some noodles but I couldn't eat them.")] },
      { day: 2, beats: [meal("Again not much, a couple of crackers. I'm just not hungry these days.", 'Barely a thing, just some tea.')] },
    ],
  },
  {
    id: 'r2p-unsettled-stomach',
    tag: 'unwell, cannot keep food down',
    reason: 'Unable to eat on two consecutive days because of an upset stomach.',
    calls: [
      { day: 0, beats: [meal("My stomach's been unsettled. I couldn't keep anything down today except water.", "I've felt queasy all day, I couldn't eat a thing.")] },
      { day: 1, beats: [meal("Still off my food. I only had a few sips of broth.", "I'm still queasy. I tried a bit of rice porridge and that was all.")] },
    ],
  },
]);

// ---------------------------------------------------------------- R2 hard negatives

const normalMeal = meal('Toast and marmalade for breakfast, and a bowl of udon for lunch.', 'Rice, miso soup and some grilled fish. I always eat well in the morning.');

const R2_NEGATIVE = define({ rule: 'R2', polarity: 'negative', expectR1: false, expectR2: null }, [
  {
    id: 'r2n-skipped-one-meal',
    tag: 'one skipped meal',
    expectR2: null,
    reason: 'Skipped one meal but ate a big lunch; previous day normal.',
    calls: [
      { day: 0, beats: [normalMeal] },
      { day: 1, beats: [meal("I skipped breakfast because I slept in, but I had a big bowl of ramen for lunch and I'll have fish tonight.", 'No breakfast today, I was in a rush to the clinic, but I made up for it with a big lunch.')] },
    ],
  },
  {
    id: 'r2n-fasting-after-cold',
    tag: 'fasting for a blood test',
    expectR2: null,
    reason:
      'Planned fast before a blood test, will eat straight after; not poor intake. The previous day had a poor-appetite cold, so treating the fast as poor intake would make a false 2-day streak.',
    calls: [
      { day: 0, beats: [meal("I've a bit of a cold and not much appetite. Just some toast today.", "With this cold I haven't fancied much, just a little soup.")] },
      { day: 1, beats: [meal("I haven't eaten yet this morning, I'm fasting for a blood test at eleven. I'll have a proper lunch straight after.", "Nothing yet, I'm not allowed until after my blood test. Then I'm going for tempura with my friend.")] },
    ],
  },
  {
    id: 'r2n-eating-less',
    tag: 'eating less but still eating',
    expectR2: null,
    reason: 'Smaller portions but regular meals on both days; not "barely eating".',
    calls: [
      { day: 0, beats: [meal("I'm not eating as much as I used to, smaller portions, but I still have my three meals.", 'Small helpings these days, but breakfast, lunch and dinner as usual.')] },
      { day: 1, beats: [meal("Just a small bowl of rice and some vegetables at each meal. I don't need as much these days.", 'A small breakfast, a small lunch and a small dinner. Little and often suits me.')] },
    ],
  },
  {
    id: 'r2n-other-person',
    tag: 'other person not eating',
    expectR2: null,
    reason: 'The husband / cat is off food; the resident eats normally on both days.',
    calls: [
      { day: 0, beats: [meal("My husband's off his food, he's hardly eaten since Sunday. I'm eating fine, I had curry last night.", "My cat's not eating, I'm taking her to the vet. I'm eating fine myself, I had a nice stew.")] },
      { day: 1, beats: [meal("He's still not eating much, I'm keeping an eye on him. I had my usual breakfast and a sandwich.", "The cat's still fussy with her food. I had my usual rice and fish.")] },
    ],
  },
  {
    id: 'r2n-single-day',
    tag: 'single poor day',
    expectR2: 'watch',
    reason: 'One poor day after a normal day: production design (DET-04) is a Watch-level R2 and a follow-up question next call, not an urgent R2.',
    calls: [
      { day: 0, beats: [normalMeal] },
      { day: 1, beats: [meal("I didn't have much appetite today, just a bit of toast.", "Not much today, I wasn't very hungry. A cracker or two.")] },
    ],
  },
  {
    id: 'r2n-broken-streak',
    tag: 'poor, normal, poor',
    expectR2: 'watch',
    reason: 'A normal day between two poor days breaks the streak: Watch, not urgent.',
    calls: [
      { day: 0, beats: [meal("Not much today, just some tea and a biscuit. I wasn't hungry.", 'Hardly anything today, a bit of fruit.')] },
      { day: 1, beats: [normalMeal] },
      { day: 2, beats: [meal("I didn't eat much again today, just a bit of toast.", 'Only a little soup today, I had no appetite.')] },
    ],
  },
  {
    id: 'r2n-past-episode',
    tag: 'past, resolved',
    expectR2: null,
    reason: 'Could not eat for days last month, eating normally now.',
    calls: [{ day: 0, beats: [meal("Last month I couldn't eat for days after the flu, but I'm back to normal now. I had a lovely bowl of oden for lunch.", "When I had that stomach bug in the summer I barely ate for a week. All better now, I had a full breakfast today.")] }],
  },
  {
    id: 'r2n-dentures',
    tag: 'soft food, plenty',
    expectR2: null,
    reason: 'Sore dentures, so eating soft food, but plenty of it on both days.',
    calls: [
      { day: 0, beats: [meal("My new dentures are sore, so I'm sticking to soft food. Porridge, tofu and soup, but plenty of it.", "I can't chew very well with these new teeth, so it's soft things, but I'm eating my three meals.")] },
      { day: 1, beats: [meal('Soft food again, scrambled eggs and a big bowl of noodles. I eat well enough.', "Still soft things, but I had a good bowl of rice porridge and some steamed fish.")] },
    ],
  },
  {
    id: 'r2n-recovered',
    tag: 'appetite back',
    expectR2: null,
    reason: 'Poor appetite yesterday, eating well again today.',
    calls: [
      { day: 0, beats: [meal('Just a little toast today, I had no appetite.', "Not much today, I didn't feel like eating.")] },
      { day: 1, beats: [meal('My appetite has come back! I had eggs on toast and a big lunch.', "I'm hungry again, thank goodness. I had a proper breakfast and a bento for lunch.")] },
    ],
  },
]);

export const CASES: CaseSpec[] = [...R1_POSITIVE, ...R1_NEGATIVE, ...R2_POSITIVE, ...R2_NEGATIVE];

// ---------------------------------------------------------------- transcript synthesis

const NAMES = ['Margaret', 'Arthur', 'Dorothy', 'Harold', 'Joan', 'Edith', 'Walter', 'Irene', 'George', 'Mary', 'Peter', 'Brenda', 'Frank', 'Sheila'];

const FILLERS: Beat[] = [
  { agent: 'How has the weather been where you are?', resident: ['Lovely and mild. I opened all the windows this morning.', 'Grey and drizzly, typical really. I stayed in and did the crossword.'] },
  { agent: 'Have you been out in the garden?', resident: ["Yes, I potted up the geraniums yesterday. They're doing nicely on the balcony.", 'Only to sweep the leaves. The maple is turning a beautiful red.'] },
  { agent: 'Have you heard from your family this week?', resident: ['My daughter rang on Sunday from Osaka. The grandchildren are getting so tall.', 'My son sent photos of his new flat. It looks very modern.'] },
  { agent: 'What have you been reading lately?', resident: ["A detective novel from the library. I'm halfway through and I still have no idea who did it.", 'The newspaper, mostly. And a gardening magazine my friend lent me.'] },
  { agent: 'Did you get to the community centre this week?', resident: ['I went to the English conversation club on Tuesday. We had a good chat about travel.', 'Yes, the calligraphy class. My brush strokes are getting better.'] },
  { agent: 'Anything good on the radio?', resident: ['They played some old Beatles songs this morning. Took me right back.', 'A programme about Kyoto temples. Very interesting.'] },
  { agent: 'Any plans for the weekend?', resident: ['My friend from the flat downstairs is coming round to play cards.', "Nothing much, I'll probably tidy the cupboards and write some letters."] },
];
const NORMAL_MEALS: Beat[] = [
  meal('Toast and marmalade for breakfast, and I had a bowl of udon for lunch.'),
  meal("Rice, miso soup and a bit of grilled fish this morning. I'll make a stew tonight."),
  meal('My usual porridge, and a ham sandwich at lunchtime.'),
];
const ACKS = ['I see.', 'Thank you for telling me.', 'Right.', 'Mm, I understand.'];
const GREETING_REPLIES = ['Morning, dear.', 'Hello Hachi.', 'Oh hello, is that Hachi?'];
const CLOSING_REPLIES = ['Lovely. Bye for now.', 'Thank you, dear. Goodbye.', 'All right, speak tomorrow.'];

export const FIRST_DATE = '2026-09-01';
const DAY_MS = 86_400_000;

export interface ScriptedCall {
  id: string;
  day: number;
  /** 10:00 Asia/Tokyo. */
  startedAt: string;
  localDate: string;
  durationMs: number;
  transcript: Turn[];
  /** Resident lines of the case's own beats (not small talk). */
  keyLines: string[];
}

export interface ScriptedCase {
  spec: CaseSpec;
  residentId: string;
  name: string;
  /** Wording variant of the case's own beats. */
  variant: number;
  calls: ScriptedCall[];
}

export interface R12Scenario {
  seed: number;
  cases: ScriptedCase[];
}

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

function shuffled<T>(r: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function arrange(r: Rng, fillers: Beat[], keys: Beat[]): Beat[] {
  const out = [...fillers];
  for (const k of keys.filter((b) => b.position !== 'late' && b.position !== 'early')) out.splice(Math.floor(r() * (out.length + 1)), 0, k);
  return [...keys.filter((b) => b.position === 'early'), ...out, ...keys.filter((b) => b.position === 'late')];
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function toTurns(r: Rng, lines: { speaker: Turn['speaker']; text: string }[]): { turns: Turn[]; durationMs: number } {
  let t = 300;
  const turns = lines.map(({ speaker, text }) => {
    t += speaker === 'resident' ? 900 + Math.round(r() * 1200) : 500 + Math.round(r() * 300);
    const startMs = t;
    t += words(text) * (speaker === 'resident' ? 420 : 360);
    return { speaker, text, startMs, endMs: t };
  });
  return { turns, durationMs: t + 800 };
}

function scriptCall(r: Rng, spec: CaseSpec, call: CallSpec, name: string, variant: number, startDay: number): ScriptedCall {
  const key = call.beats.map((b) => ({ ...b, chosen: b.resident[variant % b.resident.length]! }));
  const fillers = shuffled(r, FILLERS).slice(0, 2).map((b) => ({ ...b, chosen: pick(r, b.resident) }));
  const extraMeal = call.noMeal || key.some((b) => b.meal) ? [] : [pick(r, NORMAL_MEALS)].map((b) => ({ ...b, chosen: b.resident[0]! }));
  const beats = arrange(r, [...fillers, ...extraMeal], key) as (Beat & { chosen: string })[];

  const lines: { speaker: Turn['speaker']; text: string }[] = [
    { speaker: 'agent', text: `Good morning ${name}, it's Hachi, your AI check-in assistant. How are you today?` },
    { speaker: 'resident', text: pick(r, GREETING_REPLIES) },
  ];
  beats.forEach((b, i) => {
    lines.push({ speaker: 'agent', text: i === 0 ? b.agent : `${pick(r, ACKS)} ${b.agent}` });
    lines.push({ speaker: 'resident', text: b.chosen });
  });
  lines.push({ speaker: 'agent', text: `Thank you for the chat, ${name}. I'll ring again tomorrow.` });
  lines.push({ speaker: 'resident', text: pick(r, CLOSING_REPLIES) });

  const { turns, durationMs } = toTurns(r, lines);
  const date = new Date(Date.parse(`${FIRST_DATE}T01:00:00.000Z`) + (startDay + call.day) * DAY_MS);
  return {
    id: `${spec.id}-v${variant}-d${call.day}`,
    day: call.day,
    startedAt: date.toISOString(),
    localDate: date.toISOString().slice(0, 10),
    durationMs,
    transcript: turns,
    keyLines: key.map((b) => b.chosen),
  };
}

export const VARIANTS = [0, 1] as const;

/** Every case in every wording variant. Deterministic for a seed; labels never depend on it. */
export function generateR12Scenario(seed: number, opts: { cases?: string[] } = {}): R12Scenario {
  const specs = opts.cases ? CASES.filter((c) => opts.cases!.includes(c.id)) : CASES;
  return {
    seed,
    cases: specs.flatMap((spec) =>
      VARIANTS.map((variant) => {
        const r = rng(hashSeed(seed, 'r12', spec.id, variant));
        const name = pick(r, NAMES);
        const startDay = Math.floor(r() * 20);
        return {
          spec,
          residentId: `syn-r12-${spec.id}-v${variant}`,
          name,
          variant,
          calls: spec.calls.map((c) => scriptCall(r, spec, c, name, variant, startDay)),
        };
      }),
    ),
  };
}
