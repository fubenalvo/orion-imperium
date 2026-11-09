/*
 * =========================================================
 * FIRST CONTACT — DIALOGUE CONTENT (data)
 * =========================================================
 *
 * The texts of the contact dialogue (docs/first-contact.md, "Dialogue
 * content"). One pool of questions per temperament: the asking empire's
 * temperament decides which questions it asks and how it judges every
 * reply (`value`, the reply term of the evaluation in first-contact.ts).
 *
 * `tone` says what kind of answer a reply is, so an AI meeting another AI
 * can answer "in character" (warlike temperaments give the hard answer,
 * peaceful ones the open one) without a dialogue.
 *
 * Placeholders: {empire} the asking empire, {player} the met empire.
 */

export type ReplyTone = 'open' | 'neutral' | 'hard';

export interface ContactReply {
  text: string;
  value: number;
  tone: ReplyTone;
  /* Remembered answer (contactAnswers; campaign dialogue may read it). */
  flag?: string;
}

export interface ContactQuestion {
  id: string;
  text: string;
  replies: [ContactReply, ContactReply, ContactReply];
}

export interface ContactPool {
  greeting: string;
  questions: ContactQuestion[];
  closing: { warm: string; cold: string; war: string };
}

const r = (text: string, value: number, tone: ReplyTone, flag?: string): ContactReply => ({ text, value, tone, ...(flag ? { flag } : {}) });

export const CONTACT_POOLS: Readonly<Record<string, ContactPool>> = {
  technologist: {
    greeting: 'Greetings, {player}. We are {empire}. Our instruments have followed your ships for some time. We would rather understand you than fear you.',
    questions: [
      { id: 'tech_seek', text: 'What do your people seek among the stars?', replies: [r('Knowledge, above all.', 12, 'open'), r('New markets and new partners.', 4, 'neutral'), r('Room to grow, and the means to defend it.', -10, 'hard')] },
      { id: 'tech_share', text: 'Would you share what your scientists have learned?', replies: [r('Openly, with anyone who asks.', 10, 'open'), r('In exchange for what you have learned.', 5, 'neutral'), r('Our discoveries are our own.', -8, 'hard')] },
      { id: 'tech_disputes', text: 'How do your people settle their disputes?', replies: [r('By debate and evidence.', 10, 'open'), r('By law, and by compromise when the law fails.', 6, 'neutral'), r('The stronger argument usually has more ships.', -12, 'hard')] },
      { id: 'tech_ruins', text: 'This region holds ruins older than both of us. What would you do with them?', replies: [r('Study them, and leave them standing.', 10, 'open'), r('Learn what we can, then decide.', 3, 'neutral'), r('Whatever gives us an advantage.', -10, 'hard')] },
      { id: 'tech_observatories', text: 'Our observatories lie near your borders. Will they be safe?', replies: [r('As safe as our own.', 12, 'open'), r('As long as they only watch the stars.', 0, 'neutral'), r('Move them, and there will be no question.', -12, 'hard')] },
    ],
    closing: {
      warm: 'Then let us learn from each other. Welcome, {player}.',
      cold: 'We will keep our distance, and our instruments on you.',
      war: 'You leave us no choice. We will defend what we have learned.',
    },
  },
  balanced: {
    greeting: 'We are {empire}. We have no quarrel with you yet, {player}. Let us keep it that way.',
    questions: [
      { id: 'bal_borders', text: 'Will you respect the borders of others?', replies: [r('Yes, gladly.', 8, 'open'), r('As long as ours are respected.', 5, 'neutral'), r('Borders are drawn by strength.', -10, 'hard')] },
      { id: 'bal_want', text: 'What does your government want from us?', replies: [r('Peace and honest trade.', 8, 'open'), r('Nothing yet. We are listening.', 3, 'neutral'), r('Your neutrality, if you value your worlds.', -10, 'hard')] },
      { id: 'bal_crossed', text: 'Your ships have crossed space we consider ours. Was that deliberate?', replies: [r('No. We will be more careful.', 8, 'open'), r('We did not know it was claimed.', 4, 'neutral'), r('Space belongs to whoever holds it.', -12, 'hard')] },
      { id: 'bal_ally', text: 'Would you stand with us if a third power attacked?', replies: [r('If you would do the same for us.', 8, 'open'), r('We would talk first, then decide.', 5, 'neutral'), r('Your wars are your own.', -6, 'hard')] },
      { id: 'bal_treaties', text: 'How long do your treaties last?', replies: [r('As long as both sides keep them.', 8, 'open'), r('As long as they serve us both.', 3, 'neutral'), r('Until they become inconvenient.', -12, 'hard')] },
    ],
    closing: { warm: 'Good. Peace serves us both.', cold: 'Peace, then. Do not test it.', war: 'So be it. You chose this.' },
  },
  expansionist: {
    greeting: '{empire} claims the worlds between our stars. You are late, {player}. Tell us why we should make room for you.',
    questions: [
      { id: 'exp_settle', text: 'These worlds are unclaimed. Do you intend to settle them?', replies: [r('Only what we need to survive.', 8, 'neutral'), r('We will share them fairly.', -6, 'open'), r('As many as we can hold.', -10, 'hard')] },
      { id: 'exp_colony_ships', text: 'How many colony ships do you launch each year?', replies: [r('Enough to hold what we have.', 10, 'hard'), r('Few. We are a small people.', -8, 'open'), r('More every year.', -10, 'neutral')] },
      { id: 'exp_line', text: 'Would you accept a line in space that neither of us crosses?', replies: [r('Yes, and we will keep it.', 10, 'open'), r('Only if it is drawn fairly.', 4, 'neutral'), r('We draw our own lines.', -12, 'hard')] },
      { id: 'exp_room', text: 'Our people need more room. What would you give us?', replies: [r('Nothing, but we will not stand in your way elsewhere.', 10, 'hard'), r('A share of what we find.', 2, 'open'), r('A war, if you come for it.', -8, 'neutral')] },
      { id: 'exp_met', text: 'Who else have you met out here?', replies: [r('We will tell you what we know.', 8, 'open'), r('That is our business.', 0, 'hard'), r('No one worth mentioning.', -6, 'neutral')] },
    ],
    closing: { warm: 'For now the line holds. Do not cross it.', cold: 'For now the line holds. Do not cross it.', war: 'Then we will take the room we need.' },
  },
  militarist: {
    greeting: '{empire} speaks. We have counted your ships, {player}. Now answer us, and choose your words with care.',
    questions: [
      { id: 'mil_warships', text: 'How many warships guard your homeworld?', replies: [r('Enough to break any attack.', 10, 'hard'), r('We prefer not to say.', 0, 'neutral'), r('We are a peaceful people.', -12, 'open')] },
      { id: 'mil_kneel', text: 'Will you kneel to the strong?', replies: [r('Never.', 10, 'hard'), r('We kneel to no one, but we can talk.', 3, 'neutral'), r('If we must.', -12, 'open')] },
      { id: 'mil_command', text: 'Who commands your fleets?', replies: [r('Admirals who have won their battles.', 8, 'hard'), r('Our elected council.', -4, 'neutral'), r('No one. We have no real navy.', -12, 'open')] },
      { id: 'mil_attackers', text: 'What do you do with those who attack you?', replies: [r('We break them.', 10, 'hard'), r('We defend ourselves, then we negotiate.', 2, 'neutral'), r('We try to reason with them.', -10, 'open')] },
      { id: 'mil_passage', text: 'Our ships will pass through your space. Will you stop them?', replies: [r('Try it and find out.', 8, 'hard'), r('Ask first, and we may allow it.', 2, 'neutral'), r('We will not interfere.', -12, 'open')] },
    ],
    closing: { warm: 'You are not prey. Not today.', cold: 'You are not prey. Not today.', war: 'Good. We hoped you would say that.' },
  },
  mercantile: {
    greeting: 'Welcome, {player}! {empire} trades with anyone who pays. Shall we see what you are worth?',
    questions: [
      { id: 'mer_offer', text: 'What can you offer the markets?', replies: [r('Goods and fair prices.', 12, 'open'), r('Protection for your traders.', 2, 'neutral'), r('Nothing you need.', -10, 'hard')] },
      { id: 'mer_traders', text: 'Will your warships leave our traders alone?', replies: [r('Always.', 12, 'open'), r('Unless they trade with our enemies.', -2, 'neutral'), r('Traders who pay us have nothing to fear.', -10, 'hard')] },
      { id: 'mer_tariffs', text: 'What do you think of tariffs?', replies: [r('Low, and the same for everyone.', 10, 'open'), r('We set them where we need them.', 0, 'neutral'), r('We prefer to take what we need.', -12, 'hard')] },
      { id: 'mer_ports', text: 'Would you open your ports to our ships?', replies: [r('Gladly.', 10, 'open'), r('To some of them, for a fee.', 4, 'neutral'), r('Our ports are closed.', -10, 'hard')] },
      { id: 'mer_debts', text: 'Do you pay your debts?', replies: [r('Every credit, on time.', 10, 'open'), r('When we can.', 0, 'neutral'), r('Debts are for the weak.', -12, 'hard')] },
    ],
    closing: { warm: 'Splendid! The markets are open to you.', cold: 'We will trade with you, carefully.', war: 'Bad for business. Mostly yours.' },
  },
  guardian: {
    greeting: 'We are {empire}. We have watched this region for a very long time, {player}. We have questions.',
    questions: [
      { id: 'gua_old_ones', text: 'Have you touched what the old ones left behind?', replies: [r('We study it with care.', 8, 'open'), r('We do not know what you mean.', 0, 'neutral'), r('We use what we find.', -10, 'hard')] },
      { id: 'gua_door', text: 'If you found a door that should stay closed, would you open it?', replies: [r('No. Some doors are closed for a reason.', 12, 'open'), r('Only if we understood what lies behind it.', 4, 'neutral'), r('Every door can be opened.', -12, 'hard')] },
      { id: 'gua_fear', text: 'What do you fear?', replies: [r('Our own mistakes.', 10, 'open'), r('Those who are stronger than us.', 2, 'neutral'), r('Nothing.', -8, 'hard')] },
      { id: 'gua_listen', text: 'Will you listen when we warn you?', replies: [r('Always.', 10, 'open'), r('We will weigh your warning.', 4, 'neutral'), r('We make our own decisions.', -6, 'hard')] },
      { id: 'gua_why', text: 'Why did you come here?', replies: [r('By accident. We want to understand where we are.', 8, 'open'), r('To find a new home.', 4, 'neutral'), r('To take what this region offers.', -12, 'hard')] },
    ],
    closing: { warm: 'Perhaps you will be different from the others.', cold: 'We will be watching.', war: 'Then we must stop you before you do harm.' },
  },
};

/* Signature questions of the campaign factions, asked first (docs/first-contact.md). */
export const SIGNATURE_QUESTIONS: Readonly<Record<string, ContactQuestion>> = {
  concordium: { id: 'sig_concordium', text: 'The gate you came through was not built by you. Do you know who built it?', replies: [r('No, and we want to learn, with you if you allow it.', 12, 'open'), r('We have theories. We would share them, for a price.', 2, 'neutral'), r('Whoever built it is gone. It is ours now.', -12, 'hard')] },
  varkon: { id: 'sig_varkon', text: 'The Dominion takes tribute from the weak. Are you weak?', replies: [r('Come and find out.', 10, 'hard'), r('We are strong enough to talk as equals.', 4, 'neutral'), r('We would rather pay than fight.', -12, 'open', 'offered_tribute')] },
  meridian: { id: 'sig_meridian', text: 'Every power wants our trade routes. What do you want?', replies: [r('Fair access, like everyone else.', 12, 'open'), r('Safe routes. We can provide the escorts.', 4, 'neutral'), r('Control. It is simpler.', -12, 'hard')] },
  observers: { id: 'sig_observers', text: 'You opened the Lacuna core. What did you learn?', replies: [r('That the network must not be opened carelessly.', 12, 'open', 'accord_minded'), r('That it is powerful, and that power can be shared.', 0, 'neutral', 'union_minded'), r('That whoever powers the Heart rules the Frontier.', -12, 'hard', 'dominion_minded')] },
};

export const GIFT_REACTIONS = {
  peaceful: 'A generous gesture. It will be remembered.',
  warlike: 'Tribute. A wise beginning.',
} as const;
