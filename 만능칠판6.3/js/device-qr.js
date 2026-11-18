import QRCode from './vendor/qrcode/index.js';
import correction from './vendor/qrcode/QRErrorCorrectLevel.js';

export function drawDeviceQR(canvas, url) {
  const qr = new QRCode(0, correction.M);
  qr.addData(url);
  qr.make();

  const count = qr.getModuleCount();
  const quietZone = 4;
  const pixelSize = 5;
  canvas.width = canvas.height = (count + quietZone * 2) * pixelSize;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (qr.isDark(row, column)) {
        context.fillRect((column + quietZone) * pixelSize, (row + quietZone) * pixelSize, pixelSize, pixelSize);
      }
    }
  }
}
