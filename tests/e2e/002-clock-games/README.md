# Test: Game without increment

## Clock loaded in idle state

![Clock loaded in idle state](./screenshots/000-01-initial-state.png)

**Verifications:**
- [x] Both clocks show 01:00

---

## Black clock is ticking

![Black clock is ticking](./screenshots/001-02-black-ticking.png)

**Verifications:**
- [x] Black clock shows 55.0

---

## White clock ticking and goes below 30s

![White clock ticking and goes below 30s](./screenshots/002-03-white-ticking-warning.png)

**Verifications:**
- [x] White clock shows 25.0

---

## White runs out of time

![White runs out of time](./screenshots/003-04-white-timeout.png)

**Verifications:**
- [x] White clock shows 00:00.0 and game is over

---

# Test: Game with increment

## Clock loaded in idle state with 10s base

![Clock loaded in idle state with 10s base](./screenshots/000-01-initial-state-inc.png)

**Verifications:**
- [x] Both clocks show 10.0

---

## Black clock got increment added

![Black clock got increment added](./screenshots/001-02-black-increment-added.png)

**Verifications:**
- [x] Black clock shows 11.0 (10 - 4 + 5)

---

