// a380/parts/index.mjs (S): the module registry, in build order (DESIGN §8.4). Owned by the scaffold.
import * as stage from "./stage.mjs";
import * as nose from "./nose.mjs";
import * as tail from "./tail.mjs";
import * as fuselage from "./fuselage.mjs";
import * as skin from "./skin.mjs";
import * as wings from "./wings.mjs";
import * as engines from "./engines.mjs";
import * as gear from "./gear.mjs";
import * as cabin from "./cabin.mjs";
import * as lights from "./lights.mjs";
import * as tug from "./tug.mjs"; // follow-up (interaction): the pushback tug, last so no earlier part index moves

export const MODULES = [stage, nose, tail, fuselage, skin, wings, engines, gear, cabin, lights, tug];
/** Module ids by owner (M1..M8), for --only=M3 and friends. */
export const OWNERS = { M1: ["stage"], M2: ["nose", "tail"], M3: ["wings"], M4: ["engines"], M5: ["gear"], M6: ["fuselage", "skin"], M7: ["cabin"], M8: ["lights"], I: ["tug"] };
