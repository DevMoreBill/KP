import { OutfitAir } from './outfit-air.js';
import { OutfitBase } from './outfit-base.js';
import { OutfitDoors } from './outfit-doors.js';
import { OutfitFire } from './outfit-fire.js';
import { OutfitFuel } from './outfit-fuel.js';
import { OutfitInside } from './outfit-inside.js';
import { OutfitShell } from './outfit-shell.js';

/**
 * Оснащение контейнера на 3D-виде (всё, кроме оборудования): свет, отопление, вентиляция, пожарная безопасность,
 * розетки, кабельный лоток, отсек топливного бака, снаружи — козырьки, прожекторы, таблички, знаки, логотип, маркировка
 * для подъёма. Места на стенах — без наложений (StWalls — внутри, O — снаружи); наклейки — описания (рисует StDecal).
 */
export class StOutfit extends OutfitBase {
  constructor(scene) {
    super(scene);
    this.inner = new OutfitInside(this);
    this.air = new OutfitAir(this);
    this.safety = new OutfitFire(this);
    this.tank = new OutfitFuel(this);
    this.entries = new OutfitDoors(this);
    this.shell = new OutfitShell(this);
  }

  build() {
    const { inner, air, safety, tank, entries, shell } = this;
    this.joints();
    inner.lights();
    inner.tray();
    inner.heaters();
    air.vents();
    air.exhausts();
    safety.fire();
    inner.sockets();
    tank.fuel();
    entries.doors();
    shell.arts();
    shell.lift();
    shell.brand();
    return this;
  }
}
