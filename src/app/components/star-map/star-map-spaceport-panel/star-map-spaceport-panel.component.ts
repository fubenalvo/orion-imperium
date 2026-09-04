import {
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanetTile, StarSystem } from '../../../components/star-map/star-map.models';

export interface ShipStockChoice {
  typeId: string;
  typeName: string;
  available: number;
}

export interface SpaceportPanelViewModel {
  system: StarSystem;
  planet: PlanetTile;
  factionId: string;
  available: ShipStockChoice[];
  selectedSystemId: string | null;
  selectedPlanetId: number | null;
  assemblySystems: { systemId: string; systemName: string; planets: { id: number; name: string }[] }[];
  errorMessage: string | null;
}

@Component({
  selector: 'app-star-map-spaceport-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-spaceport-panel.component.html',
  styleUrl: './star-map-spaceport-panel.component.scss',
})
export class StarMapSpaceportPanelComponent {
  @Input() vm: SpaceportPanelViewModel | null = null;
  @Input() fleetName = 'New Fleet';
  @Input() mode: 'create' | 'reinforce' = 'create';
  @Input() targetFleetId: number | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() openBuildMenu = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<{ fleetName: string; composition: { typeId: string; count: number }[]; systemId: string; planetId: number; fleetId: number | null }>();
  @Output() fleetNameChange = new EventEmitter<string>();

  selected: { [typeId: string]: number } = {};

  setFleetName(value: string): void {
    this.fleetName = value;
    this.fleetNameChange.emit(value);
  }

  inc(typeId: string, available: number): void {
    const next = (this.selected[typeId] ?? 0) + 1;
    this.selected[typeId] = Math.min(available, next);
  }

  dec(typeId: string): void {
    const next = (this.selected[typeId] ?? 0) - 1;
    this.selected[typeId] = Math.max(0, next);
  }

  count(typeId: string): number {
    return this.selected[typeId] ?? 0;
  }

  totalSelected(): number {
    return Object.values(this.selected).reduce((a, b) => a + b, 0);
  }

  canConfirm(): boolean {
    return this.totalSelected() > 0 && !!this.vm?.selectedSystemId && !!this.vm?.selectedPlanetId;
  }

  selectedSystem(systemId: string): void {
    if (this.vm) {
      this.vm.selectedSystemId = systemId;
      this.vm.selectedPlanetId = null;
    }
  }

  selectedPlanet(planetId: number): void {
    if (this.vm) {
      this.vm.selectedPlanetId = planetId;
    }
  }

  confirmClick(): void {
    if (!this.vm || !this.canConfirm()) {
      return;
    }
    const composition = Object.entries(this.selected)
      .filter(([, count]) => count > 0)
      .map(([typeId, count]) => ({ typeId, count }));
    this.confirm.emit({
      fleetName: this.fleetName || 'New Fleet',
      composition,
      systemId: this.vm.selectedSystemId!,
      planetId: this.vm.selectedPlanetId!,
      fleetId: this.targetFleetId,
    });
  }
}
