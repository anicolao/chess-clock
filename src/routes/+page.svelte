<script lang="ts">
  import { base } from '$app/paths';
  import { onMount, onDestroy } from 'svelte';
  import { loadBoardCalibration } from '$lib/board-calibration';
  import LiveBoardVisualizer from '$lib/components/LiveBoardVisualizer.svelte';
  import {
    clockTapped,
    configureFromQuery,
    connectionStatusChanged,
    gameStore,
    layoutModeToggled,
    logReportPrepared,
    tickElapsed
  } from '$lib/game/store';
  import { exportCurrentGameLogReport } from '$lib/game/log-report';
  import type { GameState, Player } from '$lib/game/types';

  let game = $state<GameState>(gameStore.getState().game);
  let connectionIntervalId: ReturnType<typeof setInterval> | null = null;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let storeUnsubscribe: (() => void) | null = null;
  let reportStatus = $state<string | null>(null);

  let warningAudio: HTMLAudioElement;
  let gameoverAudio: HTMLAudioElement;

  const settingsHref = $derived(`${base}/settings?camera_url=${encodeURIComponent(game.cameraUrl)}`);

  onMount(() => {
    let previousState = gameStore.getState().game;
    game = previousState;
    syncTimer(previousState);

    storeUnsubscribe = gameStore.subscribe(() => {
      const nextState = gameStore.getState().game;
      if (nextState.warningPlayed.white && !previousState.warningPlayed.white) {
        playWarning();
      }
      if (nextState.warningPlayed.black && !previousState.warningPlayed.black) {
        playWarning();
      }
      if (nextState.winner && nextState.winner !== previousState.winner) {
        playGameOver();
      }
      game = nextState;
      syncTimer(nextState);
      previousState = nextState;
    });

    const params = new URLSearchParams(window.location.search);
    const savedCalibration = loadBoardCalibration();
    const configuredCameraUrl = params.get('camera_url')
      ?? savedCalibration?.cameraUrl
      ?? gameStore.getState().game.cameraUrl;
    const hasConfiguredCamera = params.has('camera_url')
      || Boolean(savedCalibration?.cameraMode === 'remote' && savedCalibration.cameraUrl);

    const nextConfig: {
      baseTimeMs?: number;
      incrementMs?: number;
      cameraUrl?: string;
    } = {
      cameraUrl: configuredCameraUrl
    };

    if (params.has('time')) {
      const t = parseInt(params.get('time')!, 10);
      nextConfig.baseTimeMs = t;
    }
    if (params.has('inc')) {
      nextConfig.incrementMs = parseInt(params.get('inc')!, 10);
    }
    gameStore.dispatch(configureFromQuery(nextConfig));
    
    const checkConnection = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const cameraUrl = gameStore.getState().game.cameraUrl;
        const res = await fetch(`${cameraUrl}/api/status`, { signal: controller.signal }).catch(() => null);
        clearTimeout(timeoutId);
        if (res && res.ok) {
          gameStore.dispatch(connectionStatusChanged('synced'));
        } else {
          gameStore.dispatch(connectionStatusChanged('offline'));
        }
      } catch (err) {
        gameStore.dispatch(connectionStatusChanged('offline'));
      }
    };

    if (hasConfiguredCamera) {
      checkConnection();
      connectionIntervalId = setInterval(checkConnection, 3000);
    } else {
      gameStore.dispatch(connectionStatusChanged('offline'));
    }
  });

  function playWarning() {
    warningAudio?.play().catch(() => {});
  }

  function playGameOver() {
    gameoverAudio?.play().catch(() => {});
  }

  function formatTime(ms: number) {
    if (ms <= 0) return "00:00.0";
    
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const d = Math.floor((ms % 1000) / 100);

    if (ms >= 60000) {
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    } else {
      return `${s.toString().padStart(2, '0')}.${d}`;
    }
  }

  function syncTimer(nextState: GameState) {
    if (nextState.gameState === 'running') {
      if (!timerId) {
        timerId = setInterval(() => {
          gameStore.dispatch(tickElapsed({ nowMs: Date.now() }));
        }, 50);
      }
      return;
    }

    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function tapClock(player: Player) {
    gameStore.dispatch(clockTapped({ player, nowMs: Date.now() }));
  }

  async function createLogReport() {
    reportStatus = 'Preparing log report';
    const issueWindow = window.open('about:blank', '_blank');
    if (issueWindow) {
      issueWindow.document.title = 'Preparing issue draft';
      issueWindow.document.body.innerHTML = '<p style="font-family: sans-serif; padding: 1rem;">Preparing GitHub issue draft…</p>';
    }
    try {
      await exportCurrentGameLogReport(gameStore.getState().game, issueWindow);
      gameStore.dispatch(logReportPrepared({ preparedAtMs: Date.now() }));
      reportStatus = 'Log report downloaded and issue draft opened';
    } catch (error) {
      issueWindow?.close();
      reportStatus = error instanceof Error ? error.message : 'Failed to prepare log report';
    }
  }

  onDestroy(() => {
    if (timerId) clearInterval(timerId);
    if (connectionIntervalId) clearInterval(connectionIntervalId);
    storeUnsubscribe?.();
  });
</script>

<svelte:head>
  <title>Chess Clock</title>
</svelte:head>

<audio bind:this={warningAudio} src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=" preload="auto"></audio>
<audio bind:this={gameoverAudio} src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=" preload="auto"></audio>

<div class="app-container {game.layoutMode}">
  <button 
    class="clock-half black {game.activePlayer === 'black' ? 'active' : ''} {game.gameState === 'gameover' && game.winner !== 'black' ? 'lost' : ''}"
    onclick={() => tapClock('black')}
    data-testid="clock-black"
    aria-live="polite"
  >
    <div class="time">{formatTime(game.timeBlack)}</div>
    {#if game.activePlayer === 'black'}<div class="indicator">Active</div>{/if}
  </button>

  <div class="control-bar">
    <a href={settingsHref} class="btn icon-btn" data-testid="settings-link" aria-label="Settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
    </a>
    <button class="btn icon-btn" data-status={game.connectionStatus} aria-label="Network Status" data-testid="network-status">
      {#if game.connectionStatus === 'synced'}
        <svg stroke="#4ade80" fill="none" viewBox="0 0 24 24" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
      {:else}
        <svg stroke="#ef4444" fill="none" viewBox="0 0 24 24" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      {/if}
    </button>
    <button class="btn log-btn" type="button" onclick={createLogReport} data-testid="log-report">
      Log report
    </button>
    <div class="visualizer" data-testid="visualizer">
      <LiveBoardVisualizer cameraUrl={game.cameraUrl} setupHref={settingsHref} />
    </div>
    <button class="btn icon-btn" onclick={() => gameStore.dispatch(layoutModeToggled())} data-testid="layout-toggle" aria-label="Toggle Layout">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line></svg>
    </button>
  </div>
  {#if reportStatus}
    <div class="report-status" data-testid="report-status">{reportStatus}</div>
  {/if}

  <button 
    class="clock-half white {game.activePlayer === 'white' ? 'active' : ''} {game.gameState === 'gameover' && game.winner !== 'white' ? 'lost' : ''}"
    onclick={() => tapClock('white')}
    data-testid="clock-white"
    aria-live="polite"
  >
    <div class="time">{formatTime(game.timeWhite)}</div>
    {#if game.activePlayer === 'white'}<div class="indicator">Active</div>{/if}
  </button>
</div>

<style>
  :global(body, html) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: #111;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  .app-container {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
  }

  .app-container.edge {
    transform: rotate(-90deg);
    transform-origin: top left;
    width: 100vh;
    height: 100vw;
    position: absolute;
    top: 100vh;
    left: 0;
  }

  .clock-half {
    flex: 0 0 40%;
    border: none;
    background-color: #222;
    color: #888;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 5rem;
    font-weight: bold;
    font-family: monospace;
    cursor: pointer;
    transition: none;
    position: relative;
    padding: 0;
    margin: 0;
  }

  .clock-half.black {
    transform: rotate(180deg);
  }

  .app-container.edge .clock-half.black {
    transform: none;
  }

  .clock-half.active {
    background-color: #fff;
    color: #000;
    border: 8px solid #4ade80;
  }
  
  .clock-half.black.active {
      background-color: #1a1a1a;
      color: #fff;
      border: 8px solid #4ade80;
  }

  .clock-half.lost {
    background-color: #333;
    color: #555;
  }

  .indicator {
    font-size: 1.5rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-top: 1rem;
    color: inherit;
  }

  .control-bar {
    flex: 0 0 20%;
    background-color: #000;
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 0 1rem;
  }

  .visualizer {
    width: 96px;
    height: 96px;
    background-color: #333;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .icon-btn {
    background: none;
    border: none;
    color: #fff;
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 50%;
  }

  .icon-btn:hover, .icon-btn:focus {
    background-color: #333;
  }
  
  .icon-btn svg {
      width: 32px;
      height: 32px;
  }

  .report-status {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 0.9rem;
    z-index: 5;
    padding: 0.35rem 0.65rem;
    border-radius: 999px;
    background: rgba(17, 24, 39, 0.78);
    color: #d1d5db;
    font-size: 0.72rem;
    letter-spacing: 0.02em;
  }

  .log-btn {
    min-width: 4.8rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
</style>
