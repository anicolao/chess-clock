# Chess Move Identification Script

This script uses Google's Gemini 1.5 Flash model to identify chess positions and moves from images.

## Prerequisites

- [Bun](https://bun.sh/) installed on your machine.
- A Google Gemini API Key. You can obtain one from [Google AI Studio](https://aistudio.google.com/).

## Installation

```bash
bun install @google/generative-ai
```

## Usage

Set your API key in your environment:

```bash
export GEMINI_API_KEY='your-api-key-here'
```

### Identify a Position (Single Image)

To get the board position in JSON format:

```bash
bun moves.ts tests/images/game_start.jpg
```

**Output Example:**
```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "position": [
    ["r", "n", "b", "q", "k", "b", "n", "r"],
    ["p", "p", "p", "p", "p", "p", "p", "p"],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["P", "P", "P", "P", "P", "P", "P", "P"],
    ["R", "N", "B", "Q", "K", "B", "N", "R"]
  ]
}
```

### Identify a Move (Two Images)

To identify the move made between two consecutive positions:

```bash
bun moves.ts tests/images/game_start.jpg tests/images/e4.jpg
```

**Output Example:**
```json
{
  "move": "e2e4",
  "san": "e4"
}
```

## Note

The script outputs ONLY JSON. If there is an error, it will return a JSON object with an `error` property.
