# Game Log Playback

- Source: `tests/fixtures/game-log-reports/issue-34-pre-auto-arm.json`
- Game ID: `ff160c45-4000-4f24-93e4-f6bcb51be877`
- Generated: 2026-03-20T03:38:04.724Z
- Move captures: 6
- Interesting actions: 17
- Capture armed: false

## Summary

```json
{
  "summary": {
    "gameState": "running",
    "activePlayer": "white",
    "winner": null,
    "moveCaptureCount": 6,
    "connectionStatus": "offline",
    "cameraUrl": "http://chesscam.local",
    "layoutMode": "opposing"
  },
  "currentMoveCaptureDiagnostics": null
}
```

## Timeline

- 2026-03-20T03:36:46.776Z `game/clockTapped` player=`white`
- 2026-03-20T03:36:53.717Z `game/clockTapped` player=`black`
- 2026-03-20T03:36:58.436Z `game/clockTapped` player=`white`
- 2026-03-20T03:37:02.426Z `game/clockTapped` player=`white`
- 2026-03-20T03:37:04.169Z `game/clockTapped` player=`black`
- 2026-03-20T03:37:04.935Z `game/moveCompletionCommitted` move=1 acceptedAfterMs=2040 changed=[12, 20, 35, 36, 51, 52] occupied=32
- 2026-03-20T03:37:11.006Z `game/moveCompletionCommitted` move=2 acceptedAfterMs=2009 changed=[11, 27] occupied=32
- 2026-03-20T03:37:11.391Z `game/clockTapped` player=`white`
- 2026-03-20T03:37:25.494Z `game/clockTapped` player=`black`
- 2026-03-20T03:37:27.115Z `game/moveCompletionCommitted` move=3 acceptedAfterMs=2011 changed=[42, 57] occupied=32
- 2026-03-20T03:37:35.158Z `game/moveCompletionCommitted` move=4 acceptedAfterMs=2012 changed=[10, 26] occupied=32
- 2026-03-20T03:37:36.162Z `game/clockTapped` player=`white`
- 2026-03-20T03:37:46.452Z `game/clockTapped` player=`black`
- 2026-03-20T03:37:48.205Z `game/moveCompletionCommitted` move=5 acceptedAfterMs=2010 changed=[45, 62] occupied=32
- 2026-03-20T03:37:51.736Z `game/clockTapped` player=`white`
- 2026-03-20T03:37:53.236Z `game/moveCompletionCommitted` move=6 acceptedAfterMs=2004 changed=[1, 18] occupied=32
- 2026-03-20T03:37:58.262Z `game/clockTapped` player=`black`

## Captured Moves

### Move 1

- Captured: 2026-03-20T03:37:04.931Z
- Accepted after: 2040ms / 3 samples
- Changed squares: 12, 20, 35, 36, 51, 52
- Occupied squares after move: 32

Before:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B B B B B B B
6 . . . . . . . .
5 . . . . . . . .
4 . . . . . . . .
3 . . . . . . . .
2 W W W W W W W W
1 W W W W W W W W
```

After:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B B B . B B B
6 . . . . B . . .
5 . . . . . . . .
4 . . . W W . . .
3 . . . . . . . .
2 W W W . . W W W
1 W W W W W W W W
```

### Move 2

- Captured: 2026-03-20T03:37:11.003Z
- Accepted after: 2009ms / 3 samples
- Changed squares: 11, 27
- Occupied squares after move: 32

Before:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B B B . B B B
6 . . . . B . . .
5 . . . . . . . .
4 . . . W W . . .
3 . . . . . . . .
2 W W W . . W W W
1 W W W W W W W W
```

After:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B B . . B B B
6 . . . . B . . .
5 . . . B . . . .
4 . . . W W . . .
3 . . . . . . . .
2 W W W . . W W W
1 W W W W W W W W
```

### Move 3

- Captured: 2026-03-20T03:37:27.112Z
- Accepted after: 2011ms / 3 samples
- Changed squares: 42, 57
- Occupied squares after move: 32

Before:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B B . . B B B
6 . . . . B . . .
5 . . . B . . . .
4 . . . W W . . .
3 . . . . . . . .
2 W W W . . W W W
1 W W W W W W W W
```

After:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B B . . B B B
6 . . . . B . . .
5 . . . B . . . .
4 . . . W W . . .
3 . . W . . . . .
2 W W W . . W W W
1 W . W W W W W W
```

### Move 4

- Captured: 2026-03-20T03:37:35.155Z
- Accepted after: 2012ms / 3 samples
- Changed squares: 10, 26
- Occupied squares after move: 32

Before:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B B . . B B B
6 . . . . B . . .
5 . . . B . . . .
4 . . . W W . . .
3 . . W . . . . .
2 W W W . . W W W
1 W . W W W W W W
```

After:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B . . . B B B
6 . . . . B . . .
5 . . B B . . . .
4 . . . W W . . .
3 . . W . . . . .
2 W W W . . W W W
1 W . W W W W W W
```

### Move 5

- Captured: 2026-03-20T03:37:48.202Z
- Accepted after: 2010ms / 3 samples
- Changed squares: 45, 62
- Occupied squares after move: 32

Before:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B . . . B B B
6 . . . . B . . .
5 . . B B . . . .
4 . . . W W . . .
3 . . W . . . . .
2 W W W . . W W W
1 W . W W W W W W
```

After:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B . . . B B B
6 . . . . B . . .
5 . . B B . . . .
4 . . . W W . . .
3 . . W . . W . .
2 W W W . . W W W
1 W . W W W W . W
```

### Move 6

- Captured: 2026-03-20T03:37:53.233Z
- Accepted after: 2004ms / 3 samples
- Changed squares: 1, 18
- Occupied squares after move: 32

Before:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B . . . B B B
6 . . . . B . . .
5 . . B B . . . .
4 . . . W W . . .
3 . . W . . W . .
2 W W W . . W W W
1 W . W W W W . W
```

After:

```text
  a b c d e f g h
8 B . B B B B B B
7 B B . . . B B B
6 . . B . B . . .
5 . . B B . . . .
4 . . . W W . . .
3 . . W . . W . .
2 W W W . . W W W
1 W . W W W W . W
```

