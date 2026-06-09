
            if ('${qr}') new QRCode(document.getElementById("qrcode"), { text: '${qr}', width: 256, height: 256 });
            ${!sock?.user ? 'setTimeout(() => location.reload(), 10000); // Reload to check status' : ''}
          