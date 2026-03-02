import { Menu } from './scenes/Menu.js';
import { Start } from './scenes/Start.js';

const config = {
    type: Phaser.AUTO,
    title: 'Caida Venezolana',
    description: '',
    parent: 'game-container',
    width: 720,
    height: 1280,
    backgroundColor: '#000000',
    pixelArt: false,
    scene: [
        Menu,
        Start
    ],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
}

new Phaser.Game(config);
            