import { OutfitAir } from './outfit-air.js';
import { OutfitBase } from './outfit-base.js';
import { OutfitDoors } from './outfit-doors.js';
import { OutfitFire } from './outfit-fire.js';
import { OutfitFuel } from './outfit-fuel.js';
import { OutfitInside } from './outfit-inside.js';
import { OutfitShell } from './outfit-shell.js';
import { PhotoTint } from './photo-tint.js';
import { StDecal } from './st-decal.js';
import { StOutfit } from './st-outfit.js';

export const VIEW = {
  OutfitAir,
  OutfitBase,
  OutfitDoors,
  OutfitFire,
  OutfitFuel,
  OutfitInside,
  OutfitShell,
  PhotoTint,
  StDecal,
  StOutfit,
};

// мост для файлов интерфейса, ещё не переведённых в ES-модули
Object.assign(globalThis, VIEW);
