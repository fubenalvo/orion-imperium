import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink],
  selector: 'app-main-menu',
  styleUrl: './main-menu.scss',
  templateUrl: './main-menu.html',
})
export class MainMenu {
  constructor() {}
}
