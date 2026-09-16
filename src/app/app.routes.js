import { MainMenu } from './main-menu/main-menu';
import { StarMap } from './components/star-map/star-map';
import { BattleScreenComponent } from './components/battle-screen/battle-screen.component';
export const routes = [
    {
        path: '',
        component: MainMenu,
    },
    {
        path: 'star-map',
        component: StarMap,
    },
    {
        path: 'battle',
        component: BattleScreenComponent,
    },
];
