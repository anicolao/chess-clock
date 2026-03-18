# Chessboard Occupancy Test Report

Board localization is anchored to `tests/images/game/empty.jpg`, and that fixed grid is reused for the whole game sequence. After setup, occupancy selection assumes 32 pieces remain on the board and each successive frame differs by one move. Move labels below come from the filename sequence, not piece recognition.

Reference board score: 933.2. Lattice cells matched: 41. Color separation: 195.0.

| Step | Occupancy Overlay | Warped Occupancy | Move Label | Occupied | State Delta |
|------|-------------------|------------------|------------|----------|-------------|
| 00-empty | ![Overlay](images/out/occupancy/game/00-empty.jpg) | ![Warp](images/out/occupancy/game/00-empty_warp.jpg) | - | 0 | - |
| 01-initial | ![Overlay](images/out/occupancy/game/01-initial.jpg) | ![Warp](images/out/occupancy/game/01-initial_warp.jpg) | initial | 32 | setup: +32 |
| 02-e4 | ![Overlay](images/out/occupancy/game/02-e4.jpg) | ![Warp](images/out/occupancy/game/02-e4_warp.jpg) | e4 | 32 | 2 cells changed |
| 03-e6 | ![Overlay](images/out/occupancy/game/03-e6.jpg) | ![Warp](images/out/occupancy/game/03-e6_warp.jpg) | e6 | 32 | 2 cells changed |
| 04-e5 | ![Overlay](images/out/occupancy/game/04-e5.jpg) | ![Warp](images/out/occupancy/game/04-e5_warp.jpg) | e5 | 32 | 2 cells changed |
| 05-d4 | ![Overlay](images/out/occupancy/game/05-d4.jpg) | ![Warp](images/out/occupancy/game/05-d4_warp.jpg) | d4 | 32 | 2 cells changed |
| 06-c5 | ![Overlay](images/out/occupancy/game/06-c5.jpg) | ![Warp](images/out/occupancy/game/06-c5_warp.jpg) | c5 | 32 | 2 cells changed |
| 07-nc3 | ![Overlay](images/out/occupancy/game/07-nc3.jpg) | ![Warp](images/out/occupancy/game/07-nc3_warp.jpg) | Nc3 | 32 | 2 cells changed |
