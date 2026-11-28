/** Shared by the public page, staff enrollment and the API. Keep this module browser-safe. */
export const PRIVACY_NOTICE = {
  version: '2026-11-28',
  title: 'Privacy and your choice',
  introduction: 'Hachi makes daily telephone check-ins to help your care team notice when you may need support. Your care team can explain the key points and answer questions before you decide whether to take part.',
  sections: [
    {
      title: 'Talking with an AI',
      paragraphs: [
        'You will be talking with Hachi, an AI assistant, rather than a person. Google Gemini processes the call audio and transcript to hold the conversation and help review it afterward.',
        'Hachi looks at what you say and changes in how you speak, including pauses, hesitations, vocabulary and staying on topic. These checks help staff decide what to follow up. They are not a medical diagnosis.',
      ],
    },
    {
      title: 'What we save',
      paragraphs: [
        'Calls are recorded and transcribed. Hachi saves summaries, well-being observations, speech measurements and short notes to help with your next conversation. It also keeps your name, phone number, call time, care circumstances, and the staff and family contacts registered for you.',
      ],
    },
    {
      title: 'What staff and family can see',
      paragraphs: [
        'Authorized care staff can see recordings, transcripts, analysis and care cases. Your registered family contact can see short plain-language summaries, call times, alerts, case status and your care team’s contact details. Family cannot access recordings, transcripts, direct quotes or speech analysis.',
        'Your first-use approval includes short family updates about your mood and loneliness. You can ask your care team to withdraw permission for family updates separately from permission for calls.',
        'If Hachi notices a possible emergency, it may alert and phone your registered staff and family contacts without asking again during that call.',
      ],
    },
    {
      title: 'Services and locations',
      paragraphs: [
        'Hachi uses Google Cloud, including Gemini and Firebase, and Twilio for telephone calls and text messages. Email alerts use SendGrid when enabled. Live call audio is processed in the United States; post-call Gemini analysis uses a global service. Stored care records and recordings use Tokyo by default. Your care team can explain the settings used for your service.',
      ],
    },
    {
      title: 'Keeping your information',
      paragraphs: [
        'Your care organization can set how long recordings and transcripts are kept. When that period ends, staff access ends and Hachi removes them automatically. Summaries and case records follow your care organization’s policy. Ask your care team how long they keep each kind of information.',
        'Stopping calls does not delete past records. A deletion request is a separate request to your care team.',
      ],
    },
    {
      title: 'Your choice',
      paragraphs: [
        'Taking part is optional. Before calls begin, your care team explains this notice and records your explicit agreement. You only need to give this approval when you first start using Hachi; it is not requested again on daily calls.',
        'You can end any call by hanging up. Contact the care team that enrolled you to withdraw permission for future calls, change family sharing or request deletion.',
      ],
    },
    {
      title: 'Support',
      paragraphs: [
        'For questions about Hachi, your information or stopping calls, contact the care team that enrolled you. Use the contact details they gave you; your registered family member can also find them in Hachi’s family dashboard.',
        'Hachi does not replace urgent help. In Japan, call 119 for an ambulance if you need emergency assistance.',
      ],
    },
  ],
  firstUsePrompt: 'Hachi is an AI that calls daily. Calls are recorded and analyzed with Google Gemini to help your care team. Staff can review them; your family gets short summaries, including mood and loneliness, and alerts, including in emergencies. Taking part is optional. Ask your care team to stop calls at any time. Is that OK?',
  agreement: 'Yes, I agree.',
} as const;

export interface ConsentWithdrawal {
  at: string;
  by: string;
  name?: string;
  /** Tasks created under an earlier consent stay invalid even if the resident approves again. */
  revision: number;
}

/** The resident's approval, recorded by the staff member who heard it. */
export interface CallConsent {
  accepted: boolean;
  noticeVersion: string;
  recordedAt: string;
  recordedBy: string;
  lastWithdrawal?: ConsentWithdrawal;
}

export function callConsentRevision(consent: CallConsent | undefined): number {
  return consent?.lastWithdrawal?.revision ?? 0;
}

export function permitsCall(consent: CallConsent | undefined, revision = 0): boolean {
  return hasCallConsent(consent) && callConsentRevision(consent) === revision;
}

/** A newer notice does not make an existing first-use approval expire. */
export function hasCallConsent(consent: CallConsent | undefined | null): boolean {
  return Boolean(
    consent?.accepted === true &&
    consent.noticeVersion?.trim() &&
    consent.recordedBy?.trim() &&
    Number.isFinite(Date.parse(consent.recordedAt)),
  );
}
