export interface CampaignTemplate {
    id: string;
    name: string;
    category: string;
    description: string;
    icon: string;
    goal: 'book_meeting' | 'qualify_lead' | 'transfer_to_human' | 'nurture' | 'sell_direct';
    targetPersona: string;
    offer: string;
    valueProps: string[];
    painPoints: string[];
    openingScript: string;
    qualifyingQuestions: string[];
    objectionHandlers: { objection: string; response: string }[];
    callingHours: {
        startHour: number;
        endHour: number;
        daysOfWeek: number[];
        timezoneOffsetMinutes: number;
    };
    maxConcurrentCalls: number;
    retryAttempts: number;
    retryDelayMinutes: number;
    recordingEnabled: boolean;
    consentDisclosure: string;
    honorDnc: boolean;
    tags: string[];
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
    {
        id: 'appointment-reminder',
        name: 'Appointment Reminder',
        category: 'Healthcare & Services',
        description: 'Automatically remind patients or clients about upcoming appointments and reduce no-shows.',
        icon: 'Calendar',
        goal: 'nurture',
        targetPersona: 'Scheduled patients or service clients with upcoming appointments',
        offer: 'A friendly reminder about their upcoming appointment with option to reschedule',
        valueProps: [
            'Reduce no-show rates by up to 40%',
            'Give clients easy reschedule options',
            'Save staff time on manual reminder calls',
            'Improve client satisfaction with proactive communication',
        ],
        painPoints: [
            'High no-show rates',
            'Staff spending time on manual reminder calls',
            'Missed appointments waste revenue',
        ],
        openingScript: "Hi, this is {agentName} calling from {businessName}. I'm reaching out to remind you about your appointment scheduled for {appointmentDate} at {appointmentTime}. Does that still work for you?",
        qualifyingQuestions: [
            'Can you confirm your appointment on {date} at {time}?',
            'Do you need to reschedule or have any questions before your visit?',
            'Do you have any special needs or questions we should prepare for?',
        ],
        objectionHandlers: [
            { objection: "I need to reschedule", response: "Of course! I can help with that. What date and time works best for you this week or next?" },
            { objection: "I already know about it", response: "Wonderful! We just wanted to make sure everything is all set for you. Is there anything you need from us before you come in?" },
            { objection: "I'm going to cancel", response: "I understand. May I ask what's making it difficult? We may be able to find a time that works better for you." },
            { objection: "Wrong number", response: "I apologize for the confusion! I'll make sure to update our records. Have a great day." },
        ],
        callingHours: { startHour: 9, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5], timezoneOffsetMinutes: 0 },
        maxConcurrentCalls: 5,
        retryAttempts: 2,
        retryDelayMinutes: 120,
        recordingEnabled: false,
        consentDisclosure: 'This call may be recorded for quality purposes.',
        honorDnc: true,
        tags: ['healthcare', 'reminder', 'appointment'],
    },
    {
        id: 'lead-followup',
        name: 'Lead Follow-Up',
        category: 'Sales & CRM',
        description: 'Follow up with leads from your CRM pipeline who showed interest but haven\'t converted yet.',
        icon: 'UserCheck',
        goal: 'qualify_lead',
        targetPersona: 'Warm leads who engaged with your product or downloaded content',
        offer: 'A personalized conversation to understand their needs and show how we can solve them',
        valueProps: [
            'Convert more warm leads into paying customers',
            'Reach leads while interest is still fresh',
            'Qualify budget, authority, need, and timeline',
            'Build personal rapport at scale',
        ],
        painPoints: [
            'Leads go cold before sales team can reach them',
            'Manual follow-up is inconsistent',
            'Sales team spends time on unqualified leads',
        ],
        openingScript: "Hi {firstName}, this is {agentName} from {businessName}. I noticed you recently {leadAction} and wanted to personally reach out. Do you have 2 minutes to chat about how we might be able to help?",
        qualifyingQuestions: [
            'What prompted you to {leadAction}? What challenge were you hoping to solve?',
            'Have you looked at other solutions in this space?',
            'Who else is involved in making this kind of decision at your company?',
            'If this is a fit, what does your timeline look like for getting something in place?',
        ],
        objectionHandlers: [
            { objection: "I'm still just researching", response: "That's totally fine - this call is actually perfect timing then. What are the top 2-3 things you're evaluating? I can share how we address those specifically." },
            { objection: "Just send me an email", response: "Absolutely. So the email is as relevant as possible, could I ask one quick question: what's the main challenge you're trying to solve right now?" },
            { objection: "We don't have budget right now", response: "Understood. A lot of companies we work with felt the same way until they saw the ROI. When does your next budget cycle open up?" },
            { objection: "We already have a solution", response: "That's great! Out of curiosity, what do you like most about it - and is there anything you wish it handled better?" },
        ],
        callingHours: { startHour: 9, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5], timezoneOffsetMinutes: 0 },
        maxConcurrentCalls: 5,
        retryAttempts: 3,
        retryDelayMinutes: 60,
        recordingEnabled: true,
        consentDisclosure: 'This call may be recorded for training and quality purposes.',
        honorDnc: true,
        tags: ['sales', 'crm', 'warm-leads'],
    },
    {
        id: 'cold-outreach',
        name: 'Cold Outreach / Prospecting',
        category: 'Sales & Growth',
        description: 'Reach new prospects who fit your ICP and open the door for a sales conversation.',
        icon: 'Megaphone',
        goal: 'book_meeting',
        targetPersona: 'Decision-makers and influencers at companies that match your ideal customer profile',
        offer: 'A 15-minute discovery call to see if there\'s a fit',
        valueProps: [
            'Scale outreach without scaling headcount',
            'Qualify prospects before spending sales time',
            'Book meetings directly into your calendar',
            'Consistent messaging at every touchpoint',
        ],
        painPoints: [
            'Too few qualified meetings on the calendar',
            'Sales reps spend too much time on cold prospecting',
            'Inconsistent outreach messaging',
        ],
        openingScript: "Hi {firstName}, this is {agentName} from {businessName}. I'll be upfront - this is a cold call, but I promise I'll be brief. We help {targetPersona} {primaryValueProp}. Is this even remotely relevant to anything you're dealing with right now?",
        qualifyingQuestions: [
            'How are you currently handling {painPoint} today?',
            'Is that something that\'s causing real pain for your team?',
            'Who at your company owns this problem?',
            'Would a quick 15-minute call to see if we can help make sense this week?',
        ],
        objectionHandlers: [
            { objection: "I'm not interested", response: "I completely respect that. Out of curiosity, is it that this isn't a priority, or is it something you're already solving well?" },
            { objection: "How did you get my number?", response: "Great question - you matched our research profile as someone working in {industry}. If this isn't relevant, I'll make sure you're off our list immediately." },
            { objection: "I'm too busy", response: "I hear you - I'll keep this to one minute. We've helped {socialProof}. Is {painPoint} something that's on your radar at all?" },
            { objection: "Send me an email first", response: "Happy to. To make it worth your time, can I ask: is {painPoint} something you're actively trying to solve this quarter?" },
        ],
        callingHours: { startHour: 9, endHour: 17, daysOfWeek: [1, 2, 3, 4, 5], timezoneOffsetMinutes: 0 },
        maxConcurrentCalls: 10,
        retryAttempts: 2,
        retryDelayMinutes: 1440,
        recordingEnabled: true,
        consentDisclosure: 'This call may be recorded for quality assurance.',
        honorDnc: true,
        tags: ['cold-call', 'prospecting', 'outbound'],
    },
    {
        id: 'payment-reminder',
        name: 'Payment / Invoice Reminder',
        category: 'Finance & Collections',
        description: 'Remind customers about outstanding invoices and past-due accounts with a professional, friendly tone.',
        icon: 'DollarSign',
        goal: 'nurture',
        targetPersona: 'Customers with outstanding invoices or past-due accounts',
        offer: 'Assistance in resolving their outstanding balance with flexible payment options if needed',
        valueProps: [
            'Recover outstanding revenue faster',
            'Maintain customer relationships during collections',
            'Offer payment plans when appropriate',
            'Reduce accounts receivable aging',
        ],
        painPoints: [
            'Slow payment collection hurts cash flow',
            'Collections calls damage customer relationships',
            'Staff time wasted on follow-ups',
        ],
        openingScript: "Hi {firstName}, this is {agentName} from {businessName}. I'm calling regarding invoice #{invoiceNumber} for {amount} that was due on {dueDate}. I wanted to check in to see if there's anything we can help with to get this resolved.",
        qualifyingQuestions: [
            'Did you receive invoice #{invoiceNumber} for {amount}?',
            'Is there any issue with the invoice we should be aware of?',
            'Would you be able to process this payment today, or would a payment plan be helpful?',
            'What\'s the best way for you to submit payment?',
        ],
        objectionHandlers: [
            { objection: "I already paid", response: "Thank you for letting me know! Payments can sometimes take a few days to process. Could you share the payment date or reference number so we can verify on our end?" },
            { objection: "I have a dispute about this invoice", response: "I understand - disputes happen and we want to make it right. Let me connect you with our billing team to resolve this properly. What's the specific concern?" },
            { objection: "I can't pay right now", response: "I appreciate you being upfront. We do have flexible payment options available. Would a payment plan help you manage this? I can note that on your account." },
            { objection: "I'm not aware of this invoice", response: "No problem at all. I can resend the invoice to your email on file. Is {email} still the best address for you?" },
        ],
        callingHours: { startHour: 9, endHour: 17, daysOfWeek: [1, 2, 3, 4, 5], timezoneOffsetMinutes: 0 },
        maxConcurrentCalls: 5,
        retryAttempts: 3,
        retryDelayMinutes: 1440,
        recordingEnabled: true,
        consentDisclosure: 'This call may be recorded. This is an attempt to collect a debt.',
        honorDnc: true,
        tags: ['collections', 'billing', 'payment'],
    },
    {
        id: 'event-promo',
        name: 'Event / Webinar Promotion',
        category: 'Marketing',
        description: 'Drive registrations for your upcoming event, webinar, or product launch with personalized outreach.',
        icon: 'Calendar',
        goal: 'book_meeting',
        targetPersona: 'Prospects and existing customers who would benefit from your event topic',
        offer: 'A free invitation to attend {eventName} on {eventDate}',
        valueProps: [
            'Learn {keyTopic} from industry experts',
            'Network with peers in {industry}',
            'Get actionable insights you can use immediately',
            'Receive exclusive content available only to attendees',
        ],
        painPoints: [
            'Staying up-to-date on {industry} trends',
            'Finding practical solutions to {keyChallenge}',
            'Limited time for in-depth research',
        ],
        openingScript: "Hi {firstName}, this is {agentName} from {businessName}. I'm reaching out because we're hosting {eventName} on {eventDate}, and based on your background in {industry}, I thought it might be really valuable for you. It\'s completely free - do you have 2 minutes to hear about it?",
        qualifyingQuestions: [
            'Are you currently working on challenges related to {eventTopic}?',
            'Have you attended events like this before? What did you find most valuable?',
            'Would you prefer the live session or the recorded replay?',
            'Who else on your team might benefit from attending?',
        ],
        objectionHandlers: [
            { objection: "I don't have time", response: "I understand - that\'s actually exactly why we designed this as a focused 60-minute session. You'll walk away with 3 specific actions you can take immediately. Does {eventDate} work, or would the replay be better?" },
            { objection: "I'm not interested in webinars", response: "Fair enough - a lot of people feel that way about generic webinars. This one is specifically focused on {keyPainPoint}, and the speakers have real hands-on experience. Would it help if I sent you the agenda first?" },
            { objection: "Is this a sales pitch?", response: "No sales pitch at all - we actually have a strict policy against that in our events. It\'s purely educational content from {speaker}. We save any product conversations for after, only if you're interested." },
        ],
        callingHours: { startHour: 9, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5], timezoneOffsetMinutes: 0 },
        maxConcurrentCalls: 8,
        retryAttempts: 2,
        retryDelayMinutes: 2880,
        recordingEnabled: false,
        consentDisclosure: '',
        honorDnc: true,
        tags: ['event', 'webinar', 'marketing'],
    },
    {
        id: 'customer-survey',
        name: 'Customer Satisfaction Survey',
        category: 'Customer Success',
        description: 'Collect NPS, CSAT, or qualitative feedback from customers after key interactions.',
        icon: 'Star',
        goal: 'nurture',
        targetPersona: 'Existing customers after a purchase, onboarding, or support interaction',
        offer: 'A 3-minute feedback call to help us improve your experience',
        valueProps: [
            'Help improve our product and service',
            'Your feedback directly shapes our roadmap',
            'Takes less than 3 minutes',
            'Chance to share any unresolved issues',
        ],
        painPoints: [
            'Feeling unheard as a customer',
            'Products that don\'t match real-world needs',
        ],
        openingScript: "Hi {firstName}, this is {agentName} from {businessName}. I'm calling to follow up on your recent {interaction} and ask a few quick questions about your experience. It'll only take about 3 minutes - is now an okay time?",
        qualifyingQuestions: [
            'On a scale of 1 to 10, how satisfied were you with your overall experience?',
            'What was the highlight of your experience with us?',
            'Is there anything we could have done better?',
            'How likely are you to recommend {businessName} to a colleague or friend?',
        ],
        objectionHandlers: [
            { objection: "I'm too busy right now", response: "No worries at all - it really is just 3 questions. But if now's not good, when would be a better time to call back?" },
            { objection: "I already left a review", response: "Thank you so much for doing that! I just have one quick question: is there anything specific we could improve that wasn't in the review?" },
            { objection: "I had a bad experience", response: "I'm really sorry to hear that - and that's exactly why I'm calling. I want to make sure this gets addressed properly. Can you tell me what happened?" },
        ],
        callingHours: { startHour: 10, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5], timezoneOffsetMinutes: 0 },
        maxConcurrentCalls: 3,
        retryAttempts: 1,
        retryDelayMinutes: 2880,
        recordingEnabled: false,
        consentDisclosure: 'This call may be recorded for quality improvement.',
        honorDnc: true,
        tags: ['survey', 'nps', 'customer-success'],
    },
    {
        id: 'reactivation',
        name: 'Win-Back / Reactivation',
        category: 'Retention',
        description: 'Re-engage churned customers or dormant leads who haven\'t interacted in 90+ days.',
        icon: 'RefreshCw',
        goal: 'qualify_lead',
        targetPersona: 'Former customers or leads who went dark 90+ days ago',
        offer: 'A personal check-in and exclusive win-back offer to make things right',
        valueProps: [
            'Catch up on what\'s new since you last connected',
            'Exclusive offer only available to returning customers',
            'No pressure - just want to see how things are going',
            'Resolve any past issues that caused you to leave',
        ],
        painPoints: [
            'Previously unresolved issues with the product or service',
            'Found a competitor but may be open to switching back',
            'Budget constraints at the time they churned',
        ],
        openingScript: "Hi {firstName}, this is {agentName} from {businessName}. It's been a while - about {monthsSince} since we last connected, and I wanted to personally reach out to see how things are going on your end. Do you have just 2 minutes?",
        qualifyingQuestions: [
            'It\'s been a while - how have things been going since we last spoke?',
            'Have things changed for you or your business since then?',
            'Were there any specific reasons things didn\'t work out on your end?',
            'Would you be open to hearing about what\'s changed on our side since then?',
        ],
        objectionHandlers: [
            { objection: "We moved on to another solution", response: "Totally understandable. Out of curiosity, what made you choose them - is it something specific they do that we didn't?" },
            { objection: "We had a bad experience before", response: "I'm really sorry to hear that - and I want to be transparent that we've made a lot of changes since then. Would you be willing to tell me what happened? I want to make sure it's been addressed." },
            { objection: "We don't have budget right now", response: "I completely understand. Budget timing is tricky. We actually have a special re-engagement offer available - would it be worth a quick 10-minute call to see if the math works?" },
            { objection: "We're happy where we are", response: "That's great to hear - I'm glad things are working out! I'd just love to stay in touch. Is it okay if I check back in 6 months?" },
        ],
        callingHours: { startHour: 9, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5], timezoneOffsetMinutes: 0 },
        maxConcurrentCalls: 5,
        retryAttempts: 2,
        retryDelayMinutes: 4320,
        recordingEnabled: true,
        consentDisclosure: 'This call may be recorded for quality purposes.',
        honorDnc: true,
        tags: ['win-back', 'churn', 'retention'],
    },
];

export const getCampaignTemplateById = (id: string): CampaignTemplate | undefined =>
    CAMPAIGN_TEMPLATES.find(t => t.id === id);
