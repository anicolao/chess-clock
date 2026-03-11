<script lang="ts">
  import { base } from '$app/paths';
  import { onMount, onDestroy } from 'svelte';

  let timeWhite = $state(60000); 
  let timeBlack = $state(60000);
  let increment = $state(0);
  let activePlayer: 'white' | 'black' | null = $state(null);
  let gameState: 'idle' | 'running' | 'paused' | 'gameover' = $state('idle');
  let winner: 'white' | 'black' | null = $state(null);
  let connectionStatus: 'offline' | 'synced' | 'error' = $state('offline');
  let cameraUrl = $state('http://chesscam.local');
  let connectionIntervalId: ReturnType<typeof setInterval> | null = null;

  let layoutMode: 'opposing' | 'edge' = $state('opposing');

  let lastTick = 0;
  let timerId: ReturnType<typeof setInterval> | null = null;

  let warningAudio: HTMLAudioElement;
  let gameoverAudio: HTMLAudioElement;

  let warningPlayed = $state({ white: false, black: false });

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('time')) {
      const t = parseInt(params.get('time')!, 10);
      timeWhite = t;
      timeBlack = t;
    }
    if (params.has('inc')) {
      increment = parseInt(params.get('inc')!, 10);
    }
    
    if (params.has('camera_url')) {
      cameraUrl = params.get('camera_url')!;
    }
    
    const checkConnection = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${cameraUrl}/api/status`, { signal: controller.signal }).catch(() => null);
        clearTimeout(timeoutId);
        if (res && res.ok) {
          connectionStatus = 'synced';
        } else {
          connectionStatus = 'offline';
        }
      } catch (err) {
        connectionStatus = 'offline';
      }
    };
    checkConnection();
    connectionIntervalId = setInterval(checkConnection, 3000);
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

  function tick() {
    if (gameState !== 'running' || !activePlayer) return;

    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;

    if (activePlayer === 'white') {
      timeWhite -= delta;
      if (timeWhite <= 30000 && !warningPlayed.white) {
        playWarning();
        warningPlayed.white = true;
      }
      if (timeWhite <= 0) {
        timeWhite = 0;
        endGame('black');
      }
    } else {
      timeBlack -= delta;
      if (timeBlack <= 30000 && !warningPlayed.black) {
        playWarning();
        warningPlayed.black = true;
      }
      if (timeBlack <= 0) {
        timeBlack = 0;
        endGame('white');
      }
    }
  }

  function startGame() {
    if (gameState === 'idle') {
      gameState = 'running';
      lastTick = Date.now();
      timerId = setInterval(tick, 50);
    } else if (gameState === 'paused') {
      gameState = 'running';
      lastTick = Date.now();
      timerId = setInterval(tick, 50);
    }
  }

  function endGame(winPlayer: 'white' | 'black') {
    gameState = 'gameover';
    winner = winPlayer;
    activePlayer = null;
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    playGameOver();
  }

  function tapClock(player: 'white' | 'black') {
    if (gameState === 'gameover') return;

    if (gameState === 'idle') {
        startGame();
        activePlayer = player === 'white' ? 'black' : 'white';
        return;
    }

    if (gameState === 'running') {
      if (activePlayer === player) {
        const now = Date.now();
        const delta = now - lastTick;
        if (player === 'white') {
          timeWhite -= delta;
          if (timeWhite > 0) timeWhite += increment;
        } else {
          timeBlack -= delta;
          if (timeBlack > 0) timeBlack += increment;
        }
        
        if (timeWhite <= 0) { timeWhite = 0; endGame('black'); return; }
        if (timeBlack <= 0) { timeBlack = 0; endGame('white'); return; }
        
        activePlayer = player === 'white' ? 'black' : 'white';
        lastTick = Date.now();
      }
    }
  }

  onDestroy(() => {
    if (timerId) clearInterval(timerId);
    if (connectionIntervalId) clearInterval(connectionIntervalId);
  });
</script>

<svelte:head>
  <title>Chess Clock</title>
</svelte:head>

<audio bind:this={warningAudio} src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=" preload="auto"></audio>
<audio bind:this={gameoverAudio} src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=" preload="auto"></audio>

<div class="app-container {layoutMode}">
  <button 
    class="clock-half black {activePlayer === 'black' ? 'active' : ''} {gameState === 'gameover' && winner !== 'black' ? 'lost' : ''}"
    onclick={() => tapClock('black')}
    data-testid="clock-black"
    aria-live="polite"
  >
    <div class="time">{formatTime(timeBlack)}</div>
    {#if activePlayer === 'black'}<div class="indicator">Active</div>{/if}
  </button>

  <div class="control-bar">
    <a href="{base}/settings" class="btn icon-btn" data-testid="settings-link" aria-label="Settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
    </a>
    <button class="btn icon-btn" data-status={connectionStatus} aria-label="Network Status" data-testid="network-status">
      {#if connectionStatus === 'synced'}
        <svg stroke="#4ade80" fill="none" viewBox="0 0 24 24" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
      {:else}
        <svg stroke="#ef4444" fill="none" viewBox="0 0 24 24" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      {/if}
    </button>
    <div class="visualizer" data-testid="visualizer">
      <div class="placeholder-board"></div>
    </div>
    <button class="btn icon-btn" onclick={() => layoutMode = layoutMode === 'opposing' ? 'edge' : 'opposing'} data-testid="layout-toggle" aria-label="Toggle Layout">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line></svg>
    </button>
  </div>

  <button 
    class="clock-half white {activePlayer === 'white' ? 'active' : ''} {gameState === 'gameover' && winner !== 'white' ? 'lost' : ''}"
    onclick={() => tapClock('white')}
    data-testid="clock-white"
    aria-live="polite"
  >
    <div class="time">{formatTime(timeWhite)}</div>
    {#if activePlayer === 'white'}<div class="indicator">Active</div>{/if}
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
    width: 80px;
    height: 80px;
    background-color: #333;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .placeholder-board {
    width: 64px;
    height: 64px;
    background-image: 
      linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc),
      linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
    background-color: #fff;
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
</style>
