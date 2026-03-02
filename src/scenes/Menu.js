export class Menu extends Phaser.Scene {
  constructor() {
    super("Menu");
  }

  // ---------- PRELOAD ----------
  preload() {
    this.load.image("menu_bg", "Public/assets/caida table basic.png");
  }

  // ---------- CREATE ----------
  create() {
    this.cameras.main.setBackgroundColor("#0b0f14");

    // Background — rotate 90° so the landscape image fills the portrait canvas exactly
    const bg = this.add.image(this.scale.width / 2, this.scale.height / 2, "menu_bg");
    bg.setOrigin(0.5);
    bg.setDepth(-1000);
    bg.setAngle(90);
    bg.setDisplaySize(this.scale.height, this.scale.width);
    bg.setAlpha(0.45);

    // Dark overlay
    this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0x000000,
      0.45
    ).setDepth(-999);

    const cx = this.scale.width / 2;

    // Title
    const title = this.add.text(
      cx,
      this.scale.height * 0.20,
      "Caída\nVenezolana",
      { fontFamily: "monospace", fontSize: "72px", color: "#ffffff", align: "center" }
    )
      .setOrigin(0.5)
      .setDepth(10)
      .setAlpha(0);

    // Subtitle
    const subtitle = this.add.text(
      cx,
      this.scale.height * 0.34,
      "Juego de cartas venezolano",
      { fontFamily: "monospace", fontSize: "24px", color: "#ffffff", align: "center" }
    )
      .setOrigin(0.5)
      .setDepth(10)
      .setAlpha(0);

    // Player count label
    const modeLabel = this.add.text(
      cx,
      this.scale.height * 0.50,
      "Selecciona el modo de juego",
      { fontFamily: "monospace", fontSize: "22px", color: "#ffffff", align: "center" }
    )
      .setOrigin(0.5)
      .setDepth(10)
      .setAlpha(0);

    // Buttons stacked vertically — portrait layout
    const btnAI = this.makeButton(cx, this.scale.height * 0.52, "vs IA",           () => this.startGame("ai"));
    const btn2  = this.makeButton(cx, this.scale.height * 0.63, "2 JUGADORES",     () => this.startGame(2));
    const btn3  = this.makeButton(cx, this.scale.height * 0.74, "3 JUGADORES",     () => this.startGame(3));
    const btn4  = this.makeButton(cx, this.scale.height * 0.85, "2 vs 2 EQUIPOS",  () => this.startGame(4));

    // Fade everything in
    const targets = [title, subtitle, modeLabel,
      btnAI.rect, btnAI.text,
      btn2.rect, btn2.text,
      btn3.rect, btn3.text,
      btn4.rect, btn4.text];
    this.tweens.add({
      targets,
      alpha: 1,
      duration: 800,
      ease: "Cubic.easeOut",
      delay: 200
    });
  }

  makeButton(x, y, label, onClick) {
    const rect = this.add.rectangle(x, y, 500, 95, 0x000000, 0.80)
      .setStrokeStyle(2, 0xffffff, 0.50)
      .setDepth(11)
      .setAlpha(0)
      .setInteractive({ useHandCursor: true });

    const text = this.add.text(x, y, label, {
      fontFamily: "monospace", fontSize: "28px", color: "#ffffff", align: "center"
    })
      .setOrigin(0.5)
      .setDepth(12)
      .setAlpha(0);

    rect.on("pointerover", () => rect.setStrokeStyle(3, 0xffffff, 0.90));
    rect.on("pointerout",  () => rect.setStrokeStyle(2, 0xffffff, 0.50));

    rect.on("pointerdown", () => {
      this.tweens.add({
        targets: [rect, text],
        alpha: 0,
        duration: 200,
        ease: "Sine.Out",
        onComplete: onClick
      });
    });

    return { rect, text };
  }

  startGame(mode) {
    if (mode === "ai") {
      this.scene.start("Start", { numPlayers: 2, aiPlayers: [1] });
    } else {
      this.scene.start("Start", { numPlayers: mode });
    }
  }
}
