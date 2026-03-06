# Chess Logger & Clock

An automatic chess game logger and clock that uses an IP camera to detect moves and advance the clock.

![Baseline Screenshot](tests/e2e/screenshots/baseline.png)

## Vision

This application will be an automatic chess game logger and clock.
By utilizing an IP camera mounted above or near the chess board, the app will capture the board state in real time.
It will automatically record piece movements and advance the chess clock for each player, ensuring a completely hands-free timing and logging experience.

The app is built entirely as a client-side application hosted on GitHub Pages, ensuring high availability, zero server maintenance costs, and respect for user privacy since all camera processing and data storage will happen locally on the user's device.

## Features
- Connects to an IP camera to capture live board state.
- Automatically records chess moves.
- Advances the clock hands-free for each player upon moving.
- 100% client-side application.
- Hosted on GitHub Pages.
