/**
 * The scene's colours — now derived, not declared.
 *
 * This file used to hold fourteen hex codes and say that #116 would replace them. It has.
 * `@hh/ui` owns §9.2's thirteen roles in five palettes, `../palette.ts` maps them onto the
 * renderer's inks, and this re-export is all that is left — kept so that the two scene
 * consumers go on importing "the scene's colours" from one place rather than each reaching
 * into the palette module for a different part of it.
 */
export { useSceneColours } from '../palette.js';
