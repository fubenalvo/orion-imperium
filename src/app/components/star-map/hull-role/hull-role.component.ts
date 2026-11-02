import { Component, Input } from '@angular/core';
import { HULL_CLASS_INFO, HullClass, HullRoleText, armorReductionPercent, describeHullRole } from '../hull-class';

/*
 * Player-facing hull role: the hull class badge and what the class is good
 * and bad against (hull-class.ts). Every text comes from describeHullRole,
 * so the UI always matches the combat tables. Used by the production
 * dialog (ship cards and the selected-ship details) and the research tree.
 *
 * Modes:
 *  - compact: badge + "beats X · weak to Y" on one line;
 *  - full (default): badge, role summary, bonus lines and, when `stats`
 *    is set, the key combat stats of the ship type.
 */
@Component({
  selector: 'app-hull-role',
  standalone: true,
  templateUrl: './hull-role.component.html',
  styleUrl: './hull-role.component.scss',
})
export class HullRoleComponent {
  @Input({ required: true }) shipType!: {
    hullClass?: string;
    attack?: number;
    hitPoints?: number;
    shield?: number;
    defense?: number;
    range?: number;
    speed?: number;
    attackType?: string;
    shieldAura?: number;
  };
  @Input() compact = false;
  @Input() stats = false;

  get role(): HullRoleText {
    return describeHullRole(this.shipType);
  }

  classLabel(hullClass: HullClass): string {
    return HULL_CLASS_INFO[hullClass].label;
  }

  get strongAgainst(): HullClass {
    return HULL_CLASS_INFO[this.role.hullClass].strongAgainst;
  }

  get weakAgainst(): HullClass {
    return HULL_CLASS_INFO[this.role.hullClass].weakAgainst;
  }

  get armorPercent(): number {
    return armorReductionPercent(this.shipType.defense ?? 0);
  }
}
