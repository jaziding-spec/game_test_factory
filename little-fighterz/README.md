# Little Fighterz

A tiny tribute to **Little Fighter 2** — a 2.5D side-scrolling brawler in a single
HTML page. Pure vanilla JavaScript + canvas: no assets, no build step, no
dependencies. All graphics are drawn procedurally and all sounds are synthesized
with WebAudio.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## Modes

| Mode | Description |
|------|-------------|
| Stage Mode | Fight 5 waves of AI enemies, ending with a boss (1 player) |
| Stage Mode Co-op | Same, but with 2 players on one keyboard |
| VS CPU | One-on-one duel against the computer |
| VS 2P | Local one-on-one duel |

## Controls

|  | Player 1 | Player 2 |
|---|---|---|
| Move | `W` `A` `S` `D` | arrow keys |
| Run | double-tap left/right | double-tap left/right |
| Attack | `J` | `,` |
| Jump | `K` | `.` |
| Defend | `L` | `/` |
| Pause | `P` | `P` |

Like LF2, the arena has depth — up/down moves you into and out of the screen,
and attacks only connect when you're roughly on the same depth line.

### Moves

- **Punch chain** — press attack repeatedly: jab → cross → knockdown kick
- **Run attack** — attack while running: flying kick (knocks down)
- **Jump attack** — attack in the air
- **Defend** — blocks most damage from attacks in front of you
- **Specials** — LF2-style command inputs, tapped in sequence (uses MP, which
  regenerates over time):
  - `Defend` `→` `Attack` — skill 1 (projectile)
  - `Defend` `↓` `Attack` — skill 2

## Characters

| Fighter | Skill 1 (D > A) | Skill 2 (D v A) |
|---|---|---|
| **BLAZE** | Fireball | Inferno — close-range AoE burst |
| **FROST** | Ice Bolt — freezes the target | Ice Storm — triple bolt spread |
| **VOLT** | Lightning — fast projectile | Thunder Dash — damaging charge |

Frozen enemies can't act; hitting them shatters the ice for bonus damage.
Defeated enemies in Stage Mode sometimes drop milk (HP) or soda (MP).

## Ideas / roadmap

- Throwable weapons and items (bottles, bats, stones)
- More characters and a hidden-character unlock
- Grab/throw mechanics
- Online or gamepad support
