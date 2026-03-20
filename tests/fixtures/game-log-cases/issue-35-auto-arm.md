# Game Log Playback

- Source: `tests/fixtures/game-log-reports/issue-35-auto-arm.json`
- Game ID: `ff160c45-4000-4f24-93e4-f6bcb51be877`
- Generated: 2026-03-20T03:43:37.998Z
- Move captures: 3
- Interesting actions: 59
- Capture armed: true

## Summary

```json
{
  "summary": {
    "gameState": "idle",
    "activePlayer": null,
    "winner": null,
    "moveCaptureCount": 3,
    "connectionStatus": "offline",
    "cameraUrl": "http://chesscam.local",
    "layoutMode": "opposing",
    "moveCaptureArmed": true
  },
  "currentMoveCaptureDiagnostics": {
    "state": "stable",
    "stableSampleCount": 1,
    "changedSquareIndices": [],
    "occupiedPieceCount": 32,
    "whitePieceCount": 16,
    "blackPieceCount": 16,
    "reason": "matches-last-accepted",
    "lastSampleAtMs": 1773978217344
  }
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
- 2026-03-20T03:38:05.545Z `game/moveCompletionCommitted` move=7 acceptedAfterMs=2261 changed=[8, 16, 25, 61] occupied=32
- 2026-03-20T03:42:16.392Z `game/moveCaptureStateUpdated` state=`idle` reason=`awaiting-initial-setup` changed=[none] stableSamples=0
- 2026-03-20T03:42:44.531Z `game/moveCaptureStateUpdated` state=`idle` reason=`awaiting-initial-setup-confirmation` changed=[none] stableSamples=1
- 2026-03-20T03:42:46.641Z `game/moveCaptureArmedChanged` armed=`true` activatedAtMs=1773978166641
- 2026-03-20T03:42:46.641Z `game/moveCaptureStateUpdated` state=`stable` reason=`seeded-stable-baseline` changed=[none] stableSamples=1
- 2026-03-20T03:42:47.722Z `game/moveCaptureStateUpdated` state=`stable` reason=`matches-last-accepted` changed=[none] stableSamples=1
- 2026-03-20T03:42:55.338Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[16, 32] stableSamples=0
- 2026-03-20T03:42:56.427Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`new-candidate-fingerprint` changed=[16, 32, 40, 41, 42, 43, 48, 50, 56] stableSamples=1
- 2026-03-20T03:42:57.503Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[16, 25, 26, 28, 32, 33, 34, 35, 36, 40, 41, 48, 52] stableSamples=0
- 2026-03-20T03:42:58.571Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`new-candidate-fingerprint` changed=[16, 32, 36, 52] stableSamples=1
- 2026-03-20T03:42:59.648Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[16, 36, 52] stableSamples=0
- 2026-03-20T03:43:00.722Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`candidate-stabilizing` changed=[16, 36, 52] stableSamples=2
- 2026-03-20T03:43:01.806Z `game/moveCaptureStateUpdated` state=`capture_committed` reason=`move-completion-committed` changed=[16, 36, 52] stableSamples=3
- 2026-03-20T03:43:01.810Z `game/moveCompletionCommitted` move=1 acceptedAfterMs=2158 changed=[16, 36, 52] occupied=33
- 2026-03-20T03:43:02.884Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[32] stableSamples=0
- 2026-03-20T03:43:03.961Z `game/moveCaptureStateUpdated` state=`stable` reason=`matches-last-accepted` changed=[none] stableSamples=1
- 2026-03-20T03:43:06.115Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[32] stableSamples=0
- 2026-03-20T03:43:07.196Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`candidate-stabilizing` changed=[32] stableSamples=2
- 2026-03-20T03:43:08.281Z `game/moveCaptureStateUpdated` state=`stable` reason=`matches-last-accepted` changed=[none] stableSamples=1
- 2026-03-20T03:43:13.657Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[32] stableSamples=0
- 2026-03-20T03:43:14.726Z `game/moveCaptureStateUpdated` state=`stable` reason=`matches-last-accepted` changed=[none] stableSamples=1
- 2026-03-20T03:43:15.791Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[32] stableSamples=0
- 2026-03-20T03:43:16.869Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`new-candidate-fingerprint` changed=[10, 16, 17, 18, 24] stableSamples=1
- 2026-03-20T03:43:17.948Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[12, 16, 17, 20, 25, 32] stableSamples=0
- 2026-03-20T03:43:19.020Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`new-candidate-fingerprint` changed=[12, 20] stableSamples=1
- 2026-03-20T03:43:20.098Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[12, 16, 20, 32] stableSamples=0
- 2026-03-20T03:43:21.177Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`new-candidate-fingerprint` changed=[12, 16, 20] stableSamples=1
- 2026-03-20T03:43:22.261Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`candidate-stabilizing` changed=[12, 16, 20] stableSamples=2
- 2026-03-20T03:43:23.338Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[12, 16, 20, 40, 41, 42, 43, 48, 50] stableSamples=0
- 2026-03-20T03:43:24.426Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`new-candidate-fingerprint` changed=[12, 16, 20, 32, 33, 35, 40, 51] stableSamples=1
- 2026-03-20T03:43:25.510Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[12, 16, 20, 35, 51] stableSamples=0
- 2026-03-20T03:43:26.589Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`candidate-stabilizing` changed=[12, 16, 20, 35, 51] stableSamples=2
- 2026-03-20T03:43:27.653Z `game/moveCaptureStateUpdated` state=`capture_committed` reason=`move-completion-committed` changed=[12, 16, 20, 35, 51] stableSamples=3
- 2026-03-20T03:43:27.657Z `game/moveCompletionCommitted` move=2 acceptedAfterMs=2143 changed=[12, 16, 20, 35, 51] occupied=32
- 2026-03-20T03:43:28.729Z `game/moveCaptureStateUpdated` state=`stable` reason=`matches-last-accepted` changed=[none] stableSamples=1
- 2026-03-20T03:43:31.945Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[16, 17, 18, 24] stableSamples=0
- 2026-03-20T03:43:33.020Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`new-candidate-fingerprint` changed=[11, 16, 27, 32] stableSamples=1
- 2026-03-20T03:43:34.091Z `game/moveCaptureStateUpdated` state=`transitioning` reason=`transition-detected` changed=[11, 27] stableSamples=0
- 2026-03-20T03:43:35.171Z `game/moveCaptureStateUpdated` state=`candidate_stable` reason=`candidate-stabilizing` changed=[11, 27] stableSamples=2
- 2026-03-20T03:43:36.256Z `game/moveCaptureStateUpdated` state=`capture_committed` reason=`move-completion-committed` changed=[11, 27] stableSamples=3
- 2026-03-20T03:43:36.259Z `game/moveCompletionCommitted` move=3 acceptedAfterMs=2164 changed=[11, 27] occupied=32
- 2026-03-20T03:43:37.344Z `game/moveCaptureStateUpdated` state=`stable` reason=`matches-last-accepted` changed=[none] stableSamples=1

## Captured Moves

### Move 1

- Captured: 2026-03-20T03:43:01.806Z
- Accepted after: 2158ms / 3 samples
- Changed squares: 16, 36, 52
- Occupied squares after move: 33

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
7 B B B B B B B B
6 W . . . . . . .
5 . . . . . . . .
4 . . . . W . . .
3 . . . . . . . .
2 W W W W . W W W
1 W W W W W W W W
```

### Move 2

- Captured: 2026-03-20T03:43:27.653Z
- Accepted after: 2143ms / 3 samples
- Changed squares: 12, 16, 20, 35, 51
- Occupied squares after move: 32

Before:

```text
  a b c d e f g h
8 B B B B B B B B
7 B B B B B B B B
6 W . . . . . . .
5 . . . . . . . .
4 . . . . W . . .
3 . . . . . . . .
2 W W W W . W W W
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

### Move 3

- Captured: 2026-03-20T03:43:36.255Z
- Accepted after: 2164ms / 3 samples
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

