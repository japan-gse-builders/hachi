import { describe, expect, it } from 'vitest';
import { needsHomeScreen } from '../src/device';
import { audioAt, callStatusLabel, channelList, clock, deliveryLabel, eventLabel, familyDeliveryList, formatWhen, minutes, phoneDisplay, speakerLabel, speechLine, topicList, urgencyTone } from '../src/format';

describe('staff display helpers', () => {
  it('maps urgency to a tone and leaves unknown values calm', () => {
    expect(urgencyTone('emergency')).toBe('emergency');
    expect(urgencyTone('urgent')).toBe('urgent');
    expect(urgencyTone('mystery')).toBe('watch');
  });

  it('formats times in Japan and offsets inside a recording', () => {
    expect(formatWhen('2026-10-02T07:41:00.000Z')).toBe('2 Oct, 16:41');
    expect(formatWhen('not-a-date')).toBe('not-a-date');
    expect(clock(125000)).toBe('2:05');
    expect(clock(undefined)).toBe('');
  });

  it('labels transcript turns with the resident name, not the greeting name', () => {
    expect(speakerLabel('agent', 'Test Resident')).toBe('Hachi');
    expect(speakerLabel('resident', 'Test Resident')).toBe('Test Resident');
    expect(speakerLabel('resident', '  ')).toBe('Resident');
  });

  it('describes calls, history events and speech in plain words', () => {
    expect(callStatusLabel('no_answer')).toBe('No answer');
    expect(callStatusLabel('mystery')).toBe('mystery');
    expect(eventLabel('rank_changed')).toBe('Rank adjusted');
    expect(eventLabel('something_new')).toBe('something new');
    expect(minutes(64)).toBe('1:04');
    expect(minutes(null)).toBe('');
    expect(speechLine({ lexicalDiversity: 0.512, repairRate: 1.25, responseLatencyMs: 1500, topicCoherence: null })).toBe(
      'vocabulary 0.51 · self-corrections 1.3 · reply 1.5 s · coherence —',
    );
  });

  it('names alert channels in plain words for family', () => {
    expect(channelList(['sms', 'voice', 'push'])).toBe('text message, phone call, app alert');
    expect(channelList(['fax'])).toBe('fax');
  });

  it('shows whether a notification reached the phone, with the carrier reason for staff', () => {
    expect(deliveryLabel(undefined)).toBe('Sent');
    expect(deliveryLabel({ status: 'sent' })).toBe('Sent');
    expect(deliveryLabel({ status: 'delivered' })).toBe('Delivered');
    expect(deliveryLabel({ status: 'undelivered', errorCode: '30007' })).toBe('Not delivered (carrier blocked, code 30007)');
    expect(deliveryLabel({ status: 'failed', errorCode: '21610' })).toBe('Not delivered (code 21610)');
    expect(deliveryLabel({ status: 'no_answer' })).toBe('No answer');
    expect(deliveryLabel({ status: 'mystery' })).toBe('Sent');
  });

  it('tells family which alerts reached them, in plain words', () => {
    expect(
      familyDeliveryList([
        { channel: 'sms', status: 'undelivered', errorCode: '30007' },
        { channel: 'voice', status: 'answered', errorCode: null },
        { channel: 'email', status: null, errorCode: null },
        { channel: 'push', status: null, errorCode: null },
        { channel: 'push', status: null, errorCode: null },
        { channel: 'fax', status: 'sent', errorCode: null },
      ]),
    ).toBe('text message (not delivered), phone call (answered), email, app alert, fax');
  });

  it('lists call topics without capitals in the middle of a sentence', () => {
    expect(topicList(['A visit from their grandson this Sunday', 'Their garden'])).toBe('A visit from their grandson this Sunday · Their garden');
    expect(topicList(['Lunch'])).toBe('Lunch');
  });

  it('shows Japanese care-team numbers the way family dial them at home', () => {
    expect(phoneDisplay('+819000000000')).toBe('090-0000-0000');
    expect(phoneDisplay('+815000000000')).toBe('050-0000-0000');
    expect(phoneDisplay('+81120000000')).toBe('0120-000-000');
    expect(phoneDisplay('+81300000000')).toBe('0300000000');
    expect(phoneDisplay('+15005550006')).toBe('+15005550006');
    expect(phoneDisplay('')).toBe('');
  });

  it('asks iPhone users to add Hachi to the home screen before alerts', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
    expect(needsHomeScreen(iphone, false)).toBe(true);
    expect(needsHomeScreen(iphone, true)).toBe(false);
    expect(needsHomeScreen('Mozilla/5.0 (Linux; Android 15) Chrome/140', false)).toBe(false);
  });

  it('starts the recording at the quoted words', () => {
    expect(audioAt('https://x/a.wav?sig=1', 55400)).toBe('https://x/a.wav?sig=1#t=55');
    expect(audioAt('https://x/a.wav', undefined)).toBe('https://x/a.wav');
  });
});
