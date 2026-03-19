import qrcode
import sys

qr = qrcode.QRCode(
    version=1,
    error_correction=qrcode.constants.ERROR_CORRECT_L,
    box_size=1,
    border=4,
)
qr.add_data('{"ssid":"MyNetwork","pass":"Secret123","token":"abc123xyz"}')
qr.make(fit=True)

img = qr.make_image(fill_color="black", back_color="white")
width, height = img.size

pixels = list(img.getdata())
lines = []
for i in range(0, len(pixels), width):
    line = pixels[i:i+width]
    lines.append('    ' + ', '.join(['0x00' if p == 0 else '0xFF' for p in line]) + ',')

with open('firmware/components/camera_hal/include/mock_qr_image.h', 'w') as f:
    f.write('#ifndef MOCK_QR_IMAGE_H\n')
    f.write('#define MOCK_QR_IMAGE_H\n\n')
    f.write('#include <stdint.h>\n\n')
    f.write(f'static const int MOCK_QR_WIDTH = {width};\n')
    f.write(f'static const int MOCK_QR_HEIGHT = {height};\n')
    f.write('static const uint8_t MOCK_QR_IMAGE[] = {\n')
    f.write('\n'.join(lines) + '\n')
    f.write('};\n\n')
    f.write('#endif // MOCK_QR_IMAGE_H\n')
