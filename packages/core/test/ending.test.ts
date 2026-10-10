import { describe, expect, it } from 'vitest';
import { END_QUESTION, isClosingReply, isSpokenFarewell, residentWantsToEnd } from '../src/ending.js';

const ASKED = `That sounds like a lovely day. ${END_QUESTION}`;

describe('residentWantsToEnd (issue #10)', () => {
  it.each([
    'I have to go now.',
    "I've got to go",
    'Okay, goodbye!',
    'Bye bye',
    'Thank you, bye Hachi',
    "That's all for today, bye Hachi.",
    "Let's end the call.",
    "I'd like to finish for today",
    'Can we stop talking now',
    'Well, I must go now.',
  ])('hears "%s" as wanting to end', (said) => {
    expect(residentWantsToEnd(said)).toBe(true);
  });

  describe('does not hear these as wanting to end', () => {
    it.each([
      // Negation
      "I don't want to hang up yet",
      "This isn't the end of our chat",
      'I am not ready to say goodbye',
      'Wait, one more thing before we end the call',
      // Hypothetical, conditional or future
      'If you need to go, we can end the call',
      'When we finish the call I will make tea',
      'Bye, see you tomorrow',
      "Let's end the call later",
      'We can talk again next time',
      // Someone else's words
      'My son said I should hang up on these calls',
      'She told me to say goodbye to you',
      // Questions
      'Are we finished?',
      'Is that it?',
      'Do you have to go?',
      'Why do you want to hang up',
      // Nothing at all
      '',
      '   ',
    ])('"%s"', (said) => {
      expect(residentWantsToEnd(said, ASKED)).toBe(false);
    });
  });

  describe('a bare yes', () => {
    it('counts only right after a single question asking whether to end the call', () => {
      expect(residentWantsToEnd('Yes', ASKED)).toBe(true);
      expect(residentWantsToEnd('Yes, okay, thank you.', ASKED)).toBe(true);
      expect(residentWantsToEnd('That sounds good', 'Shall we finish for today?')).toBe(true);
    });

    it('does not count after any other question, or after none', () => {
      expect(residentWantsToEnd('Yes')).toBe(false);
      expect(residentWantsToEnd('Yes', 'Is the pain severe?')).toBe(false);
      expect(residentWantsToEnd('Yes', 'Would you like to chat more or end the call?')).toBe(false);
      expect(residentWantsToEnd('Yes', "Is that all? Would you like to end our call now?")).toBe(false);
      expect(residentWantsToEnd('Yes', "You don't want to end the call yet?")).toBe(false);
      expect(residentWantsToEnd('Yes', 'Would you like to end our call now.')).toBe(false);
    });

    it('is a yes and nothing else', () => {
      expect(residentWantsToEnd("Yes, I'm fine", ASKED)).toBe(false);
      expect(residentWantsToEnd('No', ASKED)).toBe(false);
    });

    // Refusing these would send Hachi back to the same question every time the resident answers it.
    it.each(['Yes dear', 'Okay then', 'Yes, I think so', 'Yes please, that would be lovely', "Yes, don't worry", 'Alright, yes'])(
      'still counts "%s", a yes said the way people say it',
      (said) => {
        expect(residentWantsToEnd(said, ASKED)).toBe(true);
      },
    );

    it.each(["Yes... I don't think so", 'Okay, no', 'Yes, but one more thing', "Don't go", "Don't hang up yet"])(
      'does not count "%s", which is not a yes',
      (said) => {
        expect(residentWantsToEnd(said, ASKED)).toBe(false);
      },
    );

    it('counts after the end question even when the transcript has no punctuation', () => {
      expect(residentWantsToEnd('yes', 'that was nice would you like to end our call now')).toBe(true);
      expect(residentWantsToEnd('yes', 'would you like to chat more or would you like to end our call now')).toBe(false);
      expect(residentWantsToEnd('yes', 'shall we finish for today')).toBe(false);
    });
  });
});

describe('isSpokenFarewell (issue #10)', () => {
  it('recognises a goodbye', () => {
    expect(isSpokenFarewell('Thank you, Maggie. It was lovely talking with you. Goodbye!')).toBe(true);
    expect(isSpokenFarewell('Take care. Bye for now.')).toBe(true);
  });

  it('does not take a question, a goodbye taken back, or no goodbye at all for one', () => {
    expect(isSpokenFarewell('Before we say goodbye, is there anything else?')).toBe(false);
    expect(isSpokenFarewell('Oh, I spoke too soon. Not goodbye yet.')).toBe(false);
    expect(isSpokenFarewell('Thank you for telling me about your garden.')).toBe(false);
    expect(isSpokenFarewell('')).toBe(false);
  });
});

describe('isClosingReply (issue #10)', () => {
  it('lets an answering goodbye keep the ending', () => {
    for (const said of [
      'Bye!',
      'Thank you, you too.',
      'Okay, take care. Bye bye.',
      'See you tomorrow then',
      '',
      'Goodnight',
      'Thanks for calling',
      'Thank you for ringing, bye',
      'Cheerio',
      "You're welcome, bye",
      'Bye, God bless',
      'Mm-hmm',
      'It was lovely talking to you',
    ]) {
      expect(isClosingReply(said)).toBe(true);
    }
  });

  it('reopens the call for anything else', () => {
    for (const said of ['Oh wait', 'Actually, one more thing', 'Bye. Oh, my leg hurts', 'Hang on']) {
      expect(isClosingReply(said)).toBe(false);
    }
  });
});
