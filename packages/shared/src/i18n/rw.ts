// Kinyarwanda strings: the ONLY place Kinyarwanda text lives in the codebase.
//
// NEEDS NATIVE CHECK: every string in this file was drafted without a native speaker and must
// be reviewed by one before the pilot. Keep apostrophes straight (') so SMS stay in the GSM-7
// alphabet (a curly apostrophe turns an SMS into Unicode and cuts the limit to 70 characters).
import type { Messages, SmsVars } from './en';

export const NEEDS_NATIVE_CHECK = true;

export const rw: Messages = {
  langName: 'Ikinyarwanda',
  tagline: 'Menya umwanya wawe. Menya aho ukurikira.',

  sms: {
    waitMinutes: (n: number) => `hafi iminota ${n}`,
    waitNoStaff: 'nta muganga uhari ubu',
    JOINED: (v: SmsVars) => `Umurongo: Itike ${v.number}. Abantu ${v.ahead} imbere yawe, ${v.wait}. Kurikira umwanya wawe: ${v.link}`,
    GET_READY: (v: SmsVars) => `Umurongo: Itegure! ${v.number}: hasigaye abantu ${v.ahead} imbere yawe. Guma hafi ya ${v.dept}.`,
    CALLED: (v: SmsVars) => `Umurongo: Igihe cyawe kirageze! ${v.number}, jya kuri ${v.room} ubu.`,
    NEXT_STEP: (v: SmsVars) => `Umurongo: Intambwe ikurikira: ${v.dept}, itike ${v.number}. Aho ujya: ${v.link}`,
    WAIT_CHANGED: (v: SmsVars) => `Umurongo: ${v.number}: igihe cyo gutegereza cyahindutse, ${v.wait}.`,
    FEEDBACK: (v: SmsVars) => `Umurongo: Murakoze kugana ${v.hospital}. Mwanyuzwe na serivisi? Subiza 1 = yego, 2 = oya.`,
    DAY_CLOSED: (v: SmsVars) => `Umurongo: ${v.dept} yafunze uyu munsi, itike ${v.number} yarangiye. Tuzongera gufungura ${v.day} saa ${v.time}.`,
    FEEDBACK_THANKS: 'Umurongo: Murakoze ku gisubizo cyanyu.',
  },

  days: { today: 'uyu munsi', tomorrow: 'ejo' },

  common: {
    notFound: 'Ntibibonetse',
    home: 'Ahabanza',
    errorTitle: 'Habaye ikibazo',
    errorText: 'Ongera ufungure iyi paji.',
    backToStart: 'Subira ahabanza',
    haveTicket: 'Ufite itike? Suzuma QR kode iri ku itike yawe.',
  },

  ticket: {
    yourTicket: 'Itike yawe',
    peopleAhead: (n: number) => (n === 0 ? 'Nta muntu uri imbere yawe' : n === 1 ? 'Umuntu 1 uri imbere yawe' : `Abantu ${n} bari imbere yawe`),
    ahead: 'bari imbere yawe',
    minutes: 'iminota',
    imGoing: 'Yego, ndagiye',
    estimatedWait: 'Igihe cyo gutegereza',
    aboutMinutes: (n: number) => `Hafi iminota ${n}`,
    noDoctor: 'Nta muganga uhari ubu',
    staffAvailable: (available: number, onDuty: number, doctors: boolean) =>
      `${doctors ? 'Abaganga' : 'Abakozi'} ${available} kuri ${onDuty} barahari`,
    noStaffOnDuty: 'Nta mukozi uri ku kazi ubu',
    turnSoon: 'Igihe cyawe kiri hafi. Guma hafi.',
    status: {
      WAITING: 'Uri ku murongo',
      CHECKED_IN: 'Uri ku murongo',
      CALLED: 'Igihe cyawe kirageze!',
      IN_CONSULTATION: 'Urimo kwakirwa',
      DONE: 'Uruzinduko rwawe rurangiye',
      REFERRED: 'Intambwe ikurikira',
      NO_SHOW: 'Itike yawe yarangiye',
      CANCELLED: 'Itike yawe yahagaritswe',
      CLOSED: 'Serivisi yafunze uyu munsi',
    },
    goToRoom: (room: string) => `Jya kuri ${room}`,
    calledBy: (name: string) => `${name} aragutegereje`,
    inRoom: (room: string) => `Muri ${room}`,
    tapForAlerts: 'Kanda hano kugira ngo telefoni isone kandi inyeganyege',
    alertsOn: 'Ijwi no kunyeganyega byafunguwe',
    doneText: 'Murakoze kuza. Mugire ubuzima bwiza.',
    referredText: 'Ufite itike nshya y\'intambwe ikurikira.',
    openNextTicket: 'Fungura itike yanjye nshya',
    noShowText: 'Wahamagawe ariko ntiwaje. Baza ku kwakira abarwayi.',
    cancelledText: 'Baza ku kwakira abarwayi niba ugikeneye kwakirwa.',
    closedText: 'Uzagaruke igihe serivisi izongera gufungura.',
    whatToBring: 'Ibyo witwaza',
    journeyTitle: 'Urugendo rwawe',
    journey: { RECEPTION: 'Kwakirwa', CONSULTATION: 'Kwa muganga', NEXT_STEPS: 'Laboratwari, kwishyura, farumasi', DONE: 'Byarangiye' },
    offline: 'Turakwereka umwanya wawe uheruka kuboneka. Ubutumwa bwa SMS buracyakora.',
    offlineNoSms: 'Turakwereka umwanya wawe uheruka kuboneka. Turongera guhuza...',
    smsOn: 'Tuzanakoherereza ubutumwa bwa SMS.',
    smsOff: 'Nta SMS kuri iyi tike. Komeza iyi paji ifunguye.',
    updated: (time: string) => `Byavuguruwe ${time}`,
    notFoundTitle: 'Iyi tike ntiboneka',
    notFoundText: 'Reba ko link yuzuye, cyangwa ubaze ku kwakira abarwayi.',
    loadError: 'Ntibyakunze kubona itike yawe. Reba interineti yawe.',
    retry: 'Ongera ugerageze',
    loading: 'Birimo gufunguka...',
    keepOpen: 'Komeza iyi paji ifunguye. Yivugurura ubwayo.',
  },

  tv: {
    nowCalling: 'Turahamagara',
    live: 'Bigezweho',
    reconnecting: 'Turongera guhuza...',
    room: 'Icyumba',
    lastCalls: 'Abahamagawe',
    next: 'Abakurikira',
    waiting: (n: number) => `${n} bategereje`,
    noCalls: 'Nta muntu urahamagarwa',
    nobodyWaiting: 'Nta muntu utegereje',
    staffTitle: "Abaganga n'abakozi",
    turnOnSound: 'Fungura ijwi',
    soundOn: 'Ijwi rirafunguye',
    messages: [
      'Kurikira umwanya wawe kuri telefoni: suzuma QR kode iri ku itike yawe.',
      'Watanze nimero ya telefoni? Tuzakoherereza SMS igihe cyawe kigeze.',
      'Igihe cyo gutegereza ni igereranya. Indembe zakirwa mbere.',
      'Witwaze ibyo ukeneye: urutonde ruri ku ipaji y\'itike yawe.',
      'Ukeneye ubufasha? Baza ku kwakira abarwayi.',
    ],
  },

  staffStatus: {
    AVAILABLE: 'Arahari',
    IN_CONSULTATION: 'Ari kwakira umurwayi',
    IN_SURGERY: 'Ari kubaga',
    ON_BREAK: 'Ari mu kiruhuko',
    AWAY: 'Ntahari',
    OFF_DUTY: 'Ntari ku kazi',
  },

  print: {
    ticket: 'Itike',
    scan: 'Suzuma kugira ngo ukurikire umwanya wawe',
    tvAndSms: 'Reba kuri TV. Tunohereza SMS niba watanze nimero ya telefoni.',
    keep: 'Bika iyi tike kugeza urangije.',
  },
};
