<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import QRCode from 'qrcode';
  import BoardSetupPanel from '$lib/components/BoardSetupPanel.svelte';

  let ssid = '';
  let password = '';
  let token = '';
  let qrCodeDataUrl = '';
  let cameraUrl = 'http://chesscam.local';
  let backHref = `${base}/`;

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('camera_url')) {
      cameraUrl = params.get('camera_url') || cameraUrl;
    }
    backHref = `${base}/?camera_url=${encodeURIComponent(cameraUrl)}`;
  });

  function generateToken() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  async function generateQRCode() {
    if (!ssid || !password) {
      alert("Please enter both SSID and Password.");
      return;
    }
    
    token = generateToken();
    const payload = JSON.stringify({
      ssid,
      pass: password,
      token
    });

    try {
      qrCodeDataUrl = await QRCode.toDataURL(payload, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
    } catch (err) {
      console.error("Error generating QR code", err);
    }
  }
</script>

<svelte:head>
  <title>Settings</title>
</svelte:head>
<div class="settings-page">
  <section class="hero">
    <div>
      <h1>Camera Settings</h1>
      <p>Provision the camera, then lock the chessboard crop before the clock starts reading occupancy.</p>
    </div>
    <a href={backHref} class="back-link">Back to Clock</a>
  </section>

  <section class="qr-section">
    <h2>Add Camera</h2>
    <p>Enter your local Wi-Fi credentials to generate a pairing QR code for the ESP32 camera.</p>

    <div class="form-group">
      <label for="ssid">Wi-Fi SSID</label>
      <input type="text" id="ssid" bind:value={ssid} placeholder="Network Name" />
    </div>

    <div class="form-group">
      <label for="password">Wi-Fi Password</label>
      <input type="password" id="password" bind:value={password} placeholder="Password" />
    </div>

    <button class="generate-btn" on:click={generateQRCode}>Generate Pairing QR</button>

    {#if qrCodeDataUrl}
    <div class="qr-container">
      <img src={qrCodeDataUrl} alt="Pairing QR Code" />
      <p>Point the unprovisioned ESP32 camera at this QR code.</p>
      <p class="token-text">Pairing Token: {token}</p>
    </div>
    {/if}
  </section>

  <BoardSetupPanel initialCameraUrl={cameraUrl} />
</div>

<style>
  :global(html),
  :global(body) {
    overflow-x: hidden !important;
    overflow-y: auto !important;
    height: auto !important;
    min-height: 100% !important;
  }

  :global(body) {
    position: static !important;
  }

  :global(#svelte) {
    min-height: 100vh;
    overflow: visible !important;
  }

  .settings-page {
    display: block;
    width: 100%;
    overflow: visible;
    color: white;
    padding: 2rem;
    background:
      radial-gradient(circle at top right, rgba(74, 222, 128, 0.1), transparent 28%),
      linear-gradient(180deg, #0b1120, #111827);
    min-height: 100vh;
    padding-bottom: 4rem;
    font-family: "Segoe UI", Helvetica, Arial, sans-serif;
  }

  .hero {
    display: flex;
    justify-content: space-between;
    gap: 1.5rem;
    align-items: flex-start;
    margin-bottom: 2rem;
  }

  .hero h1 {
    margin: 0 0 0.45rem;
    font-size: 2.4rem;
  }

  .hero p {
    margin: 0;
    max-width: 40rem;
    color: #cbd5e1;
  }

  .qr-section {
    padding: 1.5rem;
    border-radius: 24px;
    background: rgba(15, 23, 42, 0.76);
    border: 1px solid rgba(148, 163, 184, 0.16);
  }

  .qr-section h2 {
    margin-top: 0;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  label {
    display: block;
    margin-bottom: 0.5rem;
    color: #cbd5e1;
  }

  input {
    width: 100%;
    max-width: 300px;
    padding: 0.75rem 0.85rem;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    background: rgba(15, 23, 42, 0.84);
    color: white;
  }

  .generate-btn {
    padding: 0.75rem 1rem;
    background: linear-gradient(135deg, #4ade80, #22c55e);
    color: #052e16;
    border: none;
    border-radius: 999px;
    font-weight: bold;
    cursor: pointer;
    margin-top: 1rem;
  }

  .generate-btn:hover {
    background: #22c55e;
  }

  .qr-container {
    margin-top: 2rem;
    padding: 1rem;
    background: white;
    color: black;
    display: inline-block;
    border-radius: 8px;
    text-align: center;
  }
  .token-text {
    font-size: 0.8rem;
    color: #666;
    margin-top: 0.5rem;
  }

  .back-link {
    color: #d1fae5;
    text-decoration: none;
    font-weight: bold;
    padding: 0.75rem 1rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.16);
    white-space: nowrap;
  }

  @media (max-width: 720px) {
    .settings-page {
      padding: 1rem;
    }

    .hero {
      flex-direction: column;
    }
  }
</style>
