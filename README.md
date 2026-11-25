# PERIHELION: 3D Simulator

**Independent monitoring of mine extraction and movement**
Team Hyperhelix

An interactive 3D simulation of the PERIHELION system, set on a model of the Gandhamardan-B iron ore mine. It shows how a Governing Body can measure, check and record what leaves a mine without relying on the Vendor's own records.

## Features

- A guided story in eight acts, from the first fly-over to the final verdict
- Three views of the same events: **Vendor's paper**, **System's evidence** and **What actually happened**
- Automated gates, buried weighing, timed checkpoints, LiDAR towers and drone counting rounds
- Two-officer approval for actions beyond routine gate decisions
- A tamper-evident log built on SHA-256 hashes
- A "Be the Vendor" mode in which the audience chooses an attack
- Runs offline in a web browser from a single HTML file

## Getting started

### Prerequisites

| Software | Needed for |
|---|---|
| Google Chrome or Microsoft Edge (current version, hardware acceleration on) | Running the simulator |
| [Git](https://git-scm.com/downloads) | Cloning the repository |
| [Node.js](https://nodejs.org/) 20 or later | Building from source only |

### 1. Clone the repository

```bash
git clone https://github.com/jithujj153/PerihelionSIM.git
cd PerihelionSIM
```

If you do not use Git, choose **Code > Download ZIP** on the repository page and extract the archive. A private repository requires an account with access.

### 2. Run the simulator

No installation or build is needed. Open `PERIHELION-simulator.html` in Chrome or Edge:

| System | Command |
|---|---|
| Windows (PowerShell) | `start .\PERIHELION-simulator.html` |
| macOS | `open PERIHELION-simulator.html` |
| Linux | `xdg-open PERIHELION-simulator.html` |

You can also double-click the file. If it opens in another browser, right-click it and choose **Open with**.

Wait a few seconds while the site is built, then press **F11** for full screen. To start the story again from the beginning, press **1** or reload the page.

## Building from source

This step is only needed if you change the code. The first command downloads the dependencies and requires an internet connection.

```bash
cd source
npm install
npm run build
```

The build writes `source/dist/PERIHELION-simulator.html`. Open that file to check your changes.

| Command | Purpose |
|---|---|
| `npm run build` | Build the single-file simulator |
| `npm test` | Run the attack checks and the drone round coverage test |
| `npm run typecheck` | Check TypeScript types |

To publish a new build, copy it to the repository root:

```bash
cp dist/PERIHELION-simulator.html ..
```

## Project structure

```
PerihelionSIM/
├── PERIHELION-simulator.html   Ready-to-run simulator
├── README.md
└── source/
    ├── src/
    │   ├── engine/             Simulation, decision rules, drone scheduling, log
    │   ├── view/               3D scene, terrain, models, cameras
    │   ├── ui/                 Panels, story acts, styles
    │   ├── index.html
    │   └── main.ts
    ├── test/                   Automated checks
    ├── build.mjs               Bundler script
    ├── make.mjs                Produces the single HTML file
    └── package.json
```

Built with TypeScript, [Three.js](https://threejs.org) and esbuild. The decision rules receive only sensor readings and never the simulated truth.

## Controls

| Input | Action |
|---|---|
| `Space` | Play or pause |
| `→` / `←` | Next or previous act (also Page Down / Page Up) |
| `1` to `8` | Jump to an act |
| `A`, then `B` | Officer A and Officer B approve a recommendation |
| `I` | Ignore a recommendation |
| `V` | Change view |
| `C` | Change camera |
| `N` | Send an unregistered truck through the open boundary |
| `H` | Hide or show the panels |
| `Esc` | Close a dialog |
| Drag, scroll | Move the camera freely (choose **Auto director** to return) |
| Click | Inspect a truck, gate or stockpile |

**Pace** (top bar): *story* leaves time for narration; *quick* suits a shorter slot. The simulation pauses whenever a decision needs two officers.

## Presentation guide

### Twelve-minute run sheet

| Time | Act | What happens | Presenter action | Key message |
|---|---|---|---|---|
| 0:00 | 1. Arrival | Fly-over, then the Vendor's paper view | Introduce the problem | Today the only record belongs to the party being checked. |
| 0:30 | 2. The net | Monitoring layers appear one by one | Explain the layers | None of them belongs to the Vendor. |
| 1:45 | 3. Honest trip | A truck enters, loads, leaves and is weighed at its destination | Pause at the first gate to explain the checks | An honest truck never waits for a person. |
| 3:15 | 4. Three cheats | A truck swap, a short dispatch note and a cloned number plate are caught | Press `A`, then `B` | The AI advises; two officers decide. |
| 6:45 | 5. Open boundary | A truck enters where there is no fence and a drone round counts one too many | Press `A`, then `B` | Round times are secret and change every hour. |
| 8:15 | 6. The pile | The stockpile scan balances, then a replay shows the loss if advice is ignored | Click **What if the officers had ignored the advice?** | Ore taken without a record shows in the stockpile. |
| 9:15 | 7. Be the Vendor | The panel chooses an attack | Run the chosen attack | Invite the panel to test the system. |
| 11:00 | 8. Verdict | Six questions, evidence pack, cost and next step | Close the presentation | Expert review first, then a pilot on one gate. |

The animation takes about five minutes before act 7 at story pace. The remaining time is for narration, pauses and the panel.

### Five-minute version

Choose **Pace: quick**. Show act 1 up to the paper view, then act 3, act 4, act 6 with the "what if" replay, and act 8.

Acts 3 to 6 stop where the next act begins. If you skip ahead to act 6, 7 or 8 before deciding on the drone advice about the cloned truck, the advice counts as ignored and the stockpile shows missing ore. Decisions already made are kept.

### Attacks for act 7

| Detected within seconds | Takes longer |
|---|---|
| Open the device box | Pick up ore on the road (about 15 s) |
| Cut truck power | Move device to another truck (about 20 s) |
| Enter twice | Never reach destination (about 1.5 min) |
| Fake the position | Shave 1.2 t off every note (about 1.5 min) |
| Fake device, jam the device, tower off | Sneak a truck in (about 2 min, needs a drone round) |

- **Device understates load** and **Leave loaded by G2** need a truck that has loaded and has not yet left.
- **Quick run between counts** can escape detection. It is included to show the limit of random counting. In this simulation that truck takes no ore.
- In the **Log** tab, use **Quietly edit one entry**, then **Check the log**. Repeat with **Edit and rewrite the chain**. Select **Undo the tampering** before act 8.

## Troubleshooting

| Problem | What to do |
|---|---|
| "The 3D view could not start" | Use a current Chrome or Edge and switch on hardware acceleration in the browser settings. |
| Movement is not smooth | Connect the charger, use the best-performance power mode, assign the browser to the high-performance graphics processor if there is one, or set **Quality** to Medium or Low. The frame rate is shown at the top left. |
| PowerShell blocks `npm` | Use `npm.cmd` in place of `npm`. |
| `git clone` is refused | Sign in with a GitHub account that has access to the repository. |

## Assumptions and limitations

| Area | Status |
|---|---|
| Quarry and dump footprints and levels, lease area and area in use | Taken from the IBM inspection report, June 2024 |
| Costs and pilot plan | Estimates from the project proposal |
| Gate, road, tower and zone positions; sensor noise; radio range; drone camera width and flight time; radar delay | Assumed |
| Permit limits | Demonstration values: 250 t, 15 trips, 26 vehicles, 480 minutes |
| Scale | Trucks and gates are about twice life size, pile shape changes are exaggerated and time runs faster than real time |
| Control-room AI | A set of readable rules, each shown under "why" |
| Device signature | Shared key (HMAC-SHA256). A real device would use a public-key signature in a secure chip. |
| Drone follow | A followed vehicle is assumed to leave |
| Drone rounds | Exactly two per hour. A truck confirmed by a fixed sensor during a round counts as accounted for. A "fewer than the log" alert needs a silent device or two misses. |
| Not yet included | Haul trucks, quarry drone survey, radar as a delayed check, night view |

## Acknowledgements

Includes [Three.js](https://threejs.org) (MIT licence).
