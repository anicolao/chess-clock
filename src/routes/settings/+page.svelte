<script lang="ts">
  import { base } from '$app/paths';
  import QRCode from 'qrcode';

  let ssid = '';
  let password = '';
  let token = '';
  let qrCodeDataUrl = '';

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
  <h1>Add Camera</h1>
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

  <br />
  <a href="{base}/" class="back-link">Back to Clock</a>
</div>

<style>
  .settings-page {
    color: white;
    padding: 2rem;
    background: #111;
    min-height: 100vh;
    font-family: sans-serif;
  }
  .form-group {
    margin-bottom: 1rem;
  }
  label {
    display: block;
    margin-bottom: 0.5rem;
  }
  input {
    width: 100%;
    max-width: 300px;
    padding: 0.5rem;
    border-radius: 4px;
    border: 1px solid #444;
    background: #222;
    color: white;
  }
  .generate-btn {
    padding: 0.5rem 1rem;
    background: #4ade80;
    color: black;
    border: none;
    border-radius: 4px;
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
    color: #4ade80;
    text-decoration: none;
    font-weight: bold;
    display: inline-block;
    margin-top: 2rem;
  }
</style>
