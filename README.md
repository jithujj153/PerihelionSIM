# PERIHELION 3D simulator

Team Hyperhelix. A live simulation of the system on a model of the Gandhamardan-B mine.

## Open it

1. Double-click **PERIHELION-simulator.html**. Use Chrome or Edge.
2. Wait a few seconds while the site is built.
3. Press **F11** for full screen.

It is one file. It needs no internet and no installation.

## Before the demo (Asus TUF)

- Plug in the charger and set Windows power mode to **Best performance**.
- Windows Settings > System > Display > Graphics: set Chrome (or Edge) to **High performance**, so it uses the dedicated graphics card.
- The small number at the top left is the frame rate. 40 or more looks smooth.
- If it is low, choose **Quality: Medium** or **Low**. On "auto" it steps down by itself.
- Run the whole story once on the TUF and once on the ThinkPad. The frame rate has not been measured on either.

## Controls

| Key | What it does |
|---|---|
| Space | Play or pause. Use it whenever you want to talk. |
| Right / Left arrow | Next or previous act (works with most presentation clickers) |
| 1 to 8 | Jump to an act |
| A, then B | Officer A and Officer B approve |
| I | Ignore the recommendation |
| V | Switch view: Vendor's paper, System's evidence, What actually happened |
| C | Change camera |
| N | Sneak a truck in through the open boundary |
| H | Hide the screens for a clean picture |
| Drag, scroll | Fly the camera yourself. Pick "Auto director" to hand it back. |
| Click | A truck, gate or pile |

**Pace** (top bar): *story* leaves room to talk, *quick* suits a shorter slot.

The simulation stops by itself when a decision needs two officers.

## Run sheet (12 minutes)

| Time | Act | What happens | What you do | One line to say |
|---|---|---|---|---|
| 0:00 | 1 Arrival | Fly-over, then the view turns to the Vendor's paper | Talk | "Today the only record belongs to the people being checked." |
| 0:30 | 2 The net | Layers appear one by one | Talk | "None of these belongs to the Vendor." |
| 1:45 | 3 Honest trip | Truck 1 enters, loads, leaves, is weighed at the destination | Pause at the first gate to explain the four checks | "An honest truck never waits for a person." |
| 3:15 | 4 Three cheats | Swap stopped, short dispatch note caught, cloned plate refused, tower sees it | Press **A** then **B** to send the drone | "The AI advises. Two officers decide." |
| 6:45 | 5 Open boundary | A truck drives in where there is no fence. A drone round counts one too many | Press **A** then **B** | "Round times are secret and different every hour." |
| 8:15 | 6 The pile | Stockpile scan balances | Click **What if the officers had ignored the advice?** | "Ore taken without a record shows in the pile." |
| 9:15 | 7 Be the Vendor | The panel picks an attack | Click the attack they name | "Try to cheat it." |
| 11:00 | 8 Verdict | Six questions, evidence pack, cost, next step | Close | "Expert review, then a pilot on one gate." |

The animation itself takes about 5 minutes at story pace, before act 7. The rest of the slot is your talking, pauses and the panel's turn.

### Five-minute version

Act 1 (skip ahead after the paper view) > act 3 (pause once at the gate) > act 4 > act 6 with the "what if" replay > act 8. Choose **Pace: quick**.

Acts 3 to 6 stop where the next one begins, so you can talk as long as you like and miss nothing.

If you skip ahead to act 6, 7 or 8 before deciding on the drone advice about the cloned truck, it counts as ignored, so the pile shows missing ore. Decisions you have already made are kept.

## Act 7: good attacks for a live panel

| Fast (a few seconds) | Slower (explain while it runs) |
|---|---|
| Open the device box | Pick up ore on the road (about 15 s) |
| Cut truck power | Move device to another truck (about 20 s) |
| Enter twice | Never reach destination (about 1.5 min) |
| Fake the position | Shave 1.2 t off every note (about 1.5 min) |
| Fake device, jam the device, tower off | Sneak a truck in (about 2 min, waits for a drone round) |

- "Device understates load" and "Leave loaded by G2" need a truck that has loaded and not yet left. The menu says so if pressed early.
- **Quick run between counts** can escape. It is there on purpose to show the limit of random counting. In this simulation that truck takes no ore.
- **Log tab:** "Quietly edit one entry", then "Check the log". Then try "Edit and rewrite the chain". Press **Undo the tampering** before act 8.

## What is real and what is assumed

Say this openly if asked.

- **Sourced:** quarry and dump footprints and levels, lease area and area in use (IBM inspection report, June 2024). Costs and pilot plan are the deck's estimates.
- **Assumed:** gate, road, tower and zone positions; sensor noise; radio range; drone camera width and flight time; permit limits (250 t, 15 trips, 26 vehicles, 480 minutes).
- **Drawn for visibility:** trucks and gates about twice life size; the change in pile shape is exaggerated; time runs faster than real time.
- **Simplified:** the "AI" is a set of readable rules, shown under "why". The device signs with a shared key (HMAC-SHA256); a real device would use a public-key signature in a secure chip. A vehicle followed by a drone is assumed to leave.
- **Drone rounds:** exactly two per hour. A truck that a gate, checkpoint, buried pad or tower confirmed during the round counts as accounted for. A "fewer than the log" alert is raised only if a missing truck's device is silent or it is missed twice.
- **Not shown yet:** haul trucks, the quarry drone survey, radar as a delayed check, night view.

## Source (for changes)

The `source` folder holds the code. It needs Node.js 20 or later and, once, internet access:

```
cd source
npm install
npm run build
npm test
```

The new file appears at `source/dist/PERIHELION-simulator.html`.

Includes three.js (MIT licence).
