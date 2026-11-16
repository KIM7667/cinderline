// CINDERLINE's look in one place: a dusk freight yard — slate sky, cold concrete,
// warm sodium work-lights, and the two team colours doing the talking.
// Every material and HUD colour in the game comes from this table.
export const PALETTE = {
  sky: 0x2e3a47, // dusk blue-grey, also the fog colour
  skyLow: 0x584a3d, // horizon warmth near the ground
  ground: 0x4a4a4c, // asphalt
  groundLine: 0x8f8a7a, // painted yard markings
  concrete: 0x767b82, // walls and halls
  concreteDark: 0x565b62,
  crateWood: 0x8a6844,
  crateMetal: 0x5d6d75,
  containerA: 0x9a5a34, // rust orange container
  containerB: 0x3f6d6a, // faded teal container
  silo: 0x9aa0a4,
  furnace: 0x6e3b2a,
  roof: 0x3c4147,
  trim: 0xffb454, // sodium lamp / site marking accent
  lampGlow: 0xffc37a,
  attack: 0xff7a33, // Strikers — ember orange
  attackDark: 0xb34a17,
  defend: 0x35c4b5, // Wardens — signal teal
  defendDark: 0x1d7a70,
  uniform: 0x3a3f45, // shared trousers / boots tone
  skin: 0xc9a184,
  weapon: 0x23262a,
  weaponAccent: 0x8f979e,
  charge: 0xff4747, // the breach charge and its beacon
  white: 0xf2f0ea,
};

// HUD colours as CSS strings (index.html mirrors the same six tones).
export const CSS = {
  ink: '#f2f0ea',
  muted: '#9aa3ab',
  accent: '#ffb454',
  attack: '#ff7a33',
  defend: '#35c4b5',
  danger: '#ff4747',
};
