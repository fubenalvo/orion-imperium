import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContextMenuItem } from '../star-map.models';

@Component({
  selector: 'app-star-map-context-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-context-menu.component.html',
  styleUrl: './star-map-context-menu.component.scss',
})
export class StarMapContextMenuComponent {
  @Input() contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null = null;

  @Output() selectItem = new EventEmitter<ContextMenuItem>();
  @Output() close = new EventEmitter<void>();
}
