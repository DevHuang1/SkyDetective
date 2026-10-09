#!/usr/bin/env python3
"""Render an aligned browser preview from a SPHEREx or WISE FITS image.

The source FITS files remain untouched. This script reads each IMAGE HDU, applies
its TAN-SIP WCS, reprojects the same 0.70 x 0.525 degree sky patch, and writes
small PNGs for the browser UI. Requires NumPy and Pillow.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SAMPLES = (
    ("level2_2025W18_2B_0237_4D1_spx_l2b-v20-2025-241.fits", "spherex-qr2-d1-2025-05-03.png"),
    ("level2_2025W19_2B_0425_1D1_spx_l2b-v20-2025-247.fits", "spherex-qr2-d1-2025-05-11.png"),
    ("level2_2025W20_2D_0584_4D1_spx_l2b-v20-2025-247.fits", "spherex-qr2-d1-2025-05-18.png"),
    ("level2_2025W21_1B_0582_2D1_spx_l2b-v20-2025-248.fits", "spherex-qr2-d1-2025-05-22.png"),
    ("level2_2025W22_1B_0052_1D1_spx_l2b-v20-2025-250.fits", "spherex-qr2-d1-2025-05-26.png"),
    ("level2_2025W44_2B_0841_4D1_spx_l2b-v20-2025-307.fits", "spherex-qr2-d1-2025-11-02.png"),
    ("level2_2025W45_1A_0137_1D1_spx_l2b-v20-2025-311.fits", "spherex-qr2-d1-2025-11-03.png"),
    ("level2_2025W45_1A_0137_2D1_spx_l2b-v20-2025-311.fits", "spherex-qr2-d1-2025-11-03-1514.png"),
    ("level2_2025W45_1A_0137_3D1_spx_l2b-v20-2025-311.fits", "spherex-qr2-d1-2025-11-03-1516.png"),
    ("level2_2025W48_2A_0059_1D1_spx_l2b-v20-2025-337.fits", "spherex-qr2-d1-2025-11-27.png"),
    ("level2_2025W49_1A_0450_1D1_spx_l2b-v20-2025-339.fits", "spherex-qr2-d1-2025-12-03.png"),
    ("level2_2026W21_1A_0480_1D1_spx_l2b-v25-2026-146.fits", "spherex-qr2-d1-2026-05-21.png"),
)
CENTER_RA_DEG = 127.69444
CENTER_DEC_DEG = -39.17760
WIDTH = 640
HEIGHT = 480
FIELD_OF_VIEW_DEG = 0.70


def parse_card_value(card: str) -> Any:
    """Read the value part of a FITS header card, without its comment."""
    value = card[10:].rstrip()
    quoted = False
    end = len(value)
    index = 0
    while index < len(value):
        if value[index] == "'":
            if quoted and index + 1 < len(value) and value[index + 1] == "'":
                index += 2
                continue
            quoted = not quoted
        elif value[index] == "/" and not quoted:
            end = index
            break
        index += 1

    value = value[:end].strip()
    if value.startswith("'"):
        return value[1 : value.rfind("'")].replace("''", "'").strip()
    if value == "T":
        return True
    if value == "F":
        return False
    try:
        return int(value)
    except ValueError:
        try:
            return float(value.replace("D", "E"))
        except ValueError:
            return value


def read_header(handle: Any) -> tuple[dict[str, Any], int]:
    cards: list[str] = []
    blocks = 0
    while True:
        block = handle.read(2880)
        if len(block) != 2880:
            raise ValueError("Unexpected end of file while reading a FITS header")
        blocks += 1
        for offset in range(0, 2880, 80):
            card = block[offset : offset + 80].decode("ascii", errors="replace")
            cards.append(card)
            if card.startswith("END "):
                header: dict[str, Any] = {}
                for item in cards:
                    if item[8:10] == "= ":
                        header[item[:8].strip()] = parse_card_value(item)
                return header, blocks * 2880


def data_size_bytes(header: dict[str, Any]) -> int:
    naxis = int(header.get("NAXIS", 0))
    if naxis == 0:
        return 0
    if str(header.get("XTENSION", "")).strip().upper() == "BINTABLE":
        size = int(header["NAXIS1"]) * int(header["NAXIS2"]) + int(header.get("PCOUNT", 0))
    else:
        bytes_per_pixel = abs(int(header.get("BITPIX", 8))) // 8
        elements = math.prod(int(header[f"NAXIS{axis}"]) for axis in range(1, naxis + 1))
        size = elements * bytes_per_pixel + int(header.get("PCOUNT", 0)) * bytes_per_pixel
    return size * int(header.get("GCOUNT", 1))


def read_science_image(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    with path.open("rb") as handle:
        while True:
            header, _header_size = read_header(handle)
            data_offset = handle.tell()
            naxis = int(header.get("NAXIS", 0))
            extension = str(header.get("EXTNAME", "")).strip().upper()
            if naxis == 2 and (extension == "IMAGE" or not extension):
                bitpix = int(header["BITPIX"])
                dtype = {8: ">u1", 16: ">i2", 32: ">i4", 64: ">i8", -32: ">f4", -64: ">f8"}[bitpix]
                shape = (int(header["NAXIS2"]), int(header["NAXIS1"]))
                raw = np.memmap(path, mode="r", dtype=dtype, offset=data_offset, shape=shape)
                image = np.asarray(raw, dtype=np.float32)
                image = image * float(header.get("BSCALE", 1.0)) + float(header.get("BZERO", 0.0))
                return image, header

            data_size = data_size_bytes(header)
            handle.seek(data_offset + ((data_size + 2879) // 2880) * 2880)
            if handle.tell() >= path.stat().st_size:
                raise ValueError("No two-dimensional IMAGE extension was found in the FITS file")


def polynomial(header: dict[str, Any], prefix: str, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    order = int(header.get(f"{prefix}_ORDER", 0))
    result = np.zeros_like(x)
    for i in range(order + 1):
        for j in range(order + 1 - i):
            coefficient = header.get(f"{prefix}_{i}_{j}")
            if coefficient is not None:
                result += float(coefficient) * np.power(x, i) * np.power(y, j)
    return result


def output_grid() -> tuple[np.ndarray, np.ndarray]:
    # Tangent-plane offsets, with RA increasing to the right and north upward.
    x_deg = (np.arange(WIDTH, dtype=np.float64) - (WIDTH - 1) / 2) * FIELD_OF_VIEW_DEG / WIDTH
    y_deg = ((HEIGHT - 1) / 2 - np.arange(HEIGHT, dtype=np.float64)) * FIELD_OF_VIEW_DEG / WIDTH
    return np.meshgrid(np.deg2rad(x_deg), np.deg2rad(y_deg))


def sample_reprojected(image: np.ndarray, header: dict[str, Any], xi: np.ndarray, eta: np.ndarray) -> np.ndarray:
    center_ra = math.radians(CENTER_RA_DEG)
    center_dec = math.radians(CENTER_DEC_DEG)

    # Inverse gnomonic projection from the shared display center to sky coordinates.
    denominator = np.cos(center_dec) - eta * np.sin(center_dec)
    sky_ra = center_ra + np.arctan2(xi, denominator)
    sky_dec = np.arctan2(
        np.sin(center_dec) + eta * np.cos(center_dec),
        np.sqrt(denominator * denominator + xi * xi),
    )

    # Project those coordinates into the image's TAN plane.
    image_ra = math.radians(float(header["CRVAL1"]))
    image_dec = math.radians(float(header["CRVAL2"]))
    delta_ra = sky_ra - image_ra
    cos_dec = np.cos(sky_dec)
    denominator = np.sin(image_dec) * np.sin(sky_dec) + np.cos(image_dec) * cos_dec * np.cos(delta_ra)
    plane_x = np.rad2deg(cos_dec * np.sin(delta_ra) / denominator)
    plane_y = np.rad2deg((np.cos(image_dec) * np.sin(sky_dec) - np.sin(image_dec) * cos_dec * np.cos(delta_ra)) / denominator)

    if all(key in header for key in ("CD1_1", "CD1_2", "CD2_1", "CD2_2")):
        cd = np.array(
            [[float(header["CD1_1"]), float(header["CD1_2"])],
             [float(header["CD2_1"]), float(header["CD2_2"])]],
            dtype=np.float64,
        )
    else:
        cd = np.array(
            [
                [float(header["CDELT1"]) * float(header.get("PC1_1", 1.0)), float(header["CDELT1"]) * float(header.get("PC1_2", 0.0))],
                [float(header["CDELT2"]) * float(header.get("PC2_1", 0.0)), float(header["CDELT2"]) * float(header.get("PC2_2", 1.0))],
            ],
            dtype=np.float64,
        )
    inverse_cd = np.linalg.inv(cd)
    distorted_x = inverse_cd[0, 0] * plane_x + inverse_cd[0, 1] * plane_y
    distorted_y = inverse_cd[1, 0] * plane_x + inverse_cd[1, 1] * plane_y

    pixel_x = distorted_x + polynomial(header, "AP", distorted_x, distorted_y) + float(header["CRPIX1"]) - 1
    pixel_y = distorted_y + polynomial(header, "BP", distorted_x, distorted_y) + float(header["CRPIX2"]) - 1

    x0 = np.floor(pixel_x).astype(np.int32)
    y0 = np.floor(pixel_y).astype(np.int32)
    dx = pixel_x - x0
    dy = pixel_y - y0
    height, width = image.shape
    valid = (x0 >= 0) & (y0 >= 0) & (x0 + 1 < width) & (y0 + 1 < height)
    x0_safe = np.clip(x0, 0, width - 2)
    y0_safe = np.clip(y0, 0, height - 2)
    corners = (
        image[y0_safe, x0_safe],
        image[y0_safe, x0_safe + 1],
        image[y0_safe + 1, x0_safe],
        image[y0_safe + 1, x0_safe + 1],
    )
    weights = ((1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy)
    result = np.zeros_like(pixel_x, dtype=np.float32)
    weight_sum = np.zeros_like(pixel_x, dtype=np.float32)
    for corner, weight in zip(corners, weights):
        usable = valid & np.isfinite(corner)
        result += np.where(usable, corner * weight, 0).astype(np.float32)
        weight_sum += np.where(usable, weight, 0).astype(np.float32)
    result = np.divide(result, weight_sum, out=np.full_like(result, np.nan), where=weight_sum > 0)
    result[~valid] = np.nan
    return result


def false_color(sample: np.ndarray, low: float, high: float) -> np.ndarray:
    softening = 0.32
    scaled = np.arcsinh(np.maximum(sample - low, 0) / softening) / np.arcsinh((high - low) / softening)
    scaled = np.clip(np.nan_to_num(scaled, nan=0.0), 0, 1)
    stops = np.array([0.0, 0.16, 0.36, 0.58, 0.79, 1.0])
    colors = np.array(
        [
            [3, 8, 20],
            [13, 28, 75],
            [34, 83, 154],
            [39, 182, 201],
            [244, 154, 57],
            [255, 245, 211],
        ],
        dtype=np.float32,
    )
    channels = [np.interp(scaled, stops, colors[:, channel]) for channel in range(3)]
    return np.stack(channels, axis=-1).astype(np.uint8)


def main() -> None:
    global CENTER_RA_DEG, CENTER_DEC_DEG, WIDTH, HEIGHT, FIELD_OF_VIEW_DEG
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data" / "spherex-demo")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public" / "spherex-previews")
    parser.add_argument("--input-fits", type=Path)
    parser.add_argument("--output-file", type=Path)
    parser.add_argument("--center-ra", type=float, default=CENTER_RA_DEG)
    parser.add_argument("--center-dec", type=float, default=CENTER_DEC_DEG)
    parser.add_argument("--fov-width", type=float, default=FIELD_OF_VIEW_DEG)
    parser.add_argument("--width", type=int, default=WIDTH)
    parser.add_argument("--height", type=int, default=HEIGHT)
    args = parser.parse_args()

    CENTER_RA_DEG = args.center_ra
    CENTER_DEC_DEG = args.center_dec
    WIDTH = max(64, min(1600, args.width))
    HEIGHT = max(64, min(1200, args.height))
    FIELD_OF_VIEW_DEG = max(0.01, min(3.0, args.fov_width))
    xi, eta = output_grid()
    if args.input_fits:
        if not args.output_file:
            parser.error("--output-file is required with --input-fits")
        image, header = read_science_image(args.input_fits)
        sample = sample_reprojected(image, header, xi, eta)
        finite = sample[np.isfinite(sample)]
        if finite.size == 0:
            raise ValueError("The selected region does not overlap valid image pixels")
        low, high = np.percentile(finite, [0.5, 99.5])
        pixels = false_color(sample, float(low), float(high))
        args.output_file.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(pixels, mode="RGB").save(args.output_file, format="PNG", optimize=True)
        return

    samples: list[tuple[np.ndarray, str]] = []
    for source_name, output_name in SAMPLES:
        source_path = args.data_dir / source_name
        if not source_path.is_file():
            continue
        image, header = read_science_image(source_path)
        samples.append((sample_reprojected(image, header, xi, eta), output_name))

    if not samples:
        raise FileNotFoundError(f"No configured SPHEREx FITS sources found in {args.data_dir}")

    finite_chunks = [sample[np.isfinite(sample)] for sample, _ in samples]
    finite_values = np.concatenate(finite_chunks)
    low, high = np.percentile(finite_values, [0.5, 99.5])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for sample, output_name in samples:
        pixels = false_color(sample, float(low), float(high))
        destination = args.output_dir / output_name
        Image.fromarray(pixels, mode="RGB").save(destination, format="PNG", optimize=True)
        print(f"Wrote {destination.relative_to(ROOT)} ({WIDTH}x{HEIGHT}, shared {low:.3f}–{high:.3f} MJy/sr stretch)")


if __name__ == "__main__":
    main()
