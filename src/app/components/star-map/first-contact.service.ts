import { Injectable } from '@angular/core';
import { Faction, Fleet, StarSystem } from './star-map.models';
import { WAR_MIN_DURATION_SECONDS, inContact, isTreatyPair, makeContact, startWar } from './diplomacy';
import { transferResources } from './resource-transfer';
import { PLAYER_SYSTEM_SENSOR_RANGE, StarMapSensorService } from './star-map-sensor.service';
import { ResearchService } from '../../services/research.service';
import { ShipService } from '../../services/ship.service';
import { SpaceBaseService } from './space-base.service';
import { EnemyDiplomacyService } from './enemy-diplomacy.service';
import { GIFT_REACTIONS } from './contact-dialogue';
import {
  CONTACT_GIFT_TIERS,
  ContactOutcome,
  ContactQuestionSet,
  ContactStance,
  aiReplyIndex,
  aiStance,
  chooseQuestions,
  contactPool,
  evaluateContact,
  fillPlaceholders,
  isWarlikeTemperament,
  seededUnit,
  temperamentOf,
} from './first-contact';

/*
 * =========================================================
 * FIRST CONTACT SERVICE
 * =========================================================
 *
 * docs/first-contact.md. Detects meetings, runs AI–AI contacts at once and
 * queues the player's for the contact dialogue.
 *
 * - Detection (`tick`, once per second of game time): A meets B when one of
 *   A's sensor sources (owned systems, fleets — the AI intel rule, nebula
 *   penalty included) covers a fleet, an owned system or a space base of B.
 *   Fleets inside a wormhole neither sense nor are sensed.
 * - Contact state lives on the relation (`FactionRelation.contact`), so it
 *   is saved with the factions. The player's queue is in memory: after a
 *   load the meeting is simply detected again (the pair is still un-met
 *   until the dialogue is answered), so a reload never skips or repeats it.
 * - Results go through the diplomacy primitives (`makeContact`, `startWar`
 *   without a declarer, so a war from contact costs nobody reputation).
 */

export interface ContactWorld {
  factions: Faction[];
  fleets: Fleet[];
  starSystems: StarSystem[];
  /* The galaxy seed: questions, reply order and the warlike roll. */
  seed: number;
}

export interface ContactDialogueVm {
  factionId: string;
  empireName: string;
  empireColor: string;
  temperament: string;
  warlike: boolean;
  /* Their fleet strength compared with the player's. */
  strengthHint: 'Smaller' | 'Similar' | 'Larger';
  greeting: string;
  questions: { id: string; text: string; replies: { index: number; text: string }[] }[];
  giftTiers: { tier: number; credits: number; affordable: boolean }[];
}

export interface ContactResolution {
  outcome: ContactOutcome;
  closing: string;
  giftLine: string | null;
  summary: string;
  /* Flags of the chosen replies (campaign dialogue may use them). */
  flags: string[];
}

const SECONDS_BETWEEN_CHECKS = 1;

@Injectable({ providedIn: 'root' })
export class FirstContactService {
  private accumulator = 0;
  private readonly pending: string[] = [];

  constructor(
    private readonly sensors: StarMapSensorService,
    private readonly research: ResearchService,
    private readonly ships: ShipService,
    private readonly spaceBases: SpaceBaseService,
  ) {}

  /* Every load: the queue is re-derived from the world. */
  reset(): void {
    this.accumulator = 0;
    this.pending.length = 0;
  }

  /* The oldest empire the player has met and not yet answered. */
  get pendingPlayerContact(): string | null {
    return this.pending[0] ?? null;
  }

  /*
   * Detects new meetings. AI–AI meetings are resolved at once; meetings
   * with the player are queued. Returns map notices (AI–AI meetings
   * between two empires the player knows).
   */
  tick(deltaSeconds: number, world: ContactWorld): { notices: string[]; changed: boolean } {
    const result = { notices: [] as string[], changed: false };
    if (deltaSeconds <= 0) return result;
    this.accumulator += deltaSeconds;
    if (this.accumulator < SECONDS_BETWEEN_CHECKS) return result;
    this.accumulator = 0;

    const candidates = world.factions.filter((f) => f.team !== 0 && f.outlaw !== true);
    const unmet: [Faction, Faction][] = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        if (isTreatyPair(a, b) && !inContact(a, b)) unmet.push([a, b]);
      }
    }
    if (unmet.length === 0) return result;

    const sources = new Map(candidates.map((f) => [f.id, this.sourcesOf(f, world)]));
    const assets = new Map(candidates.map((f) => [f.id, this.assetsOf(f, world)]));
    const player = world.factions.find((f) => f.id === 'player');
    for (const [a, b] of unmet) {
      if (!this.senses(sources.get(a.id)!, assets.get(b.id)!) && !this.senses(sources.get(b.id)!, assets.get(a.id)!)) continue;
      if (a.id === 'player' || b.id === 'player') {
        const other = a.id === 'player' ? b : a;
        if (!this.pending.includes(other.id)) this.pending.push(other.id);
        continue;
      }
      const outcome = this.resolveAiContact(a, b, world);
      result.changed = true;
      if (player && inContact(player, a) && inContact(player, b)) {
        result.notices.push(`${a.name} and ${b.name} have met. ${outcome === 'war' ? 'They are at war.' : 'They are at peace.'}`);
      }
    }
    return result;
  }

  /* The dialogue of the oldest pending contact (the other empire asks). */
  buildDialogue(factionId: string, world: ContactWorld): ContactDialogueVm | null {
    const player = world.factions.find((f) => f.id === 'player');
    const asker = world.factions.find((f) => f.id === factionId);
    if (!player || !asker) return null;
    const temperament = temperamentOf(asker);
    const pool = contactPool(temperament);
    const set = chooseQuestions(asker, player, world.seed);
    const ratio = this.strength(asker.id, world.fleets) / Math.max(1, this.strength(player.id, world.fleets));
    const credits = player.currencies['credits'] ?? 0;
    return {
      factionId,
      empireName: asker.name,
      empireColor: asker.color,
      temperament,
      warlike: isWarlikeTemperament(temperament),
      strengthHint: ratio >= 1.25 ? 'Larger' : ratio <= 0.8 ? 'Smaller' : 'Similar',
      greeting: fillPlaceholders(pool.greeting, asker.name, player.name),
      questions: set.questions.map((question, qi) => ({
        id: question.id,
        text: fillPlaceholders(question.text, asker.name, player.name),
        replies: set.replyOrder[qi].map((index) => ({ index, text: fillPlaceholders(question.replies[index].text, asker.name, player.name) })),
      })),
      giftTiers: CONTACT_GIFT_TIERS.map((amount, tier) => ({ tier, credits: amount, affordable: amount <= credits })),
    };
  }

  /*
   * The player answered: `replies[i]` is the chosen reply index of question
   * i. Applies the gift, the treaty state and the opinions; removes the
   * contact from the queue. Null when the contact is no longer pending.
   */
  resolvePlayerContact(factionId: string, replies: number[], stance: ContactStance, giftTier: number, world: ContactWorld): ContactResolution | null {
    const index = this.pending.indexOf(factionId);
    const player = world.factions.find((f) => f.id === 'player');
    const asker = world.factions.find((f) => f.id === factionId);
    if (index < 0 || !player || !asker) return null;
    this.pending.splice(index, 1);
    if (inContact(player, asker)) return null;

    const temperament = temperamentOf(asker);
    const set = chooseQuestions(asker, player, world.seed);
    const tier = Math.max(0, Math.min(CONTACT_GIFT_TIERS.length - 1, Math.floor(giftTier)));
    const gift = CONTACT_GIFT_TIERS[tier];
    const paid = gift > 0 && transferResources(player, asker, { credits: gift });
    const chosen = set.questions.map((question, qi) => question.replies[replies[qi] ?? 1] ?? question.replies[1]);
    const result = evaluateContact({
      temperament,
      replyValues: chosen.map((reply) => reply.value),
      stance,
      giftTier: paid ? tier : 0,
      strengthRatio: this.strength(player.id, world.fleets) / Math.max(1, this.strength(asker.id, world.fleets)),
      territoriesClose: this.territoriesClose(asker, player, world),
      roll: seededUnit(world.seed, asker.id, player.id, 'contact'),
    });
    this.apply(asker, player, result.outcome, result.opinion);
    const closing = contactPool(temperament).closing;
    const line = result.outcome === 'war' ? closing.war : result.outcome === 'peace' ? closing.warm : closing.cold;
    const attitude = result.opinion >= 20 ? 'Cordial' : result.opinion > -20 ? 'Neutral' : 'Wary';
    return {
      outcome: result.outcome,
      closing: fillPlaceholders(line, asker.name, player.name),
      giftLine: paid ? (isWarlikeTemperament(temperament) ? GIFT_REACTIONS.warlike : GIFT_REACTIONS.peaceful) : null,
      summary: result.outcome === 'war' ? `War with ${asker.name}.` : `Peace with ${asker.name}. Their attitude: ${attitude}.`,
      flags: chosen.map((reply) => reply.flag).filter((flag): flag is string => !!flag),
    };
  }

  /* Headless games (simulations): the player's meetings resolve with a neutral answer. */
  autoResolvePlayerContacts(world: ContactWorld): void {
    while (this.pending.length > 0) {
      const id = this.pending[0];
      if (!this.resolvePlayerContact(id, [1, 1], 'cautious', 0, world)) this.pending.shift();
    }
  }

  private resolveAiContact(a: Faction, b: Faction, world: ContactWorld): ContactOutcome {
    // The first of the pair (faction order) asks; the other answers in character.
    const asker = a;
    const answerer = b;
    const set: ContactQuestionSet = chooseQuestions(asker, answerer, world.seed);
    const answererTemperament = temperamentOf(answerer);
    const result = evaluateContact({
      temperament: temperamentOf(asker),
      replyValues: set.questions.map((question) => question.replies[aiReplyIndex(question, answererTemperament)].value),
      stance: aiStance(answererTemperament),
      giftTier: 0,
      strengthRatio: this.strength(answerer.id, world.fleets) / Math.max(1, this.strength(asker.id, world.fleets)),
      territoriesClose: this.territoriesClose(asker, answerer, world),
      roll: seededUnit(world.seed, asker.id, answerer.id, 'contact'),
    });
    this.apply(asker, answerer, result.outcome, result.opinion);
    return result.outcome;
  }

  private apply(asker: Faction, met: Faction, outcome: ContactOutcome, opinion: number): void {
    makeContact(asker, met);
    if (outcome === 'war') startWar(asker, met, WAR_MIN_DURATION_SECONDS);
    for (const [holder, other] of [[asker, met], [met, asker]] as const) {
      const entry = holder.relations?.[other.id];
      if (entry) {
        entry.opinion = Math.max(-100, Math.min(100, Math.round(opinion)));
        if (outcome !== 'war') entry.peaceSeconds = 0;
      }
    }
  }

  private strength(factionId: string, fleets: Fleet[]): number {
    let total = 0;
    for (const fleet of fleets) {
      if (fleet.factionId === factionId && !fleet.destroyed) total += this.ships.calculateFleetStrength(fleet.ships);
    }
    return total;
  }

  private territoriesClose(a: Faction, b: Faction, world: ContactWorld): boolean {
    const own = (id: string) => world.starSystems.filter((s) => s.planetsTiles.some((p) => p.factionId === id));
    const mine = own(a.id);
    const theirs = own(b.id);
    return mine.some((s) => theirs.some((t) => Math.hypot(s.x - t.x, s.y - t.y) <= EnemyDiplomacyService.WAR_REACH));
  }

  private sourcesOf(faction: Faction, world: ContactWorld): { x: number; y: number; r: number }[] {
    const bonus = this.research.getSensorRangeBonus(faction);
    const sources: { x: number; y: number; r: number }[] = [];
    for (const system of world.starSystems) {
      if (system.planetsTiles.some((p) => p.factionId === faction.id)) {
        sources.push({ x: system.gridCol ?? Math.floor(system.x), y: system.gridRow ?? Math.floor(system.y), r: PLAYER_SYSTEM_SENSOR_RANGE + bonus });
      }
    }
    for (const fleet of world.fleets) {
      if (fleet.factionId === faction.id && !fleet.destroyed && !fleet.transit && fleet.ships.some((s) => !s.destroyed)) {
        sources.push({ x: fleet.x, y: fleet.y, r: this.sensors.getFleetSensorRange(fleet, faction) });
      }
    }
    return sources;
  }

  private assetsOf(faction: Faction, world: ContactWorld): { x: number; y: number }[] {
    const assets: { x: number; y: number }[] = [];
    for (const fleet of world.fleets) {
      if (fleet.factionId === faction.id && !fleet.destroyed && !fleet.transit && fleet.ships.some((s) => !s.destroyed)) assets.push({ x: fleet.x, y: fleet.y });
    }
    for (const system of world.starSystems) {
      if (system.planetsTiles.some((p) => p.factionId === faction.id)) assets.push({ x: system.x, y: system.y });
    }
    for (const base of this.spaceBases.bases) {
      if (base.factionId === faction.id) assets.push({ x: base.x, y: base.y });
    }
    return assets;
  }

  private senses(sources: { x: number; y: number; r: number }[], assets: { x: number; y: number }[]): boolean {
    return assets.some((asset) => sources.some((source) => this.sensors.isGalaxyCellSensed(Math.floor(asset.x), Math.floor(asset.y), source)));
  }
}
