<script lang="ts">
  import { getPerspectiveTransform, type Point } from '$lib/utils/perspective';

  let { imageUrl = '/empty_board.jpg', points = $bindable([
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 }
  ]) } = $props();

  let containerWidth = $state(400);
  let containerHeight = $state(400);

  let gridWidth = 400;
  let gridHeight = 400;

  let pixelPoints = $derived([
    { x: points[0].x * containerWidth, y: points[0].y * containerHeight },
    { x: points[1].x * containerWidth, y: points[1].y * containerHeight },
    { x: points[2].x * containerWidth, y: points[2].y * containerHeight },
    { x: points[3].x * containerWidth, y: points[3].y * containerHeight }
  ]);

  let transformMatrix = $derived(getPerspectiveTransform(gridWidth, gridHeight, pixelPoints[0], pixelPoints[1], pixelPoints[2], pixelPoints[3]));

  let draggingIndex: number | null = $state(null);

  function onPointerDown(e: PointerEvent, index: number) {
    draggingIndex = index;
    (e.target as Element)?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (draggingIndex !== null) {
      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const nx = x / containerWidth;
      const ny = y / containerHeight;
      
      points[draggingIndex] = { 
        x: Math.max(0, Math.min(nx, 1)), 
        y: Math.max(0, Math.min(ny, 1)) 
      };
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (draggingIndex !== null) {
      (e.target as Element)?.releasePointerCapture(e.pointerId);
      draggingIndex = null;
    }
  }

  let imageElement: HTMLImageElement | undefined = $state();

  $effect(() => {
      if (imageElement) {
          const observer = new ResizeObserver(entries => {
              for (let entry of entries) {
                  if (entry.contentRect.width > 0) {
                      containerWidth = entry.contentRect.width;
                      containerHeight = entry.contentRect.height;
                  }
              }
          });
          observer.observe(imageElement);
          return () => observer.disconnect();
      }
  });

</script>

<div class="calibration-container">
  <div class="workspace">
    <img 
        bind:this={imageElement} 
        src={imageUrl} 
        alt="Board Calibration" 
        draggable="false"
    />

    {#if containerWidth > 0 && containerHeight > 0}
      <div 
          class="chess-grid" 
          style="
              width: {gridWidth}px; 
              height: {gridHeight}px; 
              transform: {transformMatrix};
          "
      >
          {#each Array(64) as _, i}
              <div class="square {(Math.floor(i / 8) + (i % 8)) % 2 === 0 ? 'light' : 'dark'}"></div>
          {/each}
      </div>

      <svg role="presentation" 
          class="handles-overlay" 
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
          onpointerleave={onPointerUp}
      >
          <polygon 
              points="{pixelPoints[0].x},{pixelPoints[0].y} {pixelPoints[1].x},{pixelPoints[1].y} {pixelPoints[2].x},{pixelPoints[2].y} {pixelPoints[3].x},{pixelPoints[3].y}" 
              fill="none" 
              stroke="#4ade80" 
              stroke-width="2" 
              stroke-dasharray="4 4" 
          />
          
          {#each pixelPoints as pt, i}
              <circle role="presentation" 
                  cx={pt.x} 
                  cy={pt.y} 
                  r="12" 
                  fill={draggingIndex === i ? "#22c55e" : "white"} 
                  stroke="#4ade80" 
                  stroke-width="3" 
                  style="cursor: grab;"
                  onpointerdown={(e) => onPointerDown(e, i)}
              />
          {/each}
      </svg>
    {/if}
  </div>
</div>

<style>
  .calibration-container {
      width: 100%;
  }
  .workspace {
      position: relative; 
      display: inline-block;
      max-width: 100%;
  }
  img {
      display: block; 
      max-width: 100%; 
      max-height: 80vh;
      border-radius: 4px;
      user-select: none;
      -webkit-user-select: none;
  }
  .chess-grid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      grid-template-rows: repeat(8, 1fr);
      opacity: 0.5;
      transform-origin: 0 0;
      position: absolute;
      top: 0; left: 0;
      pointer-events: none;
  }
  .square {
      width: 100%;
      height: 100%;
  }
  .light {
      background-color: #ffffff;
  }
  .dark {
      background-color: #000000;
  }
  .handles-overlay {
      position: absolute; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
      overflow: visible; 
      touch-action: none;
  }
</style>
