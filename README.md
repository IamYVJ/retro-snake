# Retro Snake

A polished, retro-styled **Snake** game inspired by the classic monochrome
keypad-phone games — built with **vanilla HTML, CSS, and JavaScript**. No
frameworks, no build step, no dependencies, and no external assets. Just open
`index.html` and play.

> The look is an original homage: a generic green-on-grey "LCD" handheld. It
> uses no Nokia logos, trademarks, or copyrighted assets.

[Play Now](http://iamyvj.github.io/retro-snake)

## Features

- Classic grid-based Snake on an HTML `<canvas>`.
- Keyboard controls: **arrow keys** and **WASD**.
- Mobile controls: **swipe** anywhere on the board, or use the **on-screen D-pad**.
- Smart input buffering that **prevents accidental reverse-into-yourself** moves.
- **Pause / resume** (Space, `P`, or the centre pad button) — also auto-pauses
  when you switch tabs.
- **Score** and **best score**, with the best score saved in `localStorage`.
- **Start** screen and **Game Over** screen with a one-tap restart.
- Gradually increasing speed for a rising difficulty curve.
- Fully **responsive**, centred layout that works on desktop and mobile.
- Crisp pixel scaling and a nostalgic monochrome phone-screen aesthetic.
- Arrow keys **don't scroll the page**, and swipes **don't drag the page**.

## Controls

| Action            | Desktop                | Mobile                          |
| ----------------- | ---------------------- | ------------------------------- |
| Move              | Arrow keys / WASD      | Swipe on the board, or the D-pad |
| Pause / resume    | Space or `P`           | Centre pad button (`II`)        |
| Start / play again| Enter, or the button   | Tap the button                  |

## Customising the game

All the tunable settings live in the `CONFIG` object at the top of
[`script.js`](script.js):

| Setting        | What it does                                            |
| -------------- | ------------------------------------------------------- |
| `cols`, `rows` | Grid dimensions (number of cells).                      |
| `cellSize`     | Pixel size of each cell (sets the canvas resolution).   |
| `stepMs`       | Starting move interval in ms (lower = faster).          |
| `minStepMs`    | Speed cap — the fastest the snake can get.              |
| `speedUpEvery` | Speed up after eating this many foods (`0` disables it).|
| `speedUpBy`    | Milliseconds removed from the interval per speed-up.    |
| `wrap`         | `true` to pass through walls instead of dying.          |
| `colors`       | Board, snake, and food colours.                         |
| `storageKey`   | `localStorage` key used for the best score.             |

The colour theme is mirrored in CSS custom properties at the top of
[`style.css`](style.css) — keep `--lcd-bg` in sync with
`CONFIG.colors.background` so the board and its frame match.

## Project structure

```
retro-snake/
├── index.html   # markup: screen, canvas, overlays, on-screen controls
├── style.css    # retro LCD-phone styling, responsive layout
├── script.js    # game loop, input handling, rendering (one IIFE module)
└── README.md
```

## Suggested repository names

`retro-snake` · `pixel-snake` · `lcd-snake` · `nokia-style-snake`

## License

Released under the [MIT License](LICENSE).
