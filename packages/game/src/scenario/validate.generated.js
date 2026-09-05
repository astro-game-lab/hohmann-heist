/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Generated from scenario-1.schema.json by tools/schema/generate.mjs.
 * Run `pnpm schema:write` after changing the schema; `pnpm schema:check` gates it in CI.
 */
"use strict";
export const validate = validate20;
export default validate20;
const schema31 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://astro-game-lab.github.io/hohmann-heist/schema/scenario-1.json","title":"Scenario","description":"A Hohmann Heist contract, version 1. Declarative data only: the loader interprets this and nothing else (FR-201). All quantities are SI and carry their unit in the field name.","type":"object","required":["id","version","act","index","title","briefKey","epoch","horizonSeconds","ship","objective","par"],"additionalProperties":false,"properties":{"$schema":{"type":"string","description":"Optional pointer back to this schema, so an editor can validate on save."},"id":{"type":"string","pattern":"^[a-z0-9]+(-[a-z0-9]+)*$","description":"Stable identifier, kebab-case. Appears in URLs and save data, so it never changes once shipped."},"version":{"type":"integer","const":1,"description":"Schema version. Required so that a future v2 is distinguishable from v1 rather than inferred from which fields happen to be present."},"act":{"type":"integer","minimum":1,"maximum":6},"index":{"type":"integer","minimum":1},"title":{"type":"string","minLength":1},"briefKey":{"$ref":"#/$defs/catalogueKey","description":"Message-catalogue key for the briefing text (D14, FR-910). Never literal prose: contract text is translated and reviewed separately from contract logic."},"clientKey":{"$ref":"#/$defs/catalogueKey","description":"Message-catalogue key for the client's name, shown in the briefing (§8.3.3). A key rather than a string for the same reason briefKey is one: \"withheld\" is prose. Omitted when the contract names no client."},"fee_kcr":{"type":"number","exclusiveMinimum":0,"description":"The contract's fee in kilocredits (§6.10). Credits do nothing but rank a career total; the fee is flavour with a number attached, which is why it is not a game rule and nothing evaluates it. Omitted when the contract pays nothing."},"epoch":{"type":"object","required":["scale","j2000Seconds"],"additionalProperties":false,"properties":{"scale":{"type":"string","const":"TAI","description":"Time scale. TAI only: UTC is not uniform and leap seconds make it wrong for propagation (§7.2)."},"j2000Seconds":{"type":"number","description":"Start epoch, TAI seconds past J2000."}}},"horizonSeconds":{"type":"number","exclusiveMinimum":0,"description":"Planning horizon: the deadline plus a margin (§6.3). Prediction is not drawn past it."},"ship":{"type":"object","required":["state","dvBudget_mps"],"additionalProperties":false,"properties":{"state":{"$ref":"#/$defs/stateSpec"},"dvBudget_mps":{"type":"number","minimum":0,"description":"Cap on the sum of burn magnitudes. A scalar tank, not propellant (DEP-02)."}}},"targets":{"type":"array","default":[],"items":{"$ref":"#/$defs/target"},"description":"Objects the ship can be asked to reach. Massless and non-maneuvering (DEP-11)."},"objective":{"$ref":"#/$defs/objective"},"constraints":{"type":"array","default":[],"items":{"$ref":"#/$defs/constraint"}},"par":{"$ref":"#/$defs/par"},"unlocks":{"type":"array","default":[],"items":{"type":"string","pattern":"^[a-z0-9]+(-[a-z0-9]+)*$"}},"assistsAllowed":{"type":"array","default":[],"uniqueItems":true,"items":{"$ref":"#/$defs/assist"}},"coachMarks":{"type":"array","default":[],"items":{"$ref":"#/$defs/catalogueKey"},"description":"Catalogue keys for contextual hints. At most three, and only in C01–C04 (FR-902)."}},"$defs":{"catalogueKey":{"type":"string","pattern":"^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$","description":"A message-catalogue key: dotted segments, lower camel. Resolved by @hh/ui, never rendered raw."},"stateSpec":{"type":"object","required":["kind","a_m","e","i_rad","raan_rad","argp_rad","nu_rad"],"additionalProperties":false,"description":"An initial state, as classical elements. Semi-major axis rather than semi-latus rectum because this is the author-facing boundary and `a` is what a contract designer reasons in; the loader converts.","properties":{"kind":{"type":"string","const":"elements"},"a_m":{"type":"number","exclusiveMinimum":0,"description":"Semi-major axis, metres."},"e":{"type":"number","minimum":0,"exclusiveMaximum":1,"description":"Eccentricity. Closed orbits only: an open initial orbit has an infinite semi-major axis and is not a contract."},"i_rad":{"type":"number","minimum":0,"maximum":3.141592653589794},"raan_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587},"argp_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587},"nu_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587}}},"orbitGoal":{"type":"object","required":["a_m","e","i_rad","raan_rad","argp_rad"],"additionalProperties":false,"description":"The orbit a `reach_orbit` objective asks for. No true anomaly: where on the orbit the ship is does not matter, only which orbit it is on.","properties":{"a_m":{"type":"number","exclusiveMinimum":0},"e":{"type":"number","minimum":0,"exclusiveMaximum":1},"i_rad":{"type":"number","minimum":0,"maximum":3.141592653589794},"raan_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587},"argp_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587}}},"target":{"type":"object","required":["id","label","state"],"additionalProperties":false,"properties":{"id":{"type":"string","minLength":1},"label":{"type":"string","minLength":1,"description":"Display name. A call sign rather than translated prose — it is the object's name, not a sentence about it."},"state":{"$ref":"#/$defs/stateSpec"}}},"objective":{"type":"object","discriminator":{"propertyName":"kind"},"oneOf":[{"type":"object","required":["kind","goal"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"reach_orbit"},"goal":{"$ref":"#/$defs/orbitGoal"},"tolerance":{"type":"object","required":["radius_m","angle_rad"],"additionalProperties":false,"description":"Optional override of DEP-13's default. May tighten it, never loosen it — the table states the loosest tolerance the game will ever apply.","properties":{"radius_m":{"type":"number","exclusiveMinimum":0},"angle_rad":{"type":"number","exclusiveMinimum":0}}}}},{"type":"object","required":["kind","targetId"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"intercept"},"targetId":{"type":"string","minLength":1},"maxRange_m":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-04's 1 000 m. May tighten it, never loosen it."}}},{"type":"object","required":["kind","targetId"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"rendezvous"},"targetId":{"type":"string","minLength":1},"maxRange_m":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-03's 100 m. May tighten it, never loosen it."},"maxRelSpeed_mps":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-03's 0.5 m/s. May tighten it, never loosen it."}}},{"type":"object","required":["kind","targetId"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"soft_rendezvous"},"targetId":{"type":"string","minLength":1},"maxRange_m":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-03's 100 m. May tighten it, never loosen it."},"maxRelSpeed_mps":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-03's 0.1 m/s soft limit. May tighten it, never loosen it."}}},{"type":"object","required":["kind","slotOffset_rad"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"station"},"slotOffset_rad":{"type":"number","minimum":-6.283185307179587,"maximum":6.283185307179587,"description":"Where the slot is, as a signed offset from the ship's longitude at the start of the plan. Positive is east. Relative rather than absolute because the sidereal angle at J2000 is not modelled (§7.4, DEP-14), and because §6.8 states contract 07's slot as '3.0 degrees east' of where the ship begins."},"maxOffset_rad":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-14's ±0.05°. May tighten it, never loosen it."},"maxDrift_radPerSec":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-14's 0.01°/day, in SI. May tighten it, never loosen it."}}}]},"constraint":{"type":"object","discriminator":{"propertyName":"kind"},"oneOf":[{"type":"object","required":["kind","min_m"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"altitude_floor"},"min_m":{"type":"number","minimum":0,"description":"Altitude above the reference radius. DEP-08's 100 km unless a contract says otherwise."}}},{"type":"object","required":["kind","seconds"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"deadline"},"seconds":{"type":"number","exclusiveMinimum":0,"description":"Cap on mission elapsed time."}}}]},"par":{"type":"object","required":["dv_mps","time_s","burns","derivation","referenceReplay"],"additionalProperties":false,"description":"The best known solution, not a proven optimum (DEP-12). §11.5: a par without a reproducible derivation is not mergeable.","properties":{"dv_mps":{"type":"number","minimum":0},"time_s":{"type":"number","exclusiveMinimum":0},"burns":{"type":"integer","minimum":0},"derivation":{"type":"string","minLength":20,"description":"How this par was found, in prose, naming the solver script. Reviewed by a human; the length floor only stops it being empty."},"referenceReplay":{"type":"string","minLength":1,"description":"A replay code that achieves the objective at this cost. Replayed and asserted by the content tests (§7.6 Tier 4, §13.4)."}}},"assist":{"type":"string","enum":["closest_approach","elements","snapping","constraints","targeting_computer","porkchop","coach_marks"]}}};
const schema32 = {"type":"string","pattern":"^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$","description":"A message-catalogue key: dotted segments, lower camel. Resolved by @hh/ui, never rendered raw."};
const schema34 = {"type":"object","required":["kind","a_m","e","i_rad","raan_rad","argp_rad","nu_rad"],"additionalProperties":false,"description":"An initial state, as classical elements. Semi-major axis rather than semi-latus rectum because this is the author-facing boundary and `a` is what a contract designer reasons in; the loader converts.","properties":{"kind":{"type":"string","const":"elements"},"a_m":{"type":"number","exclusiveMinimum":0,"description":"Semi-major axis, metres."},"e":{"type":"number","minimum":0,"exclusiveMaximum":1,"description":"Eccentricity. Closed orbits only: an open initial orbit has an infinite semi-major axis and is not a contract."},"i_rad":{"type":"number","minimum":0,"maximum":3.141592653589794},"raan_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587},"argp_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587},"nu_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587}}};
const schema39 = {"type":"object","discriminator":{"propertyName":"kind"},"oneOf":[{"type":"object","required":["kind","min_m"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"altitude_floor"},"min_m":{"type":"number","minimum":0,"description":"Altitude above the reference radius. DEP-08's 100 km unless a contract says otherwise."}}},{"type":"object","required":["kind","seconds"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"deadline"},"seconds":{"type":"number","exclusiveMinimum":0,"description":"Cap on mission elapsed time."}}}]};
const schema40 = {"type":"object","required":["dv_mps","time_s","burns","derivation","referenceReplay"],"additionalProperties":false,"description":"The best known solution, not a proven optimum (DEP-12). §11.5: a par without a reproducible derivation is not mergeable.","properties":{"dv_mps":{"type":"number","minimum":0},"time_s":{"type":"number","exclusiveMinimum":0},"burns":{"type":"integer","minimum":0},"derivation":{"type":"string","minLength":20,"description":"How this par was found, in prose, naming the solver script. Reviewed by a human; the length floor only stops it being empty."},"referenceReplay":{"type":"string","minLength":1,"description":"A replay code that achieves the objective at this cost. Replayed and asserted by the content tests (§7.6 Tier 4, §13.4)."}}};
const schema41 = {"type":"string","enum":["closest_approach","elements","snapping","constraints","targeting_computer","porkchop","coach_marks"]};
const func1 = Object.prototype.hasOwnProperty;
const func2 = require("ajv/dist/runtime/ucs2length").default;
const func0 = require("ajv/dist/runtime/equal").default;
const pattern4 = new RegExp("^[a-z0-9]+(-[a-z0-9]+)*$", "u");
const pattern5 = new RegExp("^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$", "u");
const schema35 = {"type":"object","required":["id","label","state"],"additionalProperties":false,"properties":{"id":{"type":"string","minLength":1},"label":{"type":"string","minLength":1,"description":"Display name. A call sign rather than translated prose — it is the object's name, not a sentence about it."},"state":{"$ref":"#/$defs/stateSpec"}}};

function validate21(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate21.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.label === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "label"},message:"must have required property '"+"label"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.state === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "id") || (key0 === "label")) || (key0 === "state"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.label !== undefined){
let data1 = data.label;
if(typeof data1 === "string"){
if(func2(data1) < 1){
const err6 = {instancePath:instancePath+"/label",schemaPath:"#/properties/label/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/label",schemaPath:"#/properties/label/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.state !== undefined){
let data2 = data.state;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.kind === undefined){
const err8 = {instancePath:instancePath+"/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data2.a_m === undefined){
const err9 = {instancePath:instancePath+"/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "a_m"},message:"must have required property '"+"a_m"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data2.e === undefined){
const err10 = {instancePath:instancePath+"/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "e"},message:"must have required property '"+"e"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data2.i_rad === undefined){
const err11 = {instancePath:instancePath+"/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "i_rad"},message:"must have required property '"+"i_rad"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data2.raan_rad === undefined){
const err12 = {instancePath:instancePath+"/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "raan_rad"},message:"must have required property '"+"raan_rad"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data2.argp_rad === undefined){
const err13 = {instancePath:instancePath+"/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "argp_rad"},message:"must have required property '"+"argp_rad"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data2.nu_rad === undefined){
const err14 = {instancePath:instancePath+"/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "nu_rad"},message:"must have required property '"+"nu_rad"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
for(const key1 in data2){
if(!(((((((key1 === "kind") || (key1 === "a_m")) || (key1 === "e")) || (key1 === "i_rad")) || (key1 === "raan_rad")) || (key1 === "argp_rad")) || (key1 === "nu_rad"))){
const err15 = {instancePath:instancePath+"/state",schemaPath:"#/$defs/stateSpec/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data2.kind !== undefined){
let data3 = data2.kind;
if(typeof data3 !== "string"){
const err16 = {instancePath:instancePath+"/state/kind",schemaPath:"#/$defs/stateSpec/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if("elements" !== data3){
const err17 = {instancePath:instancePath+"/state/kind",schemaPath:"#/$defs/stateSpec/properties/kind/const",keyword:"const",params:{allowedValue: "elements"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data2.a_m !== undefined){
let data4 = data2.a_m;
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 <= 0 || isNaN(data4)){
const err18 = {instancePath:instancePath+"/state/a_m",schemaPath:"#/$defs/stateSpec/properties/a_m/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/state/a_m",schemaPath:"#/$defs/stateSpec/properties/a_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data2.e !== undefined){
let data5 = data2.e;
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err20 = {instancePath:instancePath+"/state/e",schemaPath:"#/$defs/stateSpec/properties/e/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data5 >= 1 || isNaN(data5)){
const err21 = {instancePath:instancePath+"/state/e",schemaPath:"#/$defs/stateSpec/properties/e/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 1},message:"must be < 1"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/state/e",schemaPath:"#/$defs/stateSpec/properties/e/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data2.i_rad !== undefined){
let data6 = data2.i_rad;
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 3.141592653589794 || isNaN(data6)){
const err23 = {instancePath:instancePath+"/state/i_rad",schemaPath:"#/$defs/stateSpec/properties/i_rad/maximum",keyword:"maximum",params:{comparison: "<=", limit: 3.141592653589794},message:"must be <= 3.141592653589794"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err24 = {instancePath:instancePath+"/state/i_rad",schemaPath:"#/$defs/stateSpec/properties/i_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/state/i_rad",schemaPath:"#/$defs/stateSpec/properties/i_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data2.raan_rad !== undefined){
let data7 = data2.raan_rad;
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 < 0 || isNaN(data7)){
const err26 = {instancePath:instancePath+"/state/raan_rad",schemaPath:"#/$defs/stateSpec/properties/raan_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data7 >= 6.283185307179587 || isNaN(data7)){
const err27 = {instancePath:instancePath+"/state/raan_rad",schemaPath:"#/$defs/stateSpec/properties/raan_rad/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 6.283185307179587},message:"must be < 6.283185307179587"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/state/raan_rad",schemaPath:"#/$defs/stateSpec/properties/raan_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data2.argp_rad !== undefined){
let data8 = data2.argp_rad;
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 < 0 || isNaN(data8)){
const err29 = {instancePath:instancePath+"/state/argp_rad",schemaPath:"#/$defs/stateSpec/properties/argp_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data8 >= 6.283185307179587 || isNaN(data8)){
const err30 = {instancePath:instancePath+"/state/argp_rad",schemaPath:"#/$defs/stateSpec/properties/argp_rad/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 6.283185307179587},message:"must be < 6.283185307179587"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
else {
const err31 = {instancePath:instancePath+"/state/argp_rad",schemaPath:"#/$defs/stateSpec/properties/argp_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data2.nu_rad !== undefined){
let data9 = data2.nu_rad;
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 < 0 || isNaN(data9)){
const err32 = {instancePath:instancePath+"/state/nu_rad",schemaPath:"#/$defs/stateSpec/properties/nu_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data9 >= 6.283185307179587 || isNaN(data9)){
const err33 = {instancePath:instancePath+"/state/nu_rad",schemaPath:"#/$defs/stateSpec/properties/nu_rad/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 6.283185307179587},message:"must be < 6.283185307179587"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
else {
const err34 = {instancePath:instancePath+"/state/nu_rad",schemaPath:"#/$defs/stateSpec/properties/nu_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
}
else {
const err35 = {instancePath:instancePath+"/state",schemaPath:"#/$defs/stateSpec/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
else {
const err36 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
validate21.errors = vErrors;
return errors === 0;
}
validate21.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema37 = {"type":"object","discriminator":{"propertyName":"kind"},"oneOf":[{"type":"object","required":["kind","goal"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"reach_orbit"},"goal":{"$ref":"#/$defs/orbitGoal"},"tolerance":{"type":"object","required":["radius_m","angle_rad"],"additionalProperties":false,"description":"Optional override of DEP-13's default. May tighten it, never loosen it — the table states the loosest tolerance the game will ever apply.","properties":{"radius_m":{"type":"number","exclusiveMinimum":0},"angle_rad":{"type":"number","exclusiveMinimum":0}}}}},{"type":"object","required":["kind","targetId"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"intercept"},"targetId":{"type":"string","minLength":1},"maxRange_m":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-04's 1 000 m. May tighten it, never loosen it."}}},{"type":"object","required":["kind","targetId"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"rendezvous"},"targetId":{"type":"string","minLength":1},"maxRange_m":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-03's 100 m. May tighten it, never loosen it."},"maxRelSpeed_mps":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-03's 0.5 m/s. May tighten it, never loosen it."}}},{"type":"object","required":["kind","targetId"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"soft_rendezvous"},"targetId":{"type":"string","minLength":1},"maxRange_m":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-03's 100 m. May tighten it, never loosen it."},"maxRelSpeed_mps":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-03's 0.1 m/s soft limit. May tighten it, never loosen it."}}},{"type":"object","required":["kind","slotOffset_rad"],"additionalProperties":false,"properties":{"kind":{"type":"string","const":"station"},"slotOffset_rad":{"type":"number","minimum":-6.283185307179587,"maximum":6.283185307179587,"description":"Where the slot is, as a signed offset from the ship's longitude at the start of the plan. Positive is east. Relative rather than absolute because the sidereal angle at J2000 is not modelled (§7.4, DEP-14), and because §6.8 states contract 07's slot as '3.0 degrees east' of where the ship begins."},"maxOffset_rad":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-14's ±0.05°. May tighten it, never loosen it."},"maxDrift_radPerSec":{"type":"number","exclusiveMinimum":0,"description":"Optional override of DEP-14's 0.01°/day, in SI. May tighten it, never loosen it."}}}]};
const schema38 = {"type":"object","required":["a_m","e","i_rad","raan_rad","argp_rad"],"additionalProperties":false,"description":"The orbit a `reach_orbit` objective asks for. No true anomaly: where on the orbit the ship is does not matter, only which orbit it is on.","properties":{"a_m":{"type":"number","exclusiveMinimum":0},"e":{"type":"number","minimum":0,"exclusiveMaximum":1},"i_rad":{"type":"number","minimum":0,"maximum":3.141592653589794},"raan_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587},"argp_rad":{"type":"number","minimum":0,"exclusiveMaximum":6.283185307179587}}};

function validate23(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate23.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
const tag0 = data.kind;
if(typeof tag0 == "string"){
if(tag0 === "reach_orbit"){
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err0 = {instancePath,schemaPath:"#/oneOf/0/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.goal === undefined){
const err1 = {instancePath,schemaPath:"#/oneOf/0/required",keyword:"required",params:{missingProperty: "goal"},message:"must have required property '"+"goal"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "kind") || (key0 === "goal")) || (key0 === "tolerance"))){
const err2 = {instancePath,schemaPath:"#/oneOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.kind !== undefined){
let data0 = data.kind;
if(typeof data0 !== "string"){
const err3 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/0/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if("reach_orbit" !== data0){
const err4 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/0/properties/kind/const",keyword:"const",params:{allowedValue: "reach_orbit"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.goal !== undefined){
let data1 = data.goal;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.a_m === undefined){
const err5 = {instancePath:instancePath+"/goal",schemaPath:"#/$defs/orbitGoal/required",keyword:"required",params:{missingProperty: "a_m"},message:"must have required property '"+"a_m"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.e === undefined){
const err6 = {instancePath:instancePath+"/goal",schemaPath:"#/$defs/orbitGoal/required",keyword:"required",params:{missingProperty: "e"},message:"must have required property '"+"e"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.i_rad === undefined){
const err7 = {instancePath:instancePath+"/goal",schemaPath:"#/$defs/orbitGoal/required",keyword:"required",params:{missingProperty: "i_rad"},message:"must have required property '"+"i_rad"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.raan_rad === undefined){
const err8 = {instancePath:instancePath+"/goal",schemaPath:"#/$defs/orbitGoal/required",keyword:"required",params:{missingProperty: "raan_rad"},message:"must have required property '"+"raan_rad"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.argp_rad === undefined){
const err9 = {instancePath:instancePath+"/goal",schemaPath:"#/$defs/orbitGoal/required",keyword:"required",params:{missingProperty: "argp_rad"},message:"must have required property '"+"argp_rad"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
for(const key1 in data1){
if(!(((((key1 === "a_m") || (key1 === "e")) || (key1 === "i_rad")) || (key1 === "raan_rad")) || (key1 === "argp_rad"))){
const err10 = {instancePath:instancePath+"/goal",schemaPath:"#/$defs/orbitGoal/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data1.a_m !== undefined){
let data2 = data1.a_m;
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 <= 0 || isNaN(data2)){
const err11 = {instancePath:instancePath+"/goal/a_m",schemaPath:"#/$defs/orbitGoal/properties/a_m/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/goal/a_m",schemaPath:"#/$defs/orbitGoal/properties/a_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data1.e !== undefined){
let data3 = data1.e;
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err13 = {instancePath:instancePath+"/goal/e",schemaPath:"#/$defs/orbitGoal/properties/e/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data3 >= 1 || isNaN(data3)){
const err14 = {instancePath:instancePath+"/goal/e",schemaPath:"#/$defs/orbitGoal/properties/e/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 1},message:"must be < 1"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/goal/e",schemaPath:"#/$defs/orbitGoal/properties/e/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data1.i_rad !== undefined){
let data4 = data1.i_rad;
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 > 3.141592653589794 || isNaN(data4)){
const err16 = {instancePath:instancePath+"/goal/i_rad",schemaPath:"#/$defs/orbitGoal/properties/i_rad/maximum",keyword:"maximum",params:{comparison: "<=", limit: 3.141592653589794},message:"must be <= 3.141592653589794"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data4 < 0 || isNaN(data4)){
const err17 = {instancePath:instancePath+"/goal/i_rad",schemaPath:"#/$defs/orbitGoal/properties/i_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/goal/i_rad",schemaPath:"#/$defs/orbitGoal/properties/i_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data1.raan_rad !== undefined){
let data5 = data1.raan_rad;
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err19 = {instancePath:instancePath+"/goal/raan_rad",schemaPath:"#/$defs/orbitGoal/properties/raan_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data5 >= 6.283185307179587 || isNaN(data5)){
const err20 = {instancePath:instancePath+"/goal/raan_rad",schemaPath:"#/$defs/orbitGoal/properties/raan_rad/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 6.283185307179587},message:"must be < 6.283185307179587"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/goal/raan_rad",schemaPath:"#/$defs/orbitGoal/properties/raan_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data1.argp_rad !== undefined){
let data6 = data1.argp_rad;
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 < 0 || isNaN(data6)){
const err22 = {instancePath:instancePath+"/goal/argp_rad",schemaPath:"#/$defs/orbitGoal/properties/argp_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data6 >= 6.283185307179587 || isNaN(data6)){
const err23 = {instancePath:instancePath+"/goal/argp_rad",schemaPath:"#/$defs/orbitGoal/properties/argp_rad/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 6.283185307179587},message:"must be < 6.283185307179587"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/goal/argp_rad",schemaPath:"#/$defs/orbitGoal/properties/argp_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath:instancePath+"/goal",schemaPath:"#/$defs/orbitGoal/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.tolerance !== undefined){
let data7 = data.tolerance;
if(data7 && typeof data7 == "object" && !Array.isArray(data7)){
if(data7.radius_m === undefined){
const err26 = {instancePath:instancePath+"/tolerance",schemaPath:"#/oneOf/0/properties/tolerance/required",keyword:"required",params:{missingProperty: "radius_m"},message:"must have required property '"+"radius_m"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data7.angle_rad === undefined){
const err27 = {instancePath:instancePath+"/tolerance",schemaPath:"#/oneOf/0/properties/tolerance/required",keyword:"required",params:{missingProperty: "angle_rad"},message:"must have required property '"+"angle_rad"+"'"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
for(const key2 in data7){
if(!((key2 === "radius_m") || (key2 === "angle_rad"))){
const err28 = {instancePath:instancePath+"/tolerance",schemaPath:"#/oneOf/0/properties/tolerance/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data7.radius_m !== undefined){
let data8 = data7.radius_m;
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 <= 0 || isNaN(data8)){
const err29 = {instancePath:instancePath+"/tolerance/radius_m",schemaPath:"#/oneOf/0/properties/tolerance/properties/radius_m/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/tolerance/radius_m",schemaPath:"#/oneOf/0/properties/tolerance/properties/radius_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data7.angle_rad !== undefined){
let data9 = data7.angle_rad;
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 <= 0 || isNaN(data9)){
const err31 = {instancePath:instancePath+"/tolerance/angle_rad",schemaPath:"#/oneOf/0/properties/tolerance/properties/angle_rad/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
else {
const err32 = {instancePath:instancePath+"/tolerance/angle_rad",schemaPath:"#/oneOf/0/properties/tolerance/properties/angle_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
else {
const err33 = {instancePath:instancePath+"/tolerance",schemaPath:"#/oneOf/0/properties/tolerance/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
else {
const err34 = {instancePath,schemaPath:"#/oneOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
var props0 = true;
}
else if(tag0 === "intercept"){
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err35 = {instancePath,schemaPath:"#/oneOf/1/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data.targetId === undefined){
const err36 = {instancePath,schemaPath:"#/oneOf/1/required",keyword:"required",params:{missingProperty: "targetId"},message:"must have required property '"+"targetId"+"'"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
for(const key3 in data){
if(!(((key3 === "kind") || (key3 === "targetId")) || (key3 === "maxRange_m"))){
const err37 = {instancePath,schemaPath:"#/oneOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data.kind !== undefined){
let data10 = data.kind;
if(typeof data10 !== "string"){
const err38 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/1/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if("intercept" !== data10){
const err39 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/1/properties/kind/const",keyword:"const",params:{allowedValue: "intercept"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
if(data.targetId !== undefined){
let data11 = data.targetId;
if(typeof data11 === "string"){
if(func2(data11) < 1){
const err40 = {instancePath:instancePath+"/targetId",schemaPath:"#/oneOf/1/properties/targetId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
else {
const err41 = {instancePath:instancePath+"/targetId",schemaPath:"#/oneOf/1/properties/targetId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
if(data.maxRange_m !== undefined){
let data12 = data.maxRange_m;
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 <= 0 || isNaN(data12)){
const err42 = {instancePath:instancePath+"/maxRange_m",schemaPath:"#/oneOf/1/properties/maxRange_m/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
else {
const err43 = {instancePath:instancePath+"/maxRange_m",schemaPath:"#/oneOf/1/properties/maxRange_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
}
else {
const err44 = {instancePath,schemaPath:"#/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(props0 !== true){
props0 = true;
}
}
else if(tag0 === "rendezvous"){
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err45 = {instancePath,schemaPath:"#/oneOf/2/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(data.targetId === undefined){
const err46 = {instancePath,schemaPath:"#/oneOf/2/required",keyword:"required",params:{missingProperty: "targetId"},message:"must have required property '"+"targetId"+"'"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
for(const key4 in data){
if(!((((key4 === "kind") || (key4 === "targetId")) || (key4 === "maxRange_m")) || (key4 === "maxRelSpeed_mps"))){
const err47 = {instancePath,schemaPath:"#/oneOf/2/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
if(data.kind !== undefined){
let data13 = data.kind;
if(typeof data13 !== "string"){
const err48 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/2/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
if("rendezvous" !== data13){
const err49 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/2/properties/kind/const",keyword:"const",params:{allowedValue: "rendezvous"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data.targetId !== undefined){
let data14 = data.targetId;
if(typeof data14 === "string"){
if(func2(data14) < 1){
const err50 = {instancePath:instancePath+"/targetId",schemaPath:"#/oneOf/2/properties/targetId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
else {
const err51 = {instancePath:instancePath+"/targetId",schemaPath:"#/oneOf/2/properties/targetId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data.maxRange_m !== undefined){
let data15 = data.maxRange_m;
if((typeof data15 == "number") && (isFinite(data15))){
if(data15 <= 0 || isNaN(data15)){
const err52 = {instancePath:instancePath+"/maxRange_m",schemaPath:"#/oneOf/2/properties/maxRange_m/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
else {
const err53 = {instancePath:instancePath+"/maxRange_m",schemaPath:"#/oneOf/2/properties/maxRange_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data.maxRelSpeed_mps !== undefined){
let data16 = data.maxRelSpeed_mps;
if((typeof data16 == "number") && (isFinite(data16))){
if(data16 <= 0 || isNaN(data16)){
const err54 = {instancePath:instancePath+"/maxRelSpeed_mps",schemaPath:"#/oneOf/2/properties/maxRelSpeed_mps/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
else {
const err55 = {instancePath:instancePath+"/maxRelSpeed_mps",schemaPath:"#/oneOf/2/properties/maxRelSpeed_mps/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
}
else {
const err56 = {instancePath,schemaPath:"#/oneOf/2/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
if(props0 !== true){
props0 = true;
}
}
else if(tag0 === "soft_rendezvous"){
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err57 = {instancePath,schemaPath:"#/oneOf/3/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
if(data.targetId === undefined){
const err58 = {instancePath,schemaPath:"#/oneOf/3/required",keyword:"required",params:{missingProperty: "targetId"},message:"must have required property '"+"targetId"+"'"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
for(const key5 in data){
if(!((((key5 === "kind") || (key5 === "targetId")) || (key5 === "maxRange_m")) || (key5 === "maxRelSpeed_mps"))){
const err59 = {instancePath,schemaPath:"#/oneOf/3/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
}
if(data.kind !== undefined){
let data17 = data.kind;
if(typeof data17 !== "string"){
const err60 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/3/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
if("soft_rendezvous" !== data17){
const err61 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/3/properties/kind/const",keyword:"const",params:{allowedValue: "soft_rendezvous"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
}
if(data.targetId !== undefined){
let data18 = data.targetId;
if(typeof data18 === "string"){
if(func2(data18) < 1){
const err62 = {instancePath:instancePath+"/targetId",schemaPath:"#/oneOf/3/properties/targetId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
}
else {
const err63 = {instancePath:instancePath+"/targetId",schemaPath:"#/oneOf/3/properties/targetId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
if(data.maxRange_m !== undefined){
let data19 = data.maxRange_m;
if((typeof data19 == "number") && (isFinite(data19))){
if(data19 <= 0 || isNaN(data19)){
const err64 = {instancePath:instancePath+"/maxRange_m",schemaPath:"#/oneOf/3/properties/maxRange_m/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
else {
const err65 = {instancePath:instancePath+"/maxRange_m",schemaPath:"#/oneOf/3/properties/maxRange_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
}
if(data.maxRelSpeed_mps !== undefined){
let data20 = data.maxRelSpeed_mps;
if((typeof data20 == "number") && (isFinite(data20))){
if(data20 <= 0 || isNaN(data20)){
const err66 = {instancePath:instancePath+"/maxRelSpeed_mps",schemaPath:"#/oneOf/3/properties/maxRelSpeed_mps/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
else {
const err67 = {instancePath:instancePath+"/maxRelSpeed_mps",schemaPath:"#/oneOf/3/properties/maxRelSpeed_mps/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
}
else {
const err68 = {instancePath,schemaPath:"#/oneOf/3/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
if(props0 !== true){
props0 = true;
}
}
else if(tag0 === "station"){
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err69 = {instancePath,schemaPath:"#/oneOf/4/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
if(data.slotOffset_rad === undefined){
const err70 = {instancePath,schemaPath:"#/oneOf/4/required",keyword:"required",params:{missingProperty: "slotOffset_rad"},message:"must have required property '"+"slotOffset_rad"+"'"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
for(const key6 in data){
if(!((((key6 === "kind") || (key6 === "slotOffset_rad")) || (key6 === "maxOffset_rad")) || (key6 === "maxDrift_radPerSec"))){
const err71 = {instancePath,schemaPath:"#/oneOf/4/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key6},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
}
if(data.kind !== undefined){
let data21 = data.kind;
if(typeof data21 !== "string"){
const err72 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/4/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
if("station" !== data21){
const err73 = {instancePath:instancePath+"/kind",schemaPath:"#/oneOf/4/properties/kind/const",keyword:"const",params:{allowedValue: "station"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
}
if(data.slotOffset_rad !== undefined){
let data22 = data.slotOffset_rad;
if((typeof data22 == "number") && (isFinite(data22))){
if(data22 > 6.283185307179587 || isNaN(data22)){
const err74 = {instancePath:instancePath+"/slotOffset_rad",schemaPath:"#/oneOf/4/properties/slotOffset_rad/maximum",keyword:"maximum",params:{comparison: "<=", limit: 6.283185307179587},message:"must be <= 6.283185307179587"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
if(data22 < -6.283185307179587 || isNaN(data22)){
const err75 = {instancePath:instancePath+"/slotOffset_rad",schemaPath:"#/oneOf/4/properties/slotOffset_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: -6.283185307179587},message:"must be >= -6.283185307179587"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
}
else {
const err76 = {instancePath:instancePath+"/slotOffset_rad",schemaPath:"#/oneOf/4/properties/slotOffset_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
}
if(data.maxOffset_rad !== undefined){
let data23 = data.maxOffset_rad;
if((typeof data23 == "number") && (isFinite(data23))){
if(data23 <= 0 || isNaN(data23)){
const err77 = {instancePath:instancePath+"/maxOffset_rad",schemaPath:"#/oneOf/4/properties/maxOffset_rad/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
}
else {
const err78 = {instancePath:instancePath+"/maxOffset_rad",schemaPath:"#/oneOf/4/properties/maxOffset_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
}
if(data.maxDrift_radPerSec !== undefined){
let data24 = data.maxDrift_radPerSec;
if((typeof data24 == "number") && (isFinite(data24))){
if(data24 <= 0 || isNaN(data24)){
const err79 = {instancePath:instancePath+"/maxDrift_radPerSec",schemaPath:"#/oneOf/4/properties/maxDrift_radPerSec/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
else {
const err80 = {instancePath:instancePath+"/maxDrift_radPerSec",schemaPath:"#/oneOf/4/properties/maxDrift_radPerSec/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
}
}
else {
const err81 = {instancePath,schemaPath:"#/oneOf/4/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
if(props0 !== true){
props0 = true;
}
}
else {
const err82 = {instancePath,schemaPath:"#/discriminator",keyword:"discriminator",params:{error: "mapping", tag: "kind", tagValue: tag0},message:"value of tag \"kind\" must be in oneOf"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
}
else {
const err83 = {instancePath,schemaPath:"#/discriminator",keyword:"discriminator",params:{error: "tag", tag: "kind", tagValue: tag0},message:"tag \"kind\" must be string"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
}
else {
const err84 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
validate23.errors = vErrors;
evaluated0.props = props0;
return errors === 0;
}
validate23.evaluated = {"dynamicProps":true,"dynamicItems":false};


function validate20(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://astro-game-lab.github.io/hohmann-heist/schema/scenario-1.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate20.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.version === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.act === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "act"},message:"must have required property '"+"act"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.index === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "index"},message:"must have required property '"+"index"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.title === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.briefKey === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "briefKey"},message:"must have required property '"+"briefKey"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.epoch === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "epoch"},message:"must have required property '"+"epoch"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.horizonSeconds === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "horizonSeconds"},message:"must have required property '"+"horizonSeconds"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.ship === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ship"},message:"must have required property '"+"ship"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.objective === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "objective"},message:"must have required property '"+"objective"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.par === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "par"},message:"must have required property '"+"par"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
for(const key0 in data){
if(!(func1.call(schema31.properties, key0))){
const err11 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.$schema !== undefined){
if(typeof data.$schema !== "string"){
const err12 = {instancePath:instancePath+"/$schema",schemaPath:"#/properties/%24schema/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.id !== undefined){
let data1 = data.id;
if(typeof data1 === "string"){
if(!pattern4.test(data1)){
const err13 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/pattern",keyword:"pattern",params:{pattern: "^[a-z0-9]+(-[a-z0-9]+)*$"},message:"must match pattern \""+"^[a-z0-9]+(-[a-z0-9]+)*$"+"\""};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.version !== undefined){
let data2 = data.version;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err15 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(1 !== data2){
const err16 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.act !== undefined){
let data3 = data.act;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err17 = {instancePath:instancePath+"/act",schemaPath:"#/properties/act/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 > 6 || isNaN(data3)){
const err18 = {instancePath:instancePath+"/act",schemaPath:"#/properties/act/maximum",keyword:"maximum",params:{comparison: "<=", limit: 6},message:"must be <= 6"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data3 < 1 || isNaN(data3)){
const err19 = {instancePath:instancePath+"/act",schemaPath:"#/properties/act/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
if(data.index !== undefined){
let data4 = data.index;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err20 = {instancePath:instancePath+"/index",schemaPath:"#/properties/index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 1 || isNaN(data4)){
const err21 = {instancePath:instancePath+"/index",schemaPath:"#/properties/index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
if(data.title !== undefined){
let data5 = data.title;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err22 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.briefKey !== undefined){
let data6 = data.briefKey;
if(typeof data6 === "string"){
if(!pattern5.test(data6)){
const err24 = {instancePath:instancePath+"/briefKey",schemaPath:"#/$defs/catalogueKey/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$"},message:"must match pattern \""+"^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$"+"\""};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/briefKey",schemaPath:"#/$defs/catalogueKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.clientKey !== undefined){
let data7 = data.clientKey;
if(typeof data7 === "string"){
if(!pattern5.test(data7)){
const err26 = {instancePath:instancePath+"/clientKey",schemaPath:"#/$defs/catalogueKey/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$"},message:"must match pattern \""+"^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$"+"\""};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
else {
const err27 = {instancePath:instancePath+"/clientKey",schemaPath:"#/$defs/catalogueKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data.fee_kcr !== undefined){
let data8 = data.fee_kcr;
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 <= 0 || isNaN(data8)){
const err28 = {instancePath:instancePath+"/fee_kcr",schemaPath:"#/properties/fee_kcr/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
else {
const err29 = {instancePath:instancePath+"/fee_kcr",schemaPath:"#/properties/fee_kcr/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.epoch !== undefined){
let data9 = data.epoch;
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
if(data9.scale === undefined){
const err30 = {instancePath:instancePath+"/epoch",schemaPath:"#/properties/epoch/required",keyword:"required",params:{missingProperty: "scale"},message:"must have required property '"+"scale"+"'"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(data9.j2000Seconds === undefined){
const err31 = {instancePath:instancePath+"/epoch",schemaPath:"#/properties/epoch/required",keyword:"required",params:{missingProperty: "j2000Seconds"},message:"must have required property '"+"j2000Seconds"+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
for(const key1 in data9){
if(!((key1 === "scale") || (key1 === "j2000Seconds"))){
const err32 = {instancePath:instancePath+"/epoch",schemaPath:"#/properties/epoch/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data9.scale !== undefined){
let data10 = data9.scale;
if(typeof data10 !== "string"){
const err33 = {instancePath:instancePath+"/epoch/scale",schemaPath:"#/properties/epoch/properties/scale/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if("TAI" !== data10){
const err34 = {instancePath:instancePath+"/epoch/scale",schemaPath:"#/properties/epoch/properties/scale/const",keyword:"const",params:{allowedValue: "TAI"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data9.j2000Seconds !== undefined){
let data11 = data9.j2000Seconds;
if(!((typeof data11 == "number") && (isFinite(data11)))){
const err35 = {instancePath:instancePath+"/epoch/j2000Seconds",schemaPath:"#/properties/epoch/properties/j2000Seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
else {
const err36 = {instancePath:instancePath+"/epoch",schemaPath:"#/properties/epoch/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data.horizonSeconds !== undefined){
let data12 = data.horizonSeconds;
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 <= 0 || isNaN(data12)){
const err37 = {instancePath:instancePath+"/horizonSeconds",schemaPath:"#/properties/horizonSeconds/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
else {
const err38 = {instancePath:instancePath+"/horizonSeconds",schemaPath:"#/properties/horizonSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data.ship !== undefined){
let data13 = data.ship;
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
if(data13.state === undefined){
const err39 = {instancePath:instancePath+"/ship",schemaPath:"#/properties/ship/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data13.dvBudget_mps === undefined){
const err40 = {instancePath:instancePath+"/ship",schemaPath:"#/properties/ship/required",keyword:"required",params:{missingProperty: "dvBudget_mps"},message:"must have required property '"+"dvBudget_mps"+"'"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
for(const key2 in data13){
if(!((key2 === "state") || (key2 === "dvBudget_mps"))){
const err41 = {instancePath:instancePath+"/ship",schemaPath:"#/properties/ship/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
if(data13.state !== undefined){
let data14 = data13.state;
if(data14 && typeof data14 == "object" && !Array.isArray(data14)){
if(data14.kind === undefined){
const err42 = {instancePath:instancePath+"/ship/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(data14.a_m === undefined){
const err43 = {instancePath:instancePath+"/ship/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "a_m"},message:"must have required property '"+"a_m"+"'"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(data14.e === undefined){
const err44 = {instancePath:instancePath+"/ship/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "e"},message:"must have required property '"+"e"+"'"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(data14.i_rad === undefined){
const err45 = {instancePath:instancePath+"/ship/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "i_rad"},message:"must have required property '"+"i_rad"+"'"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if(data14.raan_rad === undefined){
const err46 = {instancePath:instancePath+"/ship/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "raan_rad"},message:"must have required property '"+"raan_rad"+"'"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(data14.argp_rad === undefined){
const err47 = {instancePath:instancePath+"/ship/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "argp_rad"},message:"must have required property '"+"argp_rad"+"'"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if(data14.nu_rad === undefined){
const err48 = {instancePath:instancePath+"/ship/state",schemaPath:"#/$defs/stateSpec/required",keyword:"required",params:{missingProperty: "nu_rad"},message:"must have required property '"+"nu_rad"+"'"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
for(const key3 in data14){
if(!(((((((key3 === "kind") || (key3 === "a_m")) || (key3 === "e")) || (key3 === "i_rad")) || (key3 === "raan_rad")) || (key3 === "argp_rad")) || (key3 === "nu_rad"))){
const err49 = {instancePath:instancePath+"/ship/state",schemaPath:"#/$defs/stateSpec/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data14.kind !== undefined){
let data15 = data14.kind;
if(typeof data15 !== "string"){
const err50 = {instancePath:instancePath+"/ship/state/kind",schemaPath:"#/$defs/stateSpec/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
if("elements" !== data15){
const err51 = {instancePath:instancePath+"/ship/state/kind",schemaPath:"#/$defs/stateSpec/properties/kind/const",keyword:"const",params:{allowedValue: "elements"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data14.a_m !== undefined){
let data16 = data14.a_m;
if((typeof data16 == "number") && (isFinite(data16))){
if(data16 <= 0 || isNaN(data16)){
const err52 = {instancePath:instancePath+"/ship/state/a_m",schemaPath:"#/$defs/stateSpec/properties/a_m/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
else {
const err53 = {instancePath:instancePath+"/ship/state/a_m",schemaPath:"#/$defs/stateSpec/properties/a_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data14.e !== undefined){
let data17 = data14.e;
if((typeof data17 == "number") && (isFinite(data17))){
if(data17 < 0 || isNaN(data17)){
const err54 = {instancePath:instancePath+"/ship/state/e",schemaPath:"#/$defs/stateSpec/properties/e/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if(data17 >= 1 || isNaN(data17)){
const err55 = {instancePath:instancePath+"/ship/state/e",schemaPath:"#/$defs/stateSpec/properties/e/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 1},message:"must be < 1"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
else {
const err56 = {instancePath:instancePath+"/ship/state/e",schemaPath:"#/$defs/stateSpec/properties/e/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
if(data14.i_rad !== undefined){
let data18 = data14.i_rad;
if((typeof data18 == "number") && (isFinite(data18))){
if(data18 > 3.141592653589794 || isNaN(data18)){
const err57 = {instancePath:instancePath+"/ship/state/i_rad",schemaPath:"#/$defs/stateSpec/properties/i_rad/maximum",keyword:"maximum",params:{comparison: "<=", limit: 3.141592653589794},message:"must be <= 3.141592653589794"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
if(data18 < 0 || isNaN(data18)){
const err58 = {instancePath:instancePath+"/ship/state/i_rad",schemaPath:"#/$defs/stateSpec/properties/i_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
else {
const err59 = {instancePath:instancePath+"/ship/state/i_rad",schemaPath:"#/$defs/stateSpec/properties/i_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
}
if(data14.raan_rad !== undefined){
let data19 = data14.raan_rad;
if((typeof data19 == "number") && (isFinite(data19))){
if(data19 < 0 || isNaN(data19)){
const err60 = {instancePath:instancePath+"/ship/state/raan_rad",schemaPath:"#/$defs/stateSpec/properties/raan_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
if(data19 >= 6.283185307179587 || isNaN(data19)){
const err61 = {instancePath:instancePath+"/ship/state/raan_rad",schemaPath:"#/$defs/stateSpec/properties/raan_rad/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 6.283185307179587},message:"must be < 6.283185307179587"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
}
else {
const err62 = {instancePath:instancePath+"/ship/state/raan_rad",schemaPath:"#/$defs/stateSpec/properties/raan_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
}
if(data14.argp_rad !== undefined){
let data20 = data14.argp_rad;
if((typeof data20 == "number") && (isFinite(data20))){
if(data20 < 0 || isNaN(data20)){
const err63 = {instancePath:instancePath+"/ship/state/argp_rad",schemaPath:"#/$defs/stateSpec/properties/argp_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
if(data20 >= 6.283185307179587 || isNaN(data20)){
const err64 = {instancePath:instancePath+"/ship/state/argp_rad",schemaPath:"#/$defs/stateSpec/properties/argp_rad/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 6.283185307179587},message:"must be < 6.283185307179587"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
else {
const err65 = {instancePath:instancePath+"/ship/state/argp_rad",schemaPath:"#/$defs/stateSpec/properties/argp_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
}
if(data14.nu_rad !== undefined){
let data21 = data14.nu_rad;
if((typeof data21 == "number") && (isFinite(data21))){
if(data21 < 0 || isNaN(data21)){
const err66 = {instancePath:instancePath+"/ship/state/nu_rad",schemaPath:"#/$defs/stateSpec/properties/nu_rad/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
if(data21 >= 6.283185307179587 || isNaN(data21)){
const err67 = {instancePath:instancePath+"/ship/state/nu_rad",schemaPath:"#/$defs/stateSpec/properties/nu_rad/exclusiveMaximum",keyword:"exclusiveMaximum",params:{comparison: "<", limit: 6.283185307179587},message:"must be < 6.283185307179587"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
else {
const err68 = {instancePath:instancePath+"/ship/state/nu_rad",schemaPath:"#/$defs/stateSpec/properties/nu_rad/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
}
}
else {
const err69 = {instancePath:instancePath+"/ship/state",schemaPath:"#/$defs/stateSpec/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
}
if(data13.dvBudget_mps !== undefined){
let data22 = data13.dvBudget_mps;
if((typeof data22 == "number") && (isFinite(data22))){
if(data22 < 0 || isNaN(data22)){
const err70 = {instancePath:instancePath+"/ship/dvBudget_mps",schemaPath:"#/properties/ship/properties/dvBudget_mps/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
}
else {
const err71 = {instancePath:instancePath+"/ship/dvBudget_mps",schemaPath:"#/properties/ship/properties/dvBudget_mps/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
}
}
else {
const err72 = {instancePath:instancePath+"/ship",schemaPath:"#/properties/ship/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
}
if(data.targets !== undefined){
let data23 = data.targets;
if(Array.isArray(data23)){
const len0 = data23.length;
for(let i0=0; i0<len0; i0++){
if(!(validate21(data23[i0], {instancePath:instancePath+"/targets/" + i0,parentData:data23,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
errors = vErrors.length;
}
}
}
else {
const err73 = {instancePath:instancePath+"/targets",schemaPath:"#/properties/targets/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
}
if(data.objective !== undefined){
if(!(validate23(data.objective, {instancePath:instancePath+"/objective",parentData:data,parentDataProperty:"objective",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate23.errors : vErrors.concat(validate23.errors);
errors = vErrors.length;
}
}
if(data.constraints !== undefined){
let data26 = data.constraints;
if(Array.isArray(data26)){
const len1 = data26.length;
for(let i1=0; i1<len1; i1++){
let data27 = data26[i1];
if(data27 && typeof data27 == "object" && !Array.isArray(data27)){
const tag0 = data27.kind;
if(typeof tag0 == "string"){
if(tag0 === "altitude_floor"){
if(data27 && typeof data27 == "object" && !Array.isArray(data27)){
if(data27.kind === undefined){
const err74 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/oneOf/0/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
if(data27.min_m === undefined){
const err75 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/oneOf/0/required",keyword:"required",params:{missingProperty: "min_m"},message:"must have required property '"+"min_m"+"'"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
for(const key4 in data27){
if(!((key4 === "kind") || (key4 === "min_m"))){
const err76 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/oneOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
}
if(data27.kind !== undefined){
let data28 = data27.kind;
if(typeof data28 !== "string"){
const err77 = {instancePath:instancePath+"/constraints/" + i1+"/kind",schemaPath:"#/$defs/constraint/oneOf/0/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
if("altitude_floor" !== data28){
const err78 = {instancePath:instancePath+"/constraints/" + i1+"/kind",schemaPath:"#/$defs/constraint/oneOf/0/properties/kind/const",keyword:"const",params:{allowedValue: "altitude_floor"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
}
if(data27.min_m !== undefined){
let data29 = data27.min_m;
if((typeof data29 == "number") && (isFinite(data29))){
if(data29 < 0 || isNaN(data29)){
const err79 = {instancePath:instancePath+"/constraints/" + i1+"/min_m",schemaPath:"#/$defs/constraint/oneOf/0/properties/min_m/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
else {
const err80 = {instancePath:instancePath+"/constraints/" + i1+"/min_m",schemaPath:"#/$defs/constraint/oneOf/0/properties/min_m/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
}
}
else {
const err81 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/oneOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
var props1 = true;
}
else if(tag0 === "deadline"){
if(data27 && typeof data27 == "object" && !Array.isArray(data27)){
if(data27.kind === undefined){
const err82 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/oneOf/1/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
if(data27.seconds === undefined){
const err83 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/oneOf/1/required",keyword:"required",params:{missingProperty: "seconds"},message:"must have required property '"+"seconds"+"'"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
for(const key5 in data27){
if(!((key5 === "kind") || (key5 === "seconds"))){
const err84 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/oneOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
}
if(data27.kind !== undefined){
let data30 = data27.kind;
if(typeof data30 !== "string"){
const err85 = {instancePath:instancePath+"/constraints/" + i1+"/kind",schemaPath:"#/$defs/constraint/oneOf/1/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
if("deadline" !== data30){
const err86 = {instancePath:instancePath+"/constraints/" + i1+"/kind",schemaPath:"#/$defs/constraint/oneOf/1/properties/kind/const",keyword:"const",params:{allowedValue: "deadline"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
}
if(data27.seconds !== undefined){
let data31 = data27.seconds;
if((typeof data31 == "number") && (isFinite(data31))){
if(data31 <= 0 || isNaN(data31)){
const err87 = {instancePath:instancePath+"/constraints/" + i1+"/seconds",schemaPath:"#/$defs/constraint/oneOf/1/properties/seconds/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
}
else {
const err88 = {instancePath:instancePath+"/constraints/" + i1+"/seconds",schemaPath:"#/$defs/constraint/oneOf/1/properties/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
}
}
else {
const err89 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
if(props1 !== true){
props1 = true;
}
}
else {
const err90 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/discriminator",keyword:"discriminator",params:{error: "mapping", tag: "kind", tagValue: tag0},message:"value of tag \"kind\" must be in oneOf"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
}
else {
const err91 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/discriminator",keyword:"discriminator",params:{error: "tag", tag: "kind", tagValue: tag0},message:"tag \"kind\" must be string"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
}
else {
const err92 = {instancePath:instancePath+"/constraints/" + i1,schemaPath:"#/$defs/constraint/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
}
}
else {
const err93 = {instancePath:instancePath+"/constraints",schemaPath:"#/properties/constraints/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
}
if(data.par !== undefined){
let data32 = data.par;
if(data32 && typeof data32 == "object" && !Array.isArray(data32)){
if(data32.dv_mps === undefined){
const err94 = {instancePath:instancePath+"/par",schemaPath:"#/$defs/par/required",keyword:"required",params:{missingProperty: "dv_mps"},message:"must have required property '"+"dv_mps"+"'"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
if(data32.time_s === undefined){
const err95 = {instancePath:instancePath+"/par",schemaPath:"#/$defs/par/required",keyword:"required",params:{missingProperty: "time_s"},message:"must have required property '"+"time_s"+"'"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
if(data32.burns === undefined){
const err96 = {instancePath:instancePath+"/par",schemaPath:"#/$defs/par/required",keyword:"required",params:{missingProperty: "burns"},message:"must have required property '"+"burns"+"'"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
if(data32.derivation === undefined){
const err97 = {instancePath:instancePath+"/par",schemaPath:"#/$defs/par/required",keyword:"required",params:{missingProperty: "derivation"},message:"must have required property '"+"derivation"+"'"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
if(data32.referenceReplay === undefined){
const err98 = {instancePath:instancePath+"/par",schemaPath:"#/$defs/par/required",keyword:"required",params:{missingProperty: "referenceReplay"},message:"must have required property '"+"referenceReplay"+"'"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
for(const key6 in data32){
if(!(((((key6 === "dv_mps") || (key6 === "time_s")) || (key6 === "burns")) || (key6 === "derivation")) || (key6 === "referenceReplay"))){
const err99 = {instancePath:instancePath+"/par",schemaPath:"#/$defs/par/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key6},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
}
if(data32.dv_mps !== undefined){
let data33 = data32.dv_mps;
if((typeof data33 == "number") && (isFinite(data33))){
if(data33 < 0 || isNaN(data33)){
const err100 = {instancePath:instancePath+"/par/dv_mps",schemaPath:"#/$defs/par/properties/dv_mps/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
}
else {
const err101 = {instancePath:instancePath+"/par/dv_mps",schemaPath:"#/$defs/par/properties/dv_mps/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
}
if(data32.time_s !== undefined){
let data34 = data32.time_s;
if((typeof data34 == "number") && (isFinite(data34))){
if(data34 <= 0 || isNaN(data34)){
const err102 = {instancePath:instancePath+"/par/time_s",schemaPath:"#/$defs/par/properties/time_s/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
}
else {
const err103 = {instancePath:instancePath+"/par/time_s",schemaPath:"#/$defs/par/properties/time_s/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
}
if(data32.burns !== undefined){
let data35 = data32.burns;
if(!(((typeof data35 == "number") && (!(data35 % 1) && !isNaN(data35))) && (isFinite(data35)))){
const err104 = {instancePath:instancePath+"/par/burns",schemaPath:"#/$defs/par/properties/burns/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
if((typeof data35 == "number") && (isFinite(data35))){
if(data35 < 0 || isNaN(data35)){
const err105 = {instancePath:instancePath+"/par/burns",schemaPath:"#/$defs/par/properties/burns/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
}
}
if(data32.derivation !== undefined){
let data36 = data32.derivation;
if(typeof data36 === "string"){
if(func2(data36) < 20){
const err106 = {instancePath:instancePath+"/par/derivation",schemaPath:"#/$defs/par/properties/derivation/minLength",keyword:"minLength",params:{limit: 20},message:"must NOT have fewer than 20 characters"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
}
else {
const err107 = {instancePath:instancePath+"/par/derivation",schemaPath:"#/$defs/par/properties/derivation/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
}
}
if(data32.referenceReplay !== undefined){
let data37 = data32.referenceReplay;
if(typeof data37 === "string"){
if(func2(data37) < 1){
const err108 = {instancePath:instancePath+"/par/referenceReplay",schemaPath:"#/$defs/par/properties/referenceReplay/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
}
else {
const err109 = {instancePath:instancePath+"/par/referenceReplay",schemaPath:"#/$defs/par/properties/referenceReplay/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
}
}
else {
const err110 = {instancePath:instancePath+"/par",schemaPath:"#/$defs/par/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
}
if(data.unlocks !== undefined){
let data38 = data.unlocks;
if(Array.isArray(data38)){
const len2 = data38.length;
for(let i2=0; i2<len2; i2++){
let data39 = data38[i2];
if(typeof data39 === "string"){
if(!pattern4.test(data39)){
const err111 = {instancePath:instancePath+"/unlocks/" + i2,schemaPath:"#/properties/unlocks/items/pattern",keyword:"pattern",params:{pattern: "^[a-z0-9]+(-[a-z0-9]+)*$"},message:"must match pattern \""+"^[a-z0-9]+(-[a-z0-9]+)*$"+"\""};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
}
}
else {
const err112 = {instancePath:instancePath+"/unlocks/" + i2,schemaPath:"#/properties/unlocks/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err112];
}
else {
vErrors.push(err112);
}
errors++;
}
}
}
else {
const err113 = {instancePath:instancePath+"/unlocks",schemaPath:"#/properties/unlocks/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err113];
}
else {
vErrors.push(err113);
}
errors++;
}
}
if(data.assistsAllowed !== undefined){
let data40 = data.assistsAllowed;
if(Array.isArray(data40)){
const len3 = data40.length;
for(let i3=0; i3<len3; i3++){
let data41 = data40[i3];
if(typeof data41 !== "string"){
const err114 = {instancePath:instancePath+"/assistsAllowed/" + i3,schemaPath:"#/$defs/assist/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err114];
}
else {
vErrors.push(err114);
}
errors++;
}
if(!(((((((data41 === "closest_approach") || (data41 === "elements")) || (data41 === "snapping")) || (data41 === "constraints")) || (data41 === "targeting_computer")) || (data41 === "porkchop")) || (data41 === "coach_marks"))){
const err115 = {instancePath:instancePath+"/assistsAllowed/" + i3,schemaPath:"#/$defs/assist/enum",keyword:"enum",params:{allowedValues: schema41.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err115];
}
else {
vErrors.push(err115);
}
errors++;
}
}
let i4 = data40.length;
let j0;
if(i4 > 1){
outer0:
for(;i4--;){
for(j0 = i4; j0--;){
if(func0(data40[i4], data40[j0])){
const err116 = {instancePath:instancePath+"/assistsAllowed",schemaPath:"#/properties/assistsAllowed/uniqueItems",keyword:"uniqueItems",params:{i: i4, j: j0},message:"must NOT have duplicate items (items ## "+j0+" and "+i4+" are identical)"};
if(vErrors === null){
vErrors = [err116];
}
else {
vErrors.push(err116);
}
errors++;
break outer0;
}
}
}
}
}
else {
const err117 = {instancePath:instancePath+"/assistsAllowed",schemaPath:"#/properties/assistsAllowed/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err117];
}
else {
vErrors.push(err117);
}
errors++;
}
}
if(data.coachMarks !== undefined){
let data42 = data.coachMarks;
if(Array.isArray(data42)){
const len4 = data42.length;
for(let i5=0; i5<len4; i5++){
let data43 = data42[i5];
if(typeof data43 === "string"){
if(!pattern5.test(data43)){
const err118 = {instancePath:instancePath+"/coachMarks/" + i5,schemaPath:"#/$defs/catalogueKey/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$"},message:"must match pattern \""+"^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$"+"\""};
if(vErrors === null){
vErrors = [err118];
}
else {
vErrors.push(err118);
}
errors++;
}
}
else {
const err119 = {instancePath:instancePath+"/coachMarks/" + i5,schemaPath:"#/$defs/catalogueKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err119];
}
else {
vErrors.push(err119);
}
errors++;
}
}
}
else {
const err120 = {instancePath:instancePath+"/coachMarks",schemaPath:"#/properties/coachMarks/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err120];
}
else {
vErrors.push(err120);
}
errors++;
}
}
}
else {
const err121 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err121];
}
else {
vErrors.push(err121);
}
errors++;
}
validate20.errors = vErrors;
return errors === 0;
}
validate20.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};
