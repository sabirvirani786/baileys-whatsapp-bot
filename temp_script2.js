</script>
    </head>
    <body>
      <div class="container">
        <h1>WhatsApp Bot Dashboard</h1>
        <div class="status ${sock?.user ? 'connected' : 'disconnected'}">Status: ${state}</div>
        
        <div id="qr-container">
          <p>Scan this QR code with WhatsApp:</p>
          <div id="qrcode"></div>
          <script>