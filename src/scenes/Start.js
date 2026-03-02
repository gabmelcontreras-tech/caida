import { VALUE_ORDER, SUITS, fileNameForCard, makeDeck } from '../cards.js';
import { bestCanto, cantoStrength, cantoPriority } from '../cantos.js';

export class Start extends Phaser.Scene {
  constructor() {
    super("Start");

    // Set by init(data) — defaults here are fallbacks only
    this.numPlayers = 2;
    this.teamMode = false;   // true when playing 2v2 (numPlayers === 4)
    this.dealerIndex = 0;

    // Match state (across multiple hands)
    this.targetPoints = 24;         // Points needed to win the match
    this.points = [];               // Cumulative points across hands (sized in startHand)
    this.handNumber = 1;            // Current hand number
    this.MESA_LIMPIA_POINTS = 4;    // Points awarded for clearing the table
    this.matchOver = false;         // Track if match has ended

    // Hand state (resets each hand)
    this.deck = [];
    this.tableCards = [];           // Phaser Images on table
    this.currentPlayer = 0;
    this.hands = [];                // arrays of card objects per player
    this.handSprites = [];          // sprites for current player's hand only
    this.opponentBacks = [];        // sprites showing opponent card backs
    this.captures = [];             // Cards captured this hand (per player)
    this.lastCapturer = null;
    this.playsThisRound = 0;

    // Caída tracking
    this.caidaCandidate = null;     // { value, ownerPlayer, expiresOnTurn, tableCardId }
    this.turnNumber = 0;            // Global turn counter for Caída timing

    // Canto tracking
    this.roundId = 0;
    this.roundCanto = [];           // best canto detected for each player at round start
    this.cantoDeclared = [];        // did player press the canto button?
    this.cantoByPlayer = [];        // stores declared cantos for end-of-round scoring
    this.cantoAwarded = false;      // prevents double-award per round
    this.cantoModalBg = null;
    this.cantoBtn = null;
    this.cantoBtnText = null;

    // UI
    this.playZoneRect = null;
    this.playZoneOutline = null;
    this.hudText = null;
    this.turnOverlay = null;
    this.hasShownFirstTurnOverlay = false;
    this.lastRoundWarned = false;

    // Move log
    this.moveLogLines = [];
    this.moveLogText = null;

    // Reparto (deal direction)
    this.mesaDealDirection = null;
  }

  // ---------- INIT ----------
  init(data) {
    this.numPlayers  = data.numPlayers || 2;
    this.teamMode    = (this.numPlayers === 4);
    this.dealerIndex = 0;
    // In team mode points are tracked per team (2 elements); otherwise per player
    this.points   = this.teamMode ? [0, 0] : Array(this.numPlayers).fill(0);
    this.handNumber = 1;
    this.matchOver  = false;
    this.aiPlayers  = new Set(data.aiPlayers ?? []);
  }

  // ---------- PRELOAD ----------
  preload() {
    // Load table background
    this.load.image("table_bg", "Public/assets/caida table basic.png");

    // Load card back
    this.load.image("card_back", "Public/assets/back of the card/back.PNG");

    // Load all 40 card faces using cards module
    for (const suit of SUITS) {
      for (const rank of VALUE_ORDER) {
        const imgKey = `${suit}_${rank}`;
        const fileName = fileNameForCard(suit, rank);
        this.load.image(imgKey, `Public/assets/cards/${fileName}`);
      }
    }
  }

  // ---------- CREATE ----------
  create() {
    this.cameras.main.setBackgroundColor("#0b0f14");

    // Add table background — rotate 90° so the landscape image fills the portrait canvas.
    // setDisplaySize sets the pre-rotation size to (height × width) so after the 90° turn
    // the final on-screen footprint is exactly (width × height) = the full canvas.
    const bg = this.add.image(this.scale.width / 2, this.scale.height / 2, "table_bg");
    bg.setOrigin(0.5);
    bg.setDepth(-1000);
    bg.setAngle(90);
    bg.setDisplaySize(this.scale.height, this.scale.width);

    this.createPlayZone();
    this.createDeckSprite();
    this.createHUD();
    this.createTurnOverlay();
    this.createCantoButton();
    this.createDirectionModal();
    this.createWarningText();
    this.createTapCatcher();
    this.createMenuButton();

    this.startHand();
  }

  // ---------- MATCH FLOW ----------
  dealUniqueMesaFour(direction) {
    const usedValues = new Set();
    const mesa = [];
    const rejects = [];
    let safety = 1000;
    const counts  = direction === "4to1" ? [4, 3, 2, 1] : [1, 2, 3, 4];
    const matches = []; // { slotIndex, pts }

    while (mesa.length < 4 && this.deck.length > 0 && safety-- > 0) {
      const c = this.deck.pop();
      if (!c) break;

      if (usedValues.has(c.value)) {
        rejects.push(c);
        continue;
      }

      usedValues.add(c.value);

      const slotIndex = mesa.length;
      const countNum  = counts[slotIndex];

      if (c.value === countNum) {
        matches.push({ slotIndex, pts: countNum });
      }

      mesa.push(c);
    }

    // Put rejects back, reshuffle for fairness
    if (rejects.length) {
      this.deck.unshift(...rejects);
      this.deck = this.shuffle(this.deck);
    }

    return { mesa, matches };
  }

  startHand() {
    console.log("startHand ENTER", {
      matchOver: this.matchOver,
      handInTransition: this.handInTransition,
      inputEnabled: this.input.enabled,
      currentHandNumber: this.handNumber
    });

    // Clear table sprites
    this.tableCards.forEach((img) => img.destroy());
    this.tableCards = [];

    // Rotate dealer (skip on first hand)
    if (this.handNumber > 1) {
      this.dealerIndex = (this.dealerIndex + 1) % this.numPlayers;
    }

    // Reset per-hand captures
    this.captures = Array(this.numPlayers).fill(0);
    this.lastCapturer = null;

    // Reset Caída tracking
    this.caidaCandidate = null;
    this.turnNumber = 0;

    // Reset overlay flag for new hand
    this.hasShownFirstTurnOverlay = false;
    this.lastRoundWarned = false;
    this.clearMoveLog();

    // New shuffled 40-card deck
    this.deck = this.shuffle(makeDeck());

    console.log("startHand: Deck created, length =", this.deck.length);

    // Dealer picks direction (4→1 or 1→4) before dealing the mesa
    this._showDirectionPickerOrAutoPick();
  }

  _showDirectionPickerOrAutoPick() {
    if (this.aiPlayers.has(this.dealerIndex)) {
      const dir = Math.random() < 0.5 ? "4to1" : "1to4";
      this._continueAfterDirection(dir);
      return;
    }

    const dealerLabel = `P${this.dealerIndex + 1}`;
    this.dirModalTitle.setText(`Reparto — ${dealerLabel} elige dirección:`);
    this.dirModalBg.setVisible(true);
    this.dirModalTitle.setVisible(true);
    this.dirBtn4Rect.setVisible(true);
    this.dirBtn4Text.setVisible(true);
    this.dirBtn1Rect.setVisible(true);
    this.dirBtn1Text.setVisible(true);
  }

  _continueAfterDirection(direction) {
    // Hide direction modal
    [this.dirModalBg, this.dirModalTitle,
     this.dirBtn4Rect, this.dirBtn4Text,
     this.dirBtn1Rect, this.dirBtn1Text].forEach(o => o?.setVisible(false));

    this.mesaDealDirection = direction;
    this.updateDeckSprite();

    // Get mesa cards without rendering them yet
    const { mesa, matches } = this.dealUniqueMesaFour(direction);

    // Pre-calculate final table positions for the 4 cards
    const cx = this.scale.width * 0.5;
    const cy = this.scale.height * 0.47;
    const spacingX = 120;
    const rowWidth = (mesa.length - 1) * spacingX;
    const startX = cx - rowWidth / 2;
    const targets = mesa.map((_, i) => ({ x: startX + i * spacingX, y: cy }));

    // Deal origin: just above the table center (simulates dealing from the deck)
    const dealOriX = cx;
    const dealOriY = cy - 220;

    // Animate each card flying to its table slot one by one
    const STAGGER = 420;   // ms between each card
    const DURATION = 480;  // ms for each card's flight

    mesa.forEach((card, i) => {
      this.time.delayedCall(i * STAGGER, () => {
        const img = this.addCardToTable(card);
        img.setPosition(dealOriX, dealOriY);
        img.setScale(0.6);
        img.setAlpha(0);
        img.setDepth(100 + i);

        this.tweens.add({
          targets: img,
          x: targets[i].x,
          y: targets[i].y,
          scale: 1.2,
          alpha: 1,
          duration: DURATION,
          ease: "Back.Out"
        });
      });
    });

    // After all cards have landed, award reparto points and start the hand
    const totalDelay = (mesa.length - 1) * STAGGER + DURATION + 80;
    this.time.delayedCall(totalDelay, () => {

      // Award reparto points and show popup for every matched card
      for (const { slotIndex, pts } of matches) {
        this.addPoints(this.dealerIndex, pts);
        const sprite = this.tableCards[slotIndex];
        if (sprite) this.showMatchPopup(sprite.x, sprite.y, pts);
      }
      if (matches.length > 0) {
        const total = matches.reduce((s, m) => s + m.pts, 0);
        this.logMove(`Reparto P${this.dealerIndex + 1}: +${total} pts`);
      } else {
        // Dealer missed every position — each other player gets +1
        for (let p = 0; p < this.numPlayers; p++) {
          if (p !== this.dealerIndex) {
            this.addPoints(p, 1);
            this.showMatchPopup(this.scale.width / 2, this.scale.height * 0.50, 1);
          }
        }
        this.logMove(`Reparto: repartidor falló — rivales +1`);
      }

      // Deal 3 to each player
      this.hands = Array.from({ length: this.numPlayers }, () => []);
      for (let i = 0; i < 3; i++) {
        for (let p = 0; p < this.numPlayers; p++) {
          const c = this.deck.pop();
          if (!c) break;
          this.hands[p].push(c);
        }
      }

      console.log("startHand: Cards dealt", {
        hands: this.hands.map(h => h.length),
        table: this.tableCards.length,
        deckRemaining: this.deck.length
      });

      this.playsThisRound = 0;
      this.currentPlayer = 0;

      // Compute cantos for this new round
      this.roundId += 1;
      this.roundCanto    = this.hands.map(h => bestCanto(h));
      this.cantoDeclared = Array(this.numPlayers).fill(false);

      // Reset canto scoring state for new round
      this.cantoByPlayer = Array(this.numPlayers).fill(null);
      this.cantoAwarded  = false;

      this._animateDealCards(() => {
        this.renderAll();
        this.refreshCantoGate();
        this.showOverlayIfFirstTurnOnly();

        if (this.aiPlayers.has(this.currentPlayer)) {
          this.time.delayedCall(700, () => this.aiTakeTurn());
        }

        console.log("startHand COMPLETE");
      });
    });
  }

  _animateDealCards(onComplete) {
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W * 0.5;
    const numCards = 3;

    // Compute final positions for each player's cards.
    // currentPlayer is always 0 at deal time, so relPos === playerIndex.
    const playerPositions = [];
    for (let p = 0; p < this.numPlayers; p++) {
      playerPositions[p] = [];
      const relPos = (p - this.currentPlayer + this.numPlayers) % this.numPlayers;

      if (relPos === 0) {
        // Bottom row (human / current player)
        const spacing = 140;
        const startX = cx - ((numCards - 1) * spacing) / 2;
        for (let i = 0; i < numCards; i++) {
          playerPositions[p].push({ x: startX + i * spacing, y: H * 0.84, scale: 1.3 });
        }
      } else if (relPos === 1 && this.numPlayers === 2) {
        // 2-player: single opponent at top
        const spacing = 130;
        const startX = cx - ((numCards - 1) * spacing) / 2;
        for (let i = 0; i < numCards; i++) {
          playerPositions[p].push({ x: startX + i * spacing, y: H * 0.10, scale: 0.75 });
        }
      } else if (relPos === 1) {
        // Right column
        const spacing = 85;
        const startY = H * 0.47 - ((numCards - 1) * spacing) / 2;
        for (let i = 0; i < numCards; i++) {
          playerPositions[p].push({ x: W - 35, y: startY + i * spacing, scale: 0.42 });
        }
      } else if (relPos === 2 && this.numPlayers === 4) {
        // 4-player: teammate at top
        const spacing = 130;
        const startX = cx - ((numCards - 1) * spacing) / 2;
        for (let i = 0; i < numCards; i++) {
          playerPositions[p].push({ x: startX + i * spacing, y: H * 0.10, scale: 0.55 });
        }
      } else {
        // Left column (relPos 2 in 3p, relPos 3 in 4p)
        const spacing = 85;
        const startY = H * 0.47 - ((numCards - 1) * spacing) / 2;
        for (let i = 0; i < numCards; i++) {
          playerPositions[p].push({ x: 35, y: startY + i * spacing, scale: 0.42 });
        }
      }
    }

    // Build sequence in deal order: P0C1, P1C1, …, P0C2, P1C2, …
    const sequence = [];
    for (let card = 0; card < numCards; card++) {
      for (let p = 0; p < this.numPlayers; p++) {
        sequence.push(playerPositions[p][card]);
      }
    }

    const dealOriX = cx;
    const dealOriY = H * 0.47;   // center of table (where the deck sits)
    const STAGGER  = 150;        // ms between each card
    const DURATION = 300;        // ms per card flight
    const tempBacks = [];
    let completed = 0;

    sequence.forEach((pos, idx) => {
      this.time.delayedCall(idx * STAGGER, () => {
        const back = this.add.image(dealOriX, dealOriY, "card_back")
          .setScale(0.5)
          .setDepth(500 + idx);
        tempBacks.push(back);

        this.tweens.add({
          targets: back,
          x: pos.x,
          y: pos.y,
          scale: pos.scale,
          duration: DURATION,
          ease: "Sine.Out",
          onComplete: () => {
            completed++;
            if (completed === sequence.length) {
              this.time.delayedCall(100, () => {
                tempBacks.forEach(b => b.destroy());
                onComplete();
              });
            }
          }
        });
      });
    });
  }

  checkEndOfHandAndContinueMatch() {
    const handsEmpty = this.hands.every(h => h.length === 0);
    if (!(this.deck.length === 0 && handsEmpty)) return false;

    // 1) Last-round sweep first (important)
    this.sweepTableToLastCapturerIfNeeded();

    // 2) Snapshot captures before applying bonus (for display)
    const captureSnapshot = this.captures.map(c => c ?? 0);

    // 3) Apply capture bonus points
    // Note: addPoints() will trigger endMatch() if someone reaches 24
    this.applyCaptureBonusPoints();

    // 4) If match ended, show final winner instead of hand summary
    if (this.matchOver) return true;

    // 5) Build dynamic FIN DE MANO overlay
    const captureLines = captureSnapshot.map((c, i) => `Jugador ${i + 1} capturó: ${c}`);
    const bonusLines   = this.buildBonusLines(captureSnapshot);

    let pointsLine;
    if (this.teamMode) {
      pointsLine = `Puntos → Eq.A: ${this.points[0]}  |  Eq.B: ${this.points[1]}`;
    } else {
      pointsLine = `Puntos → ${this.points.map((p, i) => `P${i + 1}: ${p}`).join("  |  ")}`;
    }

    this.showTapOverlay({
      title: "FIN DE MANO",
      bodyLines: [
        ...captureLines,
        "",
        ...bonusLines,
        "",
        pointsLine
      ],
      onTap: () => {
        this.startHand();
      }
    });

    // 6) Increment hand number (next hand will start when user taps)
    this.handNumber += 1;

    return true;
  }

  buildBonusLines(captureSnapshot) {
    if (this.teamMode) {
      const tA = (captureSnapshot[0] ?? 0) + (captureSnapshot[2] ?? 0);
      const tB = (captureSnapshot[1] ?? 0) + (captureSnapshot[3] ?? 0);
      const bonusA = tA > tB ? Math.max(0, tA - 21) : 0;
      const bonusB = tB > tA ? Math.max(0, tB - 21) : 0;
      return [
        `Equipo A capturó: ${tA}  Bono: +${bonusA}`,
        `Equipo B capturó: ${tB}  Bono: +${bonusB}`
      ];
    }
    if (this.numPlayers === 2) {
      const c0 = captureSnapshot[0];
      const c1 = captureSnapshot[1];
      const winner = c0 > c1 ? 0 : (c1 > c0 ? 1 : null);
      const bonus = winner !== null ? Math.max(0, captureSnapshot[winner] - 21) : 0;
      return [`Bono: +${bonus}`];
    }
    // 3-player: show per-player bonus
    return captureSnapshot.map((c, i) => {
      const threshold = (i === this.dealerIndex) ? 14 : 13;
      const bonus = Math.max(0, c - threshold);
      const role = (i === this.dealerIndex) ? " (mano)" : "";
      return `Bono P${i + 1}${role}: +${bonus}`;
    });
  }

  endTurnAndMaybeDeal() {
    // Hide the play zone outline and hint after the very first play
    if (this.hintText) {
      this.hintText.setVisible(false);
      this.hintText = null;
      this.playZoneOutline.setVisible(false);
    }

    // One play happened (either play-to-table or lift)
    this.playsThisRound += 1;
    this.turnNumber += 1;

    // Invalidate expired Caída candidate
    if (this.caidaCandidate && this.turnNumber > this.caidaCandidate.expiresOnTurn) {
      this.caidaCandidate = null;
    }

    // Advance turn to next player
    this.currentPlayer = (this.currentPlayer + 1) % this.numPlayers;

    // Check if hand ended
    if (this.checkEndOfHandAndContinueMatch()) return;

    // If all players have played their 3 cards, deal new hands
    if (this.playsThisRound >= this.numPlayers * 3) {
      this.playsThisRound = 0;

      // Award any pending canto points from the completed 3-card round
      this.awardCantoIfPending();

      // Clear Caída candidate on redeal (safety)
      this.caidaCandidate = null;

      // Deal 3 to each player
      for (let i = 0; i < 3; i++) {
        for (let p = 0; p < this.numPlayers; p++) {
          const c = this.deck.pop();
          if (!c) break;
          this.hands[p].push(c);
        }
      }

      // Warn if this was the last round (deck is now empty)
      if (!this.lastRoundWarned && this.deck.length === 0) {
        this.lastRoundWarned = true;
        this.showWarning?.("ÚLTIMA RONDA");
      }

      // Compute cantos for this new round
      this.roundId += 1;
      this.roundCanto    = this.hands.map(h => bestCanto(h));
      this.cantoDeclared = Array(this.numPlayers).fill(false);

      // Reset canto scoring state for new round
      this.cantoByPlayer = Array(this.numPlayers).fill(null);
      this.cantoAwarded = false;

      // Animate the deal then reveal hands
      this._animateDealCards(() => {
        this.renderAll();
        this.refreshCantoGate();
        if (this.aiPlayers.has(this.currentPlayer)) {
          this.time.delayedCall(700, () => this.aiTakeTurn());
        }
      });
      return;
    }

    this.renderAll();
    this.refreshCantoGate();

    if (this.aiPlayers.has(this.currentPlayer)) {
      this.time.delayedCall(700, () => this.aiTakeTurn());
    }
  }

  // Returns the team index (0 or 1) for a given player. In non-team modes,
  // returns the player index itself (safe since it is never used for team scoring).
  teamOf(playerIndex) {
    return playerIndex % 2;
  }

  addPoints(playerIndex, amount, reason = "") {
    if (!amount || amount <= 0) return;

    // In team mode, points accumulate on the team slot (0 or 1), not per-player
    const scoreIndex = this.teamMode ? this.teamOf(playerIndex) : playerIndex;
    this.points[scoreIndex] = (this.points[scoreIndex] || 0) + amount;

    // Update HUD right away
    this.updateHUD?.();

    // Optional tiny warning
    if (reason) this.showWarning?.(reason);

    // Win condition: ONLY place match ends
    if (this.points[scoreIndex] >= this.targetPoints) {
      this.endMatch(scoreIndex);
    }
  }

  endMatch(winnerIndex) {
    if (this.matchOver) return; // prevent double triggers
    this.matchOver = true;

    // Show final winner overlay (will disable card dragging, not global input)
    this.showFinalWinner(winnerIndex);
  }

  showFinalWinner(winnerIndex) {
    let winnerText, ptsLines, bgColor;

    if (this.teamMode) {
      winnerText = winnerIndex === 0 ? "¡EQUIPO A GANA!" : "¡EQUIPO B GANA!";
      ptsLines = [
        `Equipo A (P1+P3): ${this.points[0]} pts`,
        `Equipo B (P2+P4): ${this.points[1]} pts`
      ];
      bgColor = 0x3a0000;
    } else {
      ptsLines = (this.points || []).map((p, i) => `${this.playerLabel(i)}: ${p} pts`);

      if (this.aiPlayers.has(winnerIndex)) {
        winnerText = "¡La IA ha ganado!";
        bgColor    = 0x3a0000;
      } else if (this.aiPlayers.size > 0) {
        // Human beat the AI
        winnerText = "¡Has ganado!";
        bgColor    = 0x003a00;
      } else {
        winnerText = `¡${this.playerLabel(winnerIndex)} gana!`;
        bgColor    = 0x003a00;
      }
    }

    // Show overlay manually without tapCatcher so buttons can be used instead
    const text = ["MATCH OVER!", "", ...ptsLines, "", winnerText].join("\n");
    this.overlayText.setText(text);
    this.overlayText.setY(this.scale.height / 2 - 50);
    this.overlayBox.setSize(this.scale.width * 0.85, 440);
    this.overlayBox.setFillStyle(bgColor, 0.75);
    this.overlayBox.setVisible(true);
    this.overlayText.setVisible(true);
    this.setHandDraggable(false);

    const cx  = this.scale.width / 2;
    const btnY = this.scale.height / 2 + 150;
    const btnW = 280, btnH = 52, depth = 20004;

    const makeBtn = (x, label, callback) => {
      const bg = this.add.rectangle(x, btnY, btnW, btnH, 0xffffff, 0.15)
        .setStrokeStyle(2, 0xffffff, 0.6)
        .setDepth(depth)
        .setInteractive({ useHandCursor: true });
      const txt = this.add.text(x, btnY, label, {
        fontFamily: "monospace", fontSize: "20px", color: "#ffffff", align: "center"
      }).setOrigin(0.5).setDepth(depth + 1);
      bg.on("pointerover", () => bg.setFillStyle(0xffffff, 0.28));
      bg.on("pointerout",  () => bg.setFillStyle(0xffffff, 0.15));
      bg.on("pointerdown", () => { bg.destroy(); txt.destroy(); callback(); });
      return { bg, txt };
    };

    let btnA, btnB;
    btnA = makeBtn(cx - btnW / 2 - 10, "Seguir Jugando", () => {
      btnB.bg.destroy(); btnB.txt.destroy();
      this.overlayBox.setVisible(false);
      this.overlayText.setVisible(false);
      this.overlayText.setY(this.scale.height / 2);
      this.overlayBox.setSize(this.scale.width * 0.85, 320);
      this.scene.restart({ numPlayers: this.numPlayers, aiPlayers: [...this.aiPlayers] });
    });
    btnB = makeBtn(cx + btnW / 2 + 10, "Menú Principal", () => {
      btnA.bg.destroy(); btnA.txt.destroy();
      this.scene.start("Menu");
    });
  }

  // ---------- DECK ----------
  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- UI ----------
  createHUD() {
    this.hudText = this.add
      .text(20, 15, "", { fontSize: "18px", color: "#ffffff" })
      .setAlpha(0.9);

    this.moveLogText = this.add.text(
      this.scale.width * 0.5,
      this.scale.height * 0.71,
      "",
      {
        fontFamily: "monospace",
        fontSize: "15px",
        color: "#cccccc",
        align: "center",
        wordWrap: { width: 680 }
      }
    )
      .setOrigin(0.5, 0)
      .setDepth(15)
      .setAlpha(0.85);
  }

  updateHUD() {
    const capStr = (this.captures || []).map((c, i) => `P${i + 1} ${c}`).join(" | ");
    const dealerStr = this.numPlayers > 2 ? ` | Mano: P${(this.dealerIndex ?? 0) + 1}` : "";

    let ptsStr;
    if (this.teamMode) {
      ptsStr = `Eq.A ${this.points[0]} | Eq.B ${this.points[1]}`;
    } else {
      ptsStr = (this.points || []).map((p, i) => `P${i + 1} ${p}`).join(" | ");
    }

    const teamTag = this.teamMode
      ? ` [Eq.${this.teamOf(this.currentPlayer) === 0 ? "A" : "B"}]`
      : "";

    this.hudText.setText(
      `Hand ${this.handNumber} | Turn: P${this.currentPlayer + 1}${teamTag}${dealerStr} | Deck: ${this.deck.length}\n` +
      `Points: ${ptsStr}  (Captured: ${capStr})`
    );

    // Only update visibility here — position is fixed per hand (set in _continueAfterDirection)
    if (this.deckSprite) {
      this.deckSprite.setVisible(this.deck && this.deck.length > 0);
    }
  }

  // ---------- MOVE LOG ----------

  playerLabel(p) {
    if (this.aiPlayers.has(p)) return "IA";
    if (this.aiPlayers.size > 0) return "Tú";
    return `P${p + 1}`;
  }

  cardLabel(card) {
    const rankName = { 1: "As", 10: "Sota", 11: "Cab", 12: "Rey" }[card.rank] ?? String(card.rank);
    const suitName = { coins: "oro", cups: "cop", clubs: "bas", swords: "esp" }[card.suit] ?? card.suit;
    return `${rankName}${suitName}`;
  }

  logMove(line) {
    this.moveLogLines.push(line);
    if (this.moveLogLines.length > 2) this.moveLogLines.shift();
    if (this.moveLogText) this.moveLogText.setText(this.moveLogLines.join("\n"));
  }

  clearMoveLog() {
    this.moveLogLines = [];
    if (this.moveLogText) this.moveLogText.setText("");
  }

  createMenuButton() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // ── Top-right "Menú" trigger button ──────────────────────────────────────
    const x = this.scale.width - 55;
    const y = 25;
    const rect = this.add.rectangle(x, y, 90, 40, 0x000000, 0.70)
      .setStrokeStyle(1, 0xffffff, 0.40)
      .setDepth(500)
      .setInteractive({ useHandCursor: true });
    this.add.text(x, y, "Menú", {
      fontFamily: "monospace", fontSize: "16px", color: "#ffffff"
    }).setOrigin(0.5).setDepth(501);

    rect.on("pointerover", () => rect.setStrokeStyle(2, 0xffffff, 0.80));
    rect.on("pointerout",  () => rect.setStrokeStyle(1, 0xffffff, 0.40));
    rect.on("pointerdown", () => this._showQuitConfirm());

    // ── Quit confirmation modal (hidden until needed) ─────────────────────────
    const DEPTH = 19000; // above game, below tap-overlay

    this._quitModalBg = this.add.rectangle(cx, cy,
      this.scale.width, this.scale.height, 0x000000, 0.65)
      .setDepth(DEPTH).setVisible(false);

    this._quitModalBox = this.add.rectangle(cx, cy, 420, 200, 0x0b0f14, 1)
      .setStrokeStyle(2, 0xffffff, 0.50)
      .setDepth(DEPTH + 1).setVisible(false);

    this._quitModalTitle = this.add.text(cx, cy - 55,
      "¿Salir al menú principal?",
      { fontFamily: "monospace", fontSize: "22px", color: "#ffffff", align: "center" })
      .setOrigin(0.5).setDepth(DEPTH + 2).setVisible(false);

    // Yes button
    this._quitYesRect = this.add.rectangle(cx - 90, cy + 40, 150, 60, 0x000000, 0.85)
      .setStrokeStyle(2, 0xffffff, 0.50)
      .setDepth(DEPTH + 1).setVisible(false)
      .setInteractive({ useHandCursor: true });
    this._quitYesText = this.add.text(cx - 90, cy + 40, "Sí",
      { fontFamily: "monospace", fontSize: "26px", color: "#ffffff" })
      .setOrigin(0.5).setDepth(DEPTH + 2).setVisible(false);

    // No button
    this._quitNoRect = this.add.rectangle(cx + 90, cy + 40, 150, 60, 0x000000, 0.85)
      .setStrokeStyle(2, 0xffffff, 0.50)
      .setDepth(DEPTH + 1).setVisible(false)
      .setInteractive({ useHandCursor: true });
    this._quitNoText = this.add.text(cx + 90, cy + 40, "No",
      { fontFamily: "monospace", fontSize: "26px", color: "#ffffff" })
      .setOrigin(0.5).setDepth(DEPTH + 2).setVisible(false);

    // Hover styles
    [this._quitYesRect, this._quitNoRect].forEach(r => {
      r.on("pointerover", () => r.setStrokeStyle(3, 0xffffff, 0.90));
      r.on("pointerout",  () => r.setStrokeStyle(2, 0xffffff, 0.50));
    });

    this._quitYesRect.on("pointerdown", () => this.scene.start("Menu"));
    this._quitNoRect.on("pointerdown",  () => this._hideQuitConfirm());
  }

  _showQuitConfirm() {
    [this._quitModalBg, this._quitModalBox, this._quitModalTitle,
     this._quitYesRect, this._quitYesText,
     this._quitNoRect,  this._quitNoText].forEach(o => o?.setVisible(true));
  }

  _hideQuitConfirm() {
    [this._quitModalBg, this._quitModalBox, this._quitModalTitle,
     this._quitYesRect, this._quitYesText,
     this._quitNoRect,  this._quitNoText].forEach(o => o?.setVisible(false));
  }

  createWarningText() {
    this.warningText = this.add.text(
      this.scale.width / 2,
      this.scale.height * 0.30,
      "",
      {
        fontFamily: "monospace",
        fontSize: "32px",
        color: "#ffffff",
        align: "center"
      }
    )
      .setOrigin(0.5)
      .setDepth(8000)
      .setAlpha(0);
  }

  createTapCatcher() {
    // Create reusable overlay elements first (lower depths)
    this.overlayBox = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width * 0.85,
      320,
      0x000000,
      0.55
    )
      .setStrokeStyle(2, 0xffffff, 0.25)
      .setDepth(20001)
      .setVisible(false);

    this.overlayText = this.add.text(
      this.scale.width / 2,
      this.scale.height / 2,
      "",
      {
        fontFamily: "monospace",
        fontSize: "34px",
        color: "#ffffff",
        align: "center"
      }
    )
      .setOrigin(0.5)
      .setDepth(20002)
      .setVisible(false);

    // Create tap catcher LAST (highest depth, on top of everything)
    this.tapCatcher = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0x000000,
      0.01
    ).setDepth(20003).setVisible(false);

    // Make it interactive - use default hit area (the rectangle itself)
    this.tapCatcher.setInteractive({ useHandCursor: true });

    console.log("Tap catcher created:", {
      width: this.scale.width,
      height: this.scale.height,
      depth: 20003
    });
  }

  showTapOverlay({ title, bodyLines, onTap, bgColor = 0x000000 }) {
    console.log("showTapOverlay called with title:", title);

    // Make sure no previous handler is still bound
    this.tapCatcher.removeAllListeners("pointerdown");

    // Build text
    const text = [title, "", ...bodyLines, "", "Tap to continue"].join("\n");

    this.overlayText.setText(text);
    this.overlayBox.setFillStyle(bgColor, 0.75);

    this.tapCatcher.setVisible(true);
    this.overlayBox.setVisible(true);
    this.overlayText.setVisible(true);

    console.log("Overlay visible, tap catcher interactive:", this.tapCatcher.input?.enabled);

    // Disable card dragging while overlay is visible
    this.setHandDraggable(false);

    this.tapCatcher.on("pointerdown", () => {
      console.log("HAND SUMMARY TAP FIRED");

      console.log("FORCE CONTINUE START", {
        inputEnabled: this.input.enabled,
        paused: this.scene.isPaused?.(),
        active: this.scene.isActive?.(),
        matchOver: this.matchOver,
        handNumber: this.handNumber,
        deckLength: this.deck?.length
      });

      // Hide overlay
      this.tapCatcher.setVisible(false);
      this.overlayBox.setVisible(false);
      this.overlayText.setVisible(false);

      // Re-enable card dragging
      this.setHandDraggable(true);

      // Resume scene if paused
      try { this.scene.resume(); } catch (e) {}
      try { this.physics?.resume(); } catch (e) {}

      // Re-enable input
      this.input.enabled = true;

      // Clear any common locks (safe even if not used)
      this.handInTransition = false;
      this.waitingForTap = false;
      this.waitingForHandSummaryTap = false;
      this.turnLocked = false;

      // Run action on next tick to avoid same-frame conflicts
      this.time.delayedCall(0, () => {
        console.log("CALLING onTap callback");
        onTap?.();

        console.log("AFTER onTap", {
          deck: this.deck?.length,
          hand0: this.hands?.[0]?.length,
          hand1: this.hands?.[1]?.length,
          table: this.tableCards?.length
        });
      });
    });
  }

  showWarning(label) {
    if (!this.warningText) return;

    // Kill any existing tween to prevent conflicts
    this.tweens.killTweensOf(this.warningText);

    // Set the new text and reset alpha
    this.warningText.setText(label);
    this.warningText.setAlpha(0);

    // Fade in → hold → fade out
    this.tweens.add({
      targets: this.warningText,
      alpha: 1,
      duration: 300,
      ease: "Cubic.easeOut",
      yoyo: false,
      onComplete: () => {
        this.time.delayedCall(1200, () => {
          this.tweens.add({
            targets: this.warningText,
            alpha: 0,
            duration: 400,
            ease: "Cubic.easeIn"
          });
        });
      }
    });
  }

  showMatchPopup(x, y, pts) {
    const popup = this.add.text(x, y - 40, `+${pts}!`, {
      fontFamily: "monospace",
      fontSize: "40px",
      color: "#ffdd44",
      stroke: "#000000",
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(9500).setAlpha(0);

    this.tweens.add({
      targets: popup,
      alpha: 1,
      y: y - 80,
      duration: 300,
      ease: "Cubic.easeOut",
      onComplete: () => {
        this.time.delayedCall(700, () => {
          this.tweens.add({
            targets: popup,
            alpha: 0,
            duration: 400,
            ease: "Cubic.easeIn",
            onComplete: () => popup.destroy()
          });
        });
      }
    });
  }

  createPlayZone() {
    const cx = this.scale.width * 0.5;
    const cy = this.scale.height * 0.47;

    const w = 660;   // visual outline width
    const h = 480;

    // Drop zone is much larger than the visual outline — covers the full table area
    const dropW = this.scale.width;
    const dropH = this.scale.height * 0.78;  // everything above the hand cards
    this.playZoneRect = new Phaser.Geom.Rectangle(0, 0, dropW, dropH);

    this.playZoneOutline = this.add.graphics();
    this.playZoneOutline.lineStyle(4, 0xffffff, 0.12);
    this.playZoneOutline.strokeRect(cx - w / 2, cy - h / 2, w, h);

    this.hintText = this.add
      .text(cx, cy + h / 2 + 15, "Drop center to play. Drop on matching table card to lift.", {
        fontSize: "16px",
        color: "#ffffff",
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.55);
  }

  createDeckSprite() {
    this.deckSprite = this.add.image(
      this.scale.width * 0.78,
      this.scale.height * 0.15,
      "card_back"
    )
      .setScale(0.7)
      .setDepth(50)
      .setAlpha(0.9);
  }

  _getDeckPosition() {
    const W = this.scale.width;
    const H = this.scale.height;
    const relPos = (this.dealerIndex - this.currentPlayer + this.numPlayers) % this.numPlayers;

    if (relPos === 0) {
      // Dealer at bottom → lower-left outside oval
      return { x: W * 0.18, y: H * 0.78 };
    } else if (relPos === 1 && this.numPlayers === 2) {
      // Dealer at top (2-player) → upper-right
      return { x: W * 0.78, y: H * 0.15 };
    } else if (relPos === 1) {
      // Dealer at right (3/4-player) → right side
      return { x: W * 0.88, y: H * 0.68 };
    } else if (relPos === 2 && this.numPlayers === 4) {
      // Dealer at top (4-player teammate) → upper-right
      return { x: W * 0.78, y: H * 0.15 };
    } else {
      // Dealer at left (relPos 2 in 3p, relPos 3 in 4p) → left side
      return { x: W * 0.12, y: H * 0.68 };
    }
  }

  updateDeckSprite() {
    if (!this.deckSprite) return;
    const { x, y } = this._getDeckPosition();
    this.deckSprite.setPosition(x, y);
    this.deckSprite.setVisible(this.deck && this.deck.length > 0);
  }

  highlightPlayZone(on) {
    if (!this.playZoneRect || !this.playZoneOutline.visible) return;
    this.playZoneOutline.clear();
    this.playZoneOutline.lineStyle(on ? 6 : 4, 0xffffff, on ? 0.28 : 0.12);
    this.playZoneOutline.strokeRect(
      this.playZoneRect.x,
      this.playZoneRect.y,
      this.playZoneRect.width,
      this.playZoneRect.height
    );
  }

  createTurnOverlay() {
    const w = this.scale.width;
    const h = this.scale.height;

    const container = this.add.container(0, 0).setDepth(5000).setVisible(false);

    const bg = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.6);
    const title = this.add
      .text(w / 2, h / 2 - 50, "Turn", { fontSize: "64px", color: "#ffffff" })
      .setOrigin(0.5)
      .setName("title");

    const subtitle = this.add
      .text(w / 2, h / 2 + 40, "Tap to continue", { fontSize: "28px", color: "#ffffff" })
      .setOrigin(0.5)
      .setAlpha(0.9)
      .setName("subtitle");

    container.add([bg, title, subtitle]);

    container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, w, h),
      Phaser.Geom.Rectangle.Contains
    );

    container.on("pointerdown", () => {
      const mode = container.getData("mode") || "turn";
      if (mode === "gameover") {
        this.resetMatch();
        return;
      }
      container.setVisible(false);
      this.renderAll();
    });

    this.turnOverlay = container;
  }

  showTurnOverlay() {
    this.turnOverlay.setVisible(true);
    this.turnOverlay.setData("mode", "turn");
    this.turnOverlay.getByName("title").setText(`Player ${this.currentPlayer + 1}`);
    this.turnOverlay.getByName("subtitle").setText("Tap to play");
  }

  showOverlayIfFirstTurnOnly() {
    if (this.hasShownFirstTurnOverlay) return;
    this.hasShownFirstTurnOverlay = true;
    this.showTurnOverlay();
  }

  createCantoButton() {
    this.cantoModalBg = this.add.rectangle(
      this.scale.width / 2, this.scale.height / 2,
      this.scale.width, this.scale.height,
      0x000000, 0.55
    ).setDepth(9000).setVisible(false);

    this.cantoBtn = this.add.rectangle(
      this.scale.width / 2, this.scale.height * 0.62,
      640, 120,
      0x000000, 0.80
    ).setStrokeStyle(2, 0xffffff, 0.35)
     .setDepth(9001).setVisible(false)
     .setInteractive({ useHandCursor: true });

    this.cantoBtnText = this.add.text(
      this.scale.width / 2, this.scale.height * 0.62,
      "",
      { fontFamily: "monospace", fontSize: "34px", color: "#ffffff", align: "center" }
    ).setOrigin(0.5).setDepth(9002).setVisible(false);

    this.cantoBtn.on("pointerdown", () => this.onPressCanto());
  }

  createDirectionModal() {
    const cx = this.scale.width * 0.5;

    this.dirModalBg = this.add.rectangle(cx, this.scale.height * 0.5,
      this.scale.width, this.scale.height, 0x000000, 0.60)
      .setDepth(9000).setVisible(false);

    this.dirModalTitle = this.add.text(cx, this.scale.height * 0.46,
      "", { fontFamily: "monospace", fontSize: "26px", color: "#ffffff", align: "center" })
      .setOrigin(0.5).setDepth(9002).setVisible(false);

    const btnY = this.scale.height * 0.57;

    this.dirBtn4Rect = this.add.rectangle(cx - 175, btnY, 300, 100, 0x000000, 0.85)
      .setStrokeStyle(2, 0xffffff, 0.5).setDepth(9001).setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.dirBtn4Text = this.add.text(cx - 175, btnY, "4 → 1",
      { fontFamily: "monospace", fontSize: "32px", color: "#ffffff" })
      .setOrigin(0.5).setDepth(9002).setVisible(false);

    this.dirBtn1Rect = this.add.rectangle(cx + 175, btnY, 300, 100, 0x000000, 0.85)
      .setStrokeStyle(2, 0xffffff, 0.5).setDepth(9001).setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.dirBtn1Text = this.add.text(cx + 175, btnY, "1 → 4",
      { fontFamily: "monospace", fontSize: "32px", color: "#ffffff" })
      .setOrigin(0.5).setDepth(9002).setVisible(false);

    this.dirBtn4Rect.on("pointerdown", () => this._continueAfterDirection("4to1"));
    this.dirBtn1Rect.on("pointerdown", () => this._continueAfterDirection("1to4"));

    [this.dirBtn4Rect, this.dirBtn1Rect].forEach(r => {
      r.on("pointerover", () => r.setStrokeStyle(3, 0xffffff, 0.9));
      r.on("pointerout",  () => r.setStrokeStyle(2, 0xffffff, 0.5));
    });
  }

  shouldGateForCanto(playerIndex) {
    // Only at start of the 3-card round
    if ((this.hands[playerIndex]?.length ?? 0) !== 3) return false;

    // Only if they have a canto this round
    if (!this.roundCanto[playerIndex]) return false;

    // Only if they haven't declared it yet
    if (this.cantoDeclared[playerIndex]) return false;

    return true;
  }

  showCantoModalForPlayer(playerIndex) {
    const canto = this.roundCanto[playerIndex];
    if (!canto) return;

    this.cantoBtnText.setText(`CANTAR: ${canto.type}\n+${canto.points}`);

    this.cantoModalBg.setVisible(true);
    this.cantoBtn.setVisible(true);
    this.cantoBtnText.setVisible(true);
  }

  hideCantoModal() {
    this.cantoModalBg.setVisible(false);
    this.cantoBtn.setVisible(false);
    this.cantoBtnText.setVisible(false);
  }

  setHandDraggable(enabled) {
    if (!this.handSprites || !Array.isArray(this.handSprites)) return;

    this.handSprites.forEach(sprite => {
      if (!sprite || !sprite.scene) return; // Skip destroyed or invalid sprites

      try {
        if (enabled) {
          sprite.setInteractive({ useHandCursor: true });
          this.input.setDraggable(sprite, true);
        } else {
          sprite.disableInteractive();
          this.input.setDraggable(sprite, false);
        }
      } catch (e) {
        console.warn("Error setting sprite draggable:", e);
      }
    });
  }

  refreshCantoGate() {
    const p = this.currentPlayer;
    const gate = this.shouldGateForCanto(p);

    if (gate) {
      if (this.aiPlayers.has(p)) {
        // AI auto-declares canto immediately; onPressCanto() calls refreshCantoGate() again
        this.onPressCanto();
        return;
      }
      this.showCantoModalForPlayer(p);
      this.setHandDraggable(false);
    } else {
      this.hideCantoModal();
      this.setHandDraggable(true);
    }
  }

  onPressCanto() {
    const p = this.currentPlayer;

    if (!this.shouldGateForCanto(p)) return;

    this.cantoDeclared[p] = true;

    // Store the canto for later scoring (don't score immediately)
    const canto = this.roundCanto[p];
    if (canto) {
      this.cantoByPlayer[p] = {
        type: canto.type,
        points: canto.points,
        rank: cantoPriority(canto.type),
        tieValue: cantoStrength(canto)
      };
      console.log(`Player ${p + 1} declared canto:`, this.cantoByPlayer[p]);
    }

    this.refreshCantoGate();
  }

  awardCantoIfPending() {
    if (this.cantoAwarded) return; // only once per 3-card round

    // Collect all players who declared a canto this round
    const declared = (this.cantoByPlayer || [])
      .map((c, i) => (c && c.type ? { playerIndex: i, canto: c } : null))
      .filter(Boolean);

    if (declared.length === 0) {
      console.log("No cantos declared this round");
      this.cantoAwarded = true;
      return;
    }

    if (declared.length === 1) {
      const { playerIndex, canto } = declared[0];
      this.addPoints(playerIndex, canto.points, `CANTO: ${canto.type.toUpperCase()}`);
      this.showWarning(`CANTO P${playerIndex + 1}: ${canto.type.toUpperCase()} +${canto.points}`);
      console.log(`Player ${playerIndex + 1} won canto ${canto.type} for ${canto.points} points!`);
      this.cantoAwarded = true;
      return;
    }

    // Multiple declared: sort by rank desc, then tieValue desc
    declared.sort((a, b) => {
      if (b.canto.rank !== a.canto.rank) return b.canto.rank - a.canto.rank;
      return b.canto.tieValue - a.canto.tieValue;
    });

    const best   = declared[0];
    const second = declared[1];
    const rankTie      = best.canto.rank      === second.canto.rank;
    const tieValueTie  = best.canto.tieValue  === second.canto.tieValue;

    if (rankTie && tieValueTie) {
      this.showWarning("CANTO EMPATE");
      console.log("Canto tie - no points awarded");
    } else {
      const { playerIndex, canto } = best;
      this.addPoints(playerIndex, canto.points, `CANTO: ${canto.type.toUpperCase()}`);
      this.showWarning(`CANTO P${playerIndex + 1}: ${canto.type.toUpperCase()} +${canto.points}`);
      console.log(`Player ${playerIndex + 1} won canto ${canto.type} for ${canto.points} points!`);
    }

    this.cantoAwarded = true;
  }

  resetMatch() {
    // Clean all sprites
    this.tableCards.forEach((img) => img.destroy());
    this.tableCards = [];
    this.handSprites.forEach((s) => s.destroy());
    this.handSprites = [];

    // Reset match state (use numPlayers for dynamic arrays)
    this.points   = Array(this.numPlayers).fill(0);
    this.hands    = Array.from({ length: this.numPlayers }, () => []);
    this.captures = Array(this.numPlayers).fill(0);
    this.handNumber    = 1;
    this.dealerIndex   = 0;
    this.playsThisRound = 0;
    this.matchOver = false;
    this.input.enabled = true;

    this.turnOverlay.setVisible(false);
    this.startHand();
  }

  // ---------- RENDER ----------
  renderAll() {
    this.updateHUD();
    this.renderCurrentHand();
    this.renderOpponentBacks();
    this.layoutTable();
  }

  renderOpponentBacks() {
    if (this.opponentBacks) {
      this.opponentBacks.forEach(b => b.destroy());
    }
    this.opponentBacks = [];

    const opponents = [];
    for (let p = 0; p < this.numPlayers; p++) {
      if (p !== this.currentPlayer) opponents.push(p);
    }

    const W = this.scale.width;
    const H = this.scale.height;

    if (opponents.length === 1) {
      // 2-player: single row centered at top
      const count  = this.hands?.[opponents[0]]?.length ?? 0;
      if (!count) return;
      const spacing = 130;
      const startX  = W * 0.5 - ((count - 1) * spacing) / 2;
      for (let i = 0; i < count; i++) {
        this.opponentBacks.push(
          this.add.image(startX + i * spacing, H * 0.10, "card_back").setScale(0.75).setDepth(100)
        );
      }
      return;
    }

    // 3-player / 4-player: place each opponent by their relative seat (clockwise)
    //   relPos 1            → RIGHT side column
    //   relPos 2 (4p only)  → TOP center row  (teammate, directly across)
    //   relPos numPlayers-1 → LEFT side column
    opponents.forEach((opp) => {
      const relPos  = (opp - this.currentPlayer + this.numPlayers) % this.numPlayers;
      const count   = this.hands?.[opp]?.length ?? 0;
      const teamTag = this.teamMode ? ` [Eq.${this.teamOf(opp) === 0 ? "A" : "B"}]` : "";
      const label   = `P${opp + 1}${teamTag}`;

      if (relPos === 1) {
        this._placeOpponentSide(label, count, W - 35, H * 0.47, 85, 0.42);
      } else if (relPos === 2 && this.numPlayers === 4) {
        this._placeOpponentTop(label, count, W * 0.5, H * 0.10, 130, 0.55);
      } else if (relPos === this.numPlayers - 1) {
        this._placeOpponentSide(label, count, 35, H * 0.47, 85, 0.42);
      }
    });
  }

  // Renders card backs + label in a vertical column on the left or right side
  _placeOpponentSide(label, count, x, centerY, spacing, scale) {
    const startY = centerY - ((count - 1) * spacing) / 2;

    this.opponentBacks.push(
      this.add.text(x, startY - 22, label, {
        fontFamily: "monospace", fontSize: "12px", color: "#aaffaa", align: "center"
      }).setOrigin(0.5, 1).setDepth(101).setAlpha(0.85)
    );

    for (let i = 0; i < count; i++) {
      this.opponentBacks.push(
        this.add.image(x, startY + i * spacing, "card_back").setScale(scale).setDepth(100)
      );
    }
  }

  // Renders card backs + label in a horizontal row at the top
  _placeOpponentTop(label, count, centerX, y, spacing, scale) {
    const startX = centerX - ((count - 1) * spacing) / 2;

    this.opponentBacks.push(
      this.add.text(centerX, y - 28, label, {
        fontFamily: "monospace", fontSize: "12px", color: "#aaffaa", align: "center"
      }).setOrigin(0.5, 1).setDepth(101).setAlpha(0.85)
    );

    for (let i = 0; i < count; i++) {
      this.opponentBacks.push(
        this.add.image(startX + i * spacing, y, "card_back").setScale(scale).setDepth(100)
      );
    }
  }

  // ---------- AI ----------

  aiTakeTurn() {
    // Safety guard: abort if game ended or it's no longer the AI's turn
    if (this.matchOver || !this.aiPlayers.has(this.currentPlayer)) return;

    const hand = this.hands[this.currentPlayer];
    if (!hand || hand.length === 0) return;

    // 1. Caída opportunity — if the previous player left a candidate we can capture, grab it
    if (this.caidaCandidate) {
      const cIdx = hand.findIndex(c => c.value === this.caidaCandidate.value);
      if (cIdx !== -1) {
        this._aiExecuteLift(cIdx);
        return;
      }
    }

    // 2. Best lift — find cards that can capture at least one table card
    const liftOptions = [];
    for (let i = 0; i < hand.length; i++) {
      const liftValues = this.getLiftValuesFromTable(hand[i].value);
      if (liftValues.has(hand[i].value)) {
        const tableMatchCount = [...liftValues].filter(v =>
          this.tableCards.some(t => t.getData("card").value === v)
        ).length;
        liftOptions.push({ cardIndex: i, tableMatchCount, card: hand[i] });
      }
    }

    if (liftOptions.length > 0) {
      // Prefer: Mesa Limpia > most cards captured > highest-value card
      liftOptions.sort((a, b) => {
        const aMesa = a.tableMatchCount === this.tableCards.length ? 1 : 0;
        const bMesa = b.tableMatchCount === this.tableCards.length ? 1 : 0;
        if (aMesa !== bMesa) return bMesa - aMesa;
        if (a.tableMatchCount !== b.tableMatchCount) return b.tableMatchCount - a.tableMatchCount;
        return b.card.value - a.card.value;
      });
      this._aiExecuteLift(liftOptions[0].cardIndex);
      return;
    }

    // 3. No capture — play to table; prefer lowest-value card (safest)
    const playable = hand
      .map((c, i) => ({ card: c, idx: i }))
      .filter(({ card }) => !this.tableCards.some(t => t.getData("card").value === card.value))
      .sort((a, b) => a.card.value - b.card.value);

    if (playable.length > 0) {
      const { card, idx } = playable[0];
      this.handlePlayToTable(this._makeFakeSprite(card, idx));
      return;
    }

    // Fallback: every card in hand can lift — just take the best one
    const fallbackLift = hand
      .map((c, i) => ({ card: c, idx: i }))
      .sort((a, b) => b.card.value - a.card.value);
    if (fallbackLift.length > 0) {
      this._aiExecuteLift(fallbackLift[0].idx);
    }
  }

  _aiExecuteLift(cardIndex) {
    const card = this.hands[this.currentPlayer][cardIndex];
    this.handleLift(this._makeFakeSprite(card, cardIndex), 0);
  }

  _makeFakeSprite(card, handIndex) {
    const data = { card, handIndex, homeX: 0, homeY: 0 };
    return { getData: (k) => data[k], destroy: () => {} };
  }

  getTableIndexAtPoint(x, y) {
    // Check from topmost card to bottommost
    for (let i = this.tableCards.length - 1; i >= 0; i--) {
      const img = this.tableCards[i];
      const b = img.getBounds();
      if (Phaser.Geom.Rectangle.Contains(b, x, y)) return i;
    }
    return -1;
  }

  renderCurrentHand() {
    // Remove old sprites
    this.handSprites.forEach((s) => s.destroy());
    this.handSprites = [];

    // In AI games the human is always shown at the bottom.
    // When it's the AI's turn we still render the human's cards but non-interactive.
    const isAITurn = this.aiPlayers.has(this.currentPlayer);
    const humanPlayer = isAITurn
      ? [...Array(this.numPlayers).keys()].find(p => !this.aiPlayers.has(p)) ?? 0
      : this.currentPlayer;
    const isMyTurn = !isAITurn;

    const hand = this.hands[humanPlayer];

    const baseY = this.scale.height * 0.84;
    const centerX = this.scale.width * 0.5;
    const spacing = 140;

    const startX = centerX - (spacing * (hand.length - 1)) / 2;

    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const x = startX + i * spacing;
      const y = baseY;

      const img = this.add.image(x, y, card.imgKey)
        .setScale(1.3)
        .setDepth(20)
        .setAlpha(isMyTurn ? 1 : 0.45);

      img.setData("card", card);
      img.setData("handIndex", i);
      img.setData("homeX", x);
      img.setData("homeY", y);

      if (isMyTurn) {
        img.setInteractive({ useHandCursor: true });
        this.input.setDraggable(img);

        img.on("dragstart", () => {
          img.setScale(1.4);
          img.setDepth(1000);
          this.highlightPlayZone(true);
        });

        img.on("drag", (_p, dragX, dragY) => {
          img.x = dragX;
          img.y = dragY;
        });

        img.on("dragend", (pointer) => {
          const x = pointer.x;
          const y = pointer.y;

          console.log("Dragend at:", x, y);
          console.log("Table cards count:", this.tableCards.length);

          // Check for table card FIRST (before play zone)
          const tableIndex = this.getTableIndexAtPoint(x, y);
          console.log("Table index found:", tableIndex);

          if (tableIndex !== -1) {
            console.log("Attempting lift at index:", tableIndex);
            this.handleLift(img, tableIndex);
            this.highlightPlayZone(false);
            return;
          }

          // If released inside play zone, play to table
          if (this.playZoneRect && Phaser.Geom.Rectangle.Contains(this.playZoneRect, x, y)) {
            console.log("Playing to table");
            this.handlePlayToTable(img);
            this.highlightPlayZone(false);
            return;
          }

          // Otherwise snap back
          console.log("Snapping back");
          this.snapBack(img);
          this.highlightPlayZone(false);
        });
      }

      this.handSprites.push(img);
    }
  }

  snapBack(img) {
    this.tweens.add({
      targets: img,
      x: img.getData("homeX"),
      y: img.getData("homeY"),
      scale: 1.3,
      duration: 140,
      ease: "Sine.Out",
      onComplete: () => img.setDepth(20),
    });
  }

  // ---------- TABLE ----------
  addCardToTable(card) {
    const img = this.add.image(0, 0, card.imgKey).setScale(1.2).setDepth(100);
    img.setData("card", card);
    img.setData("tableCardId", Phaser.Utils.String.UUID());
    this.tableCards.push(img);
    return img;
  }

  layoutTable() {
    const cards = this.tableCards;
    if (!cards || cards.length === 0) return;

    const maxPerRow = 5;

    // Center of table area
    const centerX = this.scale.width * 0.5;
    const centerY = this.scale.height * 0.47;

    // Spacing between cards
    const spacingX = 120;   // horizontal spacing (fits 6 cards in 720-wide canvas)
    const spacingY = 160;   // vertical spacing between rows

    const totalRows = Math.ceil(cards.length / maxPerRow);

    // Center the block vertically around centerY
    const blockHeight = (totalRows - 1) * spacingY;
    const startY = centerY - blockHeight / 2;

    for (let i = 0; i < cards.length; i++) {
      const row = Math.floor(i / maxPerRow);
      const col = i % maxPerRow;

      const cardsInThisRow = Math.min(maxPerRow, cards.length - row * maxPerRow);
      const rowWidth = (cardsInThisRow - 1) * spacingX;

      const startX = centerX - rowWidth / 2;

      const targetX = startX + col * spacingX;
      const targetY = startY + row * spacingY;

      // Check if card is already positioned (not a new card)
      const isNewCard = cards[i].x === 0 && cards[i].y === 0;

      if (isNewCard) {
        // New card: place directly at target position (no animation)
        cards[i].x = targetX;
        cards[i].y = targetY;
      } else {
        // Existing card: smooth snap into position
        this.tweens.add({
          targets: cards[i],
          x: targetX,
          y: targetY,
          duration: 150,
          ease: "Sine.Out"
        });
      }

      // Keep table cards at consistent depth
      cards[i].setDepth(100 + i);
      cards[i].setScale(1.2);
    }
  }


  // ---------- MOVES ----------
  handlePlayToTable(handSprite) {
    const card = handSprite.getData("card");
    const handIndex = handSprite.getData("handIndex");

    // Check if this value exists on the table
    const matchExists = this.tableCards.some(img => img.getData("card").value === card.value);

    if (matchExists) {
      // Cannot play to table if a matching value exists - must lift instead
      this.snapBack(handSprite);
      return;
    }

    // Remove card from player's hand
    this.hands[this.currentPlayer].splice(handIndex, 1);

    // Remove sprite
    handSprite.destroy();

    // Add to table and position it immediately so it doesn't appear during redeal
    const tableSprite = this.addCardToTable(card);
    this.layoutTable();

    // Only create Caída candidate if this is NOT the last play before redeal
    const isEndOfRoundPlay = (this.playsThisRound === this.numPlayers * 3 - 1);

    if (!isEndOfRoundPlay) {
      this.caidaCandidate = {
        value: card.value,
        ownerPlayer: this.currentPlayer,
        expiresOnTurn: this.turnNumber + 1,
        tableCardId: tableSprite.getData("tableCardId")
      };
    } else {
      this.caidaCandidate = null;
    }

    this.logMove(`${this.playerLabel(this.currentPlayer)}: jugó ${this.cardLabel(card)} → mesa`);

    this.endTurnAndMaybeDeal();
  }

  getCaidaPointsForValue(v) {
    if (v >= 1 && v <= 7) return 1;
    if (v === 10) return 2;
    if (v === 11) return 3;
    if (v === 12) return 4;
    return 0;
  }

  applyMesaLimpiaIfEligible(playerIndex) {
    const tableEmpty = this.tableCards.length === 0;

    if (!tableEmpty) return 0;

    // Exception: no mesa limpia points when deck is empty (last round condition)
    if (this.deck.length === 0) return 0;

    this.addPoints(playerIndex, this.MESA_LIMPIA_POINTS, "MESA LIMPIA");
    return this.MESA_LIMPIA_POINTS;
  }

  sweepTableToLastCapturerIfNeeded() {
    if (this.tableCards.length === 0) return 0;
    if (this.lastCapturer === null) return 0;

    const remaining = this.tableCards.length;

    // Add remaining table cards to that player's captured count
    this.captures[this.lastCapturer] += remaining;

    // Remove table sprites
    this.tableCards.forEach(s => s.destroy());
    this.tableCards = [];

    this.layoutTable?.();

    // Optional warning
    this.showWarning?.("LEVANTE FINAL");

    return remaining;
  }

  applyCaptureBonusPoints() {
    console.log("applyCaptureBonusPoints:", this.captures);

    if (this.teamMode) {
      // 4-player teams: combine captures per team, winner earns excess over 21
      const tA = (this.captures[0] ?? 0) + (this.captures[2] ?? 0);
      const tB = (this.captures[1] ?? 0) + (this.captures[3] ?? 0);
      console.log(`Team A captures: ${tA}, Team B captures: ${tB}`);
      if (tA === tB) { console.log("No bonus - tie"); return; }
      const winnerTeam = tA > tB ? 0 : 1;
      const bonus = Math.max(0, Math.max(tA, tB) - 21);
      if (bonus > 0) {
        console.log(`Awarding ${bonus} bonus points to Equipo ${winnerTeam === 0 ? "A" : "B"}`);
        // Pass a player index that belongs to the winning team; addPoints routes via teamOf
        this.addPoints(winnerTeam, bonus, `BONO EQ.${winnerTeam === 0 ? "A" : "B"} +${bonus}`);
      }
    } else if (this.numPlayers === 2) {
      // 2-player: only the majority holder earns bonus for excess over 21
      const c0 = this.captures[0] ?? 0;
      const c1 = this.captures[1] ?? 0;
      if (c0 === c1) { console.log("No bonus - tie"); return; }
      const winner = c0 > c1 ? 0 : 1;
      const bonus = Math.max(0, Math.max(c0, c1) - 21);
      if (bonus > 0) {
        console.log(`Awarding ${bonus} bonus points to Player ${winner + 1}`);
        this.addPoints(winner, bonus, `BONO +${bonus}`);
      }
    } else {
      // 3-player: each player independently earns bonus above their threshold
      for (let p = 0; p < this.numPlayers; p++) {
        const caught    = this.captures[p] ?? 0;
        const threshold = (p === this.dealerIndex) ? 14 : 13;
        const bonus     = Math.max(0, caught - threshold);
        console.log(`P${p + 1}: caught=${caught}, threshold=${threshold}, bonus=${bonus}`);
        if (bonus > 0) this.addPoints(p, bonus, `BONO +${bonus}`);
      }
    }
  }

  checkAndApplyCaida({ playerIndex, playedValue, capturedTableSprites }) {
    const c = this.caidaCandidate;
    if (!c) return 0;

    // Must be an opponent's dropped card (teammates cannot Caída each other)
    const sameTeam = this.teamMode
      ? this.teamOf(c.ownerPlayer) === this.teamOf(playerIndex)
      : c.ownerPlayer === playerIndex;
    if (sameTeam) return 0;

    // Must happen on the very next turn
    if (this.turnNumber !== c.expiresOnTurn) return 0;

    // Must play the matching value
    if (playedValue !== c.value) return 0;

    // Must actually capture THAT exact dropped table card
    if (!capturedTableSprites || capturedTableSprites.length === 0) return 0;

    const capturedCandidate = capturedTableSprites.some(
      (spr) => spr.getData("tableCardId") === c.tableCardId
    );

    if (!capturedCandidate) return 0;

    // Success: award points ONLY for the caída card value,
    // even if other consecutive cards were captured too
    const pts = this.getCaidaPointsForValue(c.value);
    this.addPoints(playerIndex, pts, "CAÍDA");

    // Consume the candidate
    this.caidaCandidate = null;

    return pts;
  }

  getLiftValuesFromTable(startValue) {
    // Returns a Set of values to lift: startValue, then consecutive values if present on table
    const present = new Set(this.tableCards.map(img => img.getData("card").value));

    // Must include the matching start value
    if (!present.has(startValue)) return new Set();

    const lift = new Set([startValue]);

    let pos = VALUE_ORDER.indexOf(startValue);
    if (pos === -1) return lift;

    while (true) {
      const next = VALUE_ORDER[pos + 1];
      if (next === undefined) break;
      if (!present.has(next)) break;

      lift.add(next);
      pos += 1;
    }

    return lift;
  }

  handleLift(handSprite, _targetIndex) {
    const played = handSprite.getData("card");
    const handIndex = handSprite.getData("handIndex");

    // Determine which values should be lifted
    const liftValues = this.getLiftValuesFromTable(played.value);

    // If the matching value isn't on the table, no lift
    if (!liftValues.has(played.value)) {
      this.snapBack(handSprite);
      return;
    }

    // Remove played card from hand
    this.hands[this.currentPlayer].splice(handIndex, 1);
    handSprite.destroy();

    // Collect table cards to remove
    const capturedTableSprites = [];
    const indicesToRemove = [];
    for (let i = 0; i < this.tableCards.length; i++) {
      const v = this.tableCards[i].getData("card").value;
      if (liftValues.has(v)) {
        indicesToRemove.push(i);
        capturedTableSprites.push(this.tableCards[i]);
      }
    }

    // Check for Caída bonus BEFORE removing cards
    this.checkAndApplyCaida({
      playerIndex: this.currentPlayer,
      playedValue: played.value,
      capturedTableSprites
    });

    // Collect log labels NOW — before sprites are destroyed and getData() stops working
    const capturedLabels = capturedTableSprites
      .map(s => this.cardLabel(s.getData("card")))
      .join("+");

    // Remove from highest index to lowest so splices don't shift earlier indices
    indicesToRemove.sort((a, b) => b - a);

    let removedCount = 0;
    for (const idx of indicesToRemove) {
      const [removed] = this.tableCards.splice(idx, 1);
      if (removed) {
        removed.destroy();
        removedCount += 1;
      }
    }

    // Score capture: lifted table cards + the played card
    this.captures[this.currentPlayer] += removedCount + 1;
    this.lastCapturer = this.currentPlayer;

    // Check for Mesa Limpia bonus (table cleared)
    const mesaPts = this.applyMesaLimpiaIfEligible(this.currentPlayer);
    if (mesaPts > 0) {
      console.log(`Mesa Limpia! Player ${this.currentPlayer + 1} gets +${mesaPts} points`);
    }

    // Re-layout table visually
    this.layoutTable();

    this.logMove(`${this.playerLabel(this.currentPlayer)}: capturó ${this.cardLabel(played)}+${capturedLabels}`);

    this.endTurnAndMaybeDeal();
  }

  update() {
    // Game loop - currently unused
  }
}
