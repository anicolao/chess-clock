#include "camera_hal.h"
#include "mock_qr_image.h"
#include <string.h>
#include <stdlib.h>

/*
 * Minimal JPEG encoder for the mock camera.
 *
 * Produces a valid baseline JPEG from the raw grayscale QR image so the
 * /capture endpoint returns real image/jpeg data, matching what the
 * physical OV2640 camera outputs.
 */

/* Standard JPEG luminance quantization table (quality ~75) */
static const uint8_t std_quant_table[64] = {
     8,  6,  5,  8, 12, 20, 26, 31,
     6,  6,  7, 10, 13, 29, 30, 28,
     7,  7,  8, 12, 20, 29, 35, 28,
     7,  9, 11, 15, 26, 44, 40, 31,
     9, 11, 19, 28, 34, 55, 52, 39,
    12, 18, 28, 32, 41, 52, 57, 46,
    25, 32, 39, 44, 52, 61, 60, 51,
    36, 46, 48, 49, 56, 50, 52, 50
};

/* Zig-zag order */
static const uint8_t zigzag[64] = {
     0,  1,  8, 16,  9,  2,  3, 10,
    17, 24, 32, 25, 18, 11,  4,  5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13,  6,  7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
};

/* Standard DC luminance Huffman table */
static const uint8_t dc_bits[16] = {0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0};
static const uint8_t dc_vals[12]  = {0,1,2,3,4,5,6,7,8,9,10,11};

/* Standard AC luminance Huffman table */
static const uint8_t ac_bits[16] = {0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d};
static const uint8_t ac_vals[162] = {
    0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,
    0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,
    0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,
    0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,
    0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,
    0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,
    0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,
    0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,
    0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,
    0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,
    0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa
};

/* Bitstream writer */
typedef struct {
    uint8_t *buf;
    size_t cap;
    size_t pos;
    uint32_t bitbuf;
    int bitcnt;
} bitwriter_t;

static void bw_init(bitwriter_t *bw, uint8_t *buf, size_t cap) {
    bw->buf = buf; bw->cap = cap; bw->pos = 0;
    bw->bitbuf = 0; bw->bitcnt = 0;
}

static void bw_byte(bitwriter_t *bw, uint8_t b) {
    if (bw->pos < bw->cap) bw->buf[bw->pos++] = b;
}

static void bw_bytes(bitwriter_t *bw, const uint8_t *data, size_t len) {
    for (size_t i = 0; i < len; i++) bw_byte(bw, data[i]);
}

static void bw_be16(bitwriter_t *bw, uint16_t v) {
    bw_byte(bw, v >> 8); bw_byte(bw, v & 0xFF);
}

static void bw_bits(bitwriter_t *bw, uint32_t val, int nbits) {
    bw->bitbuf = (bw->bitbuf << nbits) | (val & ((1u << nbits) - 1));
    bw->bitcnt += nbits;
    while (bw->bitcnt >= 8) {
        uint8_t b = (bw->bitbuf >> (bw->bitcnt - 8)) & 0xFF;
        bw_byte(bw, b);
        if (b == 0xFF) bw_byte(bw, 0x00);
        bw->bitcnt -= 8;
    }
}

static void bw_flush(bitwriter_t *bw) {
    if (bw->bitcnt > 0) {
        bw_bits(bw, 0x7F, 7);
    }
}

/* Huffman code table */
typedef struct { uint16_t code; uint8_t len; } huff_entry_t;

static void build_huff(const uint8_t *bits, const uint8_t *vals, huff_entry_t *table) {
    uint16_t code = 0;
    int idx = 0;
    for (int len = 1; len <= 16; len++) {
        for (int i = 0; i < bits[len - 1]; i++) {
            table[vals[idx]].code = code;
            table[vals[idx]].len = len;
            idx++;
            code++;
        }
        code <<= 1;
    }
}

static camera_frame_t mock_frame;
static camera_format_t current_format = CAMERA_FMT_GRAYSCALE;
static uint8_t *jpeg_buf = NULL;
static size_t jpeg_len = 0;

static void encode_jpeg(const uint8_t *gray, int w, int h) {
    size_t bufcap = (size_t)(w * h * 2 + 1024);
    if (jpeg_buf) { free(jpeg_buf); jpeg_buf = NULL; }
    jpeg_buf = (uint8_t *)malloc(bufcap);
    if (!jpeg_buf) return;

    bitwriter_t bw;
    bw_init(&bw, jpeg_buf, bufcap);

    /* SOI */
    bw_be16(&bw, 0xFFD8);

    /* APP0 JFIF */
    bw_be16(&bw, 0xFFE0);
    bw_be16(&bw, 16);
    bw_bytes(&bw, (const uint8_t *)"JFIF\0", 5);
    bw_be16(&bw, 0x0101);
    bw_byte(&bw, 0);
    bw_be16(&bw, 1); bw_be16(&bw, 1);
    bw_byte(&bw, 0); bw_byte(&bw, 0);

    /* DQT */
    bw_be16(&bw, 0xFFDB);
    bw_be16(&bw, 67);
    bw_byte(&bw, 0x00);
    for (int i = 0; i < 64; i++) bw_byte(&bw, std_quant_table[zigzag[i]]);

    /* SOF0 (baseline, grayscale) */
    bw_be16(&bw, 0xFFC0);
    bw_be16(&bw, 11);
    bw_byte(&bw, 8);
    bw_be16(&bw, h);
    bw_be16(&bw, w);
    bw_byte(&bw, 1);
    bw_byte(&bw, 1);
    bw_byte(&bw, 0x11);
    bw_byte(&bw, 0);

    /* DHT — DC table */
    bw_be16(&bw, 0xFFC4);
    bw_be16(&bw, 2 + 1 + 16 + 12);
    bw_byte(&bw, 0x00);
    bw_bytes(&bw, dc_bits, 16);
    bw_bytes(&bw, dc_vals, 12);

    /* DHT — AC table */
    bw_be16(&bw, 0xFFC4);
    bw_be16(&bw, 2 + 1 + 16 + 162);
    bw_byte(&bw, 0x10);
    bw_bytes(&bw, ac_bits, 16);
    bw_bytes(&bw, ac_vals, 162);

    /* SOS */
    bw_be16(&bw, 0xFFDA);
    bw_be16(&bw, 8);
    bw_byte(&bw, 1);
    bw_byte(&bw, 1);
    bw_byte(&bw, 0x00);
    bw_byte(&bw, 0);
    bw_byte(&bw, 63);
    bw_byte(&bw, 0x00);

    /* Build Huffman tables */
    huff_entry_t dc_huff[256] = {0};
    huff_entry_t ac_huff[256] = {0};
    build_huff(dc_bits, dc_vals, dc_huff);
    build_huff(ac_bits, ac_vals, ac_huff);

    /* Encode scan data */
    int blocks_w = (w + 7) / 8;
    int blocks_h = (h + 7) / 8;
    int prev_dc = 0;

    for (int by = 0; by < blocks_h; by++) {
        for (int bx = 0; bx < blocks_w; bx++) {
            /* Compute block average as DC coefficient */
            int sum = 0;
            int count = 0;
            for (int j = 0; j < 8; j++) {
                for (int i = 0; i < 8; i++) {
                    int px = bx * 8 + i;
                    int py = by * 8 + j;
                    if (px < w && py < h) {
                        sum += gray[py * w + px] - 128;
                        count++;
                    }
                }
            }
            int dc_val = count > 0 ? sum / count : 0;
            int quant_dc = dc_val / (int)std_quant_table[0];

            /* DC difference coding */
            int diff = quant_dc - prev_dc;
            prev_dc = quant_dc;

            int absdiff = diff < 0 ? -diff : diff;
            int nbits = 0;
            int tmp = absdiff;
            while (tmp > 0) { nbits++; tmp >>= 1; }

            bw_bits(&bw, dc_huff[nbits].code, dc_huff[nbits].len);
            if (nbits > 0) {
                int val = diff >= 0 ? diff : diff + (1 << nbits) - 1;
                bw_bits(&bw, val, nbits);
            }

            /* AC: EOB */
            bw_bits(&bw, ac_huff[0x00].code, ac_huff[0x00].len);
        }
    }

    bw_flush(&bw);

    /* EOI */
    bw_be16(&bw, 0xFFD9);

    jpeg_len = bw.pos;
}

bool camera_hal_init(void) {
    /* Pre-encode JPEG version of the mock image */
    encode_jpeg(MOCK_QR_IMAGE, MOCK_QR_WIDTH, MOCK_QR_HEIGHT);

    /* Start in grayscale mode for QR provisioning */
    current_format = CAMERA_FMT_GRAYSCALE;
    mock_frame.buf = (uint8_t *)MOCK_QR_IMAGE;
    mock_frame.len = MOCK_QR_WIDTH * MOCK_QR_HEIGHT;
    mock_frame.width = MOCK_QR_WIDTH;
    mock_frame.height = MOCK_QR_HEIGHT;
    mock_frame.format = CAMERA_FMT_GRAYSCALE;
    return true;
}

camera_frame_t *camera_hal_take_picture(void) {
    if (current_format == CAMERA_FMT_JPEG && jpeg_buf) {
        mock_frame.buf = jpeg_buf;
        mock_frame.len = jpeg_len;
        mock_frame.format = CAMERA_FMT_JPEG;
    } else {
        mock_frame.buf = (uint8_t *)MOCK_QR_IMAGE;
        mock_frame.len = MOCK_QR_WIDTH * MOCK_QR_HEIGHT;
        mock_frame.format = CAMERA_FMT_GRAYSCALE;
    }
    mock_frame.width = MOCK_QR_WIDTH;
    mock_frame.height = MOCK_QR_HEIGHT;
    return &mock_frame;
}

void camera_hal_return_picture(camera_frame_t *frame) {
    /* No-op for mock */
}

bool camera_hal_set_format(camera_format_t fmt) {
    current_format = fmt;
    return true;
}
