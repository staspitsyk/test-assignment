export const STATE_COURTS_MAP: Record<string, string[]> = {
  AL: ['Alabama State'],
  AK: ['Alaska State'],
  AZ: ['Arizona State'],
  AR: ['Arkansas State'],
  CA: ['California State', 'California Superior Court'],
  CO: ['Colorado State'],
  CT: ['Connecticut State', 'Connecticut Superior Court'],
  DE: ['Delaware State', 'Delaware Court of Chancery'],
  FL: ['Florida State', 'Florida Circuit Court'],
  GA: ['Georgia State'],
  HI: ['Hawaii State'],
  ID: ['Idaho State'],
  IL: ['Illinois State', 'Illinois Circuit Court'],
  IN: ['Indiana State', 'Indiana Circuit Court', 'Indiana Superior Court'],
  IA: ['Iowa State'],
  KS: ['Kansas State'],
  KY: ['Kentucky State'],
  LA: ['Louisiana State'],
  ME: ['Maine State'],
  MD: ['Maryland State'],
  MA: ['Massachusetts State'],
  MI: ['Michigan State'],
  MN: ['Minnesota State'],
  MS: ['Mississippi State'],
  MO: ['Missouri State'],
  MT: ['Montana State'],
  NE: ['Nebraska State'],
  NV: ['Nevada State'],
  NH: ['New Hampshire State'],
  NJ: ['New Jersey State', 'New Jersey Superior Court'],
  NM: ['New Mexico State'],
  NY: ['New York State', 'New York Supreme Court', 'New York County Supreme Court'],
  NC: ['North Carolina State'],
  ND: ['North Dakota State'],
  OH: ['Ohio State', 'Ohio Court of Common Pleas'],
  OK: ['Oklahoma State'],
  OR: ['Oregon State', 'Oregon Circuit Court'],
  PA: ['Pennsylvania State', 'Pennsylvania Court of Common Pleas'],
  RI: ['Rhode Island State'],
  SC: ['South Carolina State'],
  SD: ['South Dakota State'],
  TN: ['Tennessee State'],
  TX: ['Texas State', 'Texas District Court'],
  UT: ['Utah State'],
  VT: ['Vermont State'],
  VA: ['Virginia State'],
  WA: ['Washington State'],
  WV: ['West Virginia State'],
  WI: ['Wisconsin State'],
  WY: ['Wyoming State'],
  DC: ['District of Columbia'],
};

export function getStateCourts(stateCode: string): string[] {
  if (!stateCode || typeof stateCode !== 'string') {
    return [];
  }
  const upper = stateCode.trim().toUpperCase();
  if (STATE_COURTS_MAP[upper]) {
    return [...STATE_COURTS_MAP[upper]];
  }
  if (upper.length === 2) {
    return [`${upper} State`];
  }
  return [];
}
