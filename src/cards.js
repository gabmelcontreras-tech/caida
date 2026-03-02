// Caída card deck configuration and utilities

export const VALUE_ORDER = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
export const SUITS = ["coins", "cups", "clubs", "swords"];

/**
 * Maps a card to its image filename
 * @param {string} suit - Card suit (coins, cups, clubs, swords)
 * @param {number} rank - Card rank from VALUE_ORDER
 * @returns {string} - Filename for the card image
 */
export function fileNameForCard(suit, rank) {
  if (suit === "coins") {
    // coins_01..coins_07 use leading zero, coins_10..coins_12 do not
    const r = rank <= 7 ? String(rank).padStart(2, "0") : String(rank);
    return `coins_${r}.PNG`;
  }

  // For clubs: 1-7 have space before (rank), 10-12 do not
  if (suit === "clubs") {
    if (rank >= 10) {
      return `${suit}_(${rank}).PNG`;
    }
    return `${suit}_ (${rank}).PNG`;
  }

  // For cups and swords: ALL ranks have space before (rank)
  return `${suit}_ (${rank}).PNG`;
}

/**
 * Creates a complete deck of 40 Spanish cards
 * @returns {Array} - Array of card objects
 */
export function makeDeck() {
  const deck = [];
  let id = 0;

  for (const suit of SUITS) {
    for (const rank of VALUE_ORDER) {
      const card = {
        id: id++,
        suit: suit,
        rank: rank,
        value: rank, // Numeric value for game logic
        imgKey: `${suit}_${rank}`, // Phaser asset key
      };
      deck.push(card);
    }
  }

  return deck;
}
