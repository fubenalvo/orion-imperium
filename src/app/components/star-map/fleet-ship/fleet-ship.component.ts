import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/*
 * Rotating ship glyph shared by the galaxy map and the system view fleet
 * markers: the hull artwork plus an engine trail attached to its rear.
 *
 * The trail is a child of the rotated element, so it always points away
 * from the nose whatever the heading — it is never screen-aligned. The
 * heading itself comes from FleetHeadingTracker (see fleet-heading.ts);
 * this component only renders it. Purely presentational: no pointer events,
 * so clicks fall through to the enclosing fleet button.
 */
@Component({
  selector: 'app-fleet-ship',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="ship" [class.ship--thrusting]="thrusting" [style.transform]="'rotate(' + heading + 'deg)'">
      <span class="ship__engine"></span>
      <img class="ship__hull" src="fleet.svg" alt="" draggable="false" />
    </span>
  `,
  styleUrl: './fleet-ship.component.scss',
})
export class FleetShipComponent {
  /* Screen-space heading in CSS rotate degrees (0 = nose right). */
  @Input() heading = 0;
  /* True while the fleet is under way; fades the engine trail in/out. */
  @Input() thrusting = false;
}
