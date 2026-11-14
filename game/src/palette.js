// EMBERLINE look plan: one dusk-foundry palette, shared by the 3D scene and the DOM.
// Every colour in the game comes from these names; lighting does the rest.
export const PALETTE = {
  dusk: '#171a21', // sky / canvas behind everything
  floor: '#23272e', // ground plates
  steel: '#31363f', // walls and big structures
  rust: '#7a4a28', // crates, furnace, warm accent structures
  ember: '#f08a2e', // the spike, tracers, HUD accent
  frost: '#9fc4d8', // cool fill light, friendly team colour
  signal: '#e8e4d8', // near-white: text, view-model metal
  hazard: '#e5484d', // enemy team colour, damage flash
};

export const TEAM_COLORS = {
  vanguard: 0x9fc4d8,
  ember: 0xe5484d,
};
