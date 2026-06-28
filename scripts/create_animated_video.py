import io
import math
import os
import random
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from pypdf import PdfReader


WIDTH = 1920
HEIGHT = 1080
FPS = 30
FADE_SECONDS = 0.8


def extract_photos(pdf_path: Path, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    photos = []
    seen = set()
    reader = PdfReader(str(pdf_path))

    for page_number, page in enumerate(reader.pages, start=1):
        for image_number, pdf_image in enumerate(page.images, start=1):
            try:
                image = Image.open(io.BytesIO(pdf_image.data))
                image.load()
                image = ImageOps.exif_transpose(image).convert("RGB")
            except Exception:
                continue

            width, height = image.size
            if min(width, height) < 360 or width * height < 350_000:
                continue

            thumb = image.copy()
            thumb.thumbnail((32, 32))
            fingerprint = thumb.tobytes()
            if fingerprint in seen:
                continue
            seen.add(fingerprint)

            target = output_dir / f"page_{page_number:02d}_photo_{image_number:02d}.jpg"
            image.save(target, "JPEG", quality=94, optimize=True)
            photos.append(target)

    return photos


def make_slide(source: Path, target: Path, index: int) -> None:
    image = Image.open(source).convert("RGB")
    image = ImageEnhance.Contrast(image).enhance(1.03)
    image = ImageEnhance.Color(image).enhance(1.04)

    background = ImageOps.fit(image, (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS)
    background = background.filter(ImageFilter.GaussianBlur(radius=28))
    background = ImageEnhance.Brightness(background).enhance(0.52)

    foreground = ImageOps.contain(image, (WIDTH - 100, HEIGHT - 70), Image.Resampling.LANCZOS)
    canvas = background.copy()
    x = (WIDTH - foreground.width) // 2
    y = (HEIGHT - foreground.height) // 2
    canvas.paste(foreground, (x, y))
    canvas.save(target, "JPEG", quality=94, subsampling=0)


def probe_duration(ffmpeg: Path, audio_path: Path) -> float:
    command = [str(ffmpeg), "-hide_banner", "-i", str(audio_path), "-f", "null", "-"]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    marker = "time="
    positions = [line for line in result.stderr.splitlines() if marker in line]
    if not positions:
        raise RuntimeError("No se pudo determinar la duracion del audio")
    value = positions[-1].split(marker, 1)[1].split()[0]
    hours, minutes, seconds = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def build_video(ffmpeg: Path, slides_dir: Path, audio_path: Path, output_path: Path, count: int) -> None:
    duration = probe_duration(ffmpeg, audio_path)
    seconds_per_photo = max(3.2, duration / count)
    frames_per_photo = max(1, round(seconds_per_photo * FPS))
    fade_frames = round(FADE_SECONDS * FPS)

    inputs = []
    filters = []
    for index in range(count):
        slide = slides_dir / f"slide_{index + 1:03d}.jpg"
        inputs.extend(["-loop", "1", "-t", f"{seconds_per_photo + FADE_SECONDS:.3f}", "-i", str(slide)])
        zoom_direction = 1 if index % 2 == 0 else -1
        if zoom_direction == 1:
            zoom = "min(zoom+0.00045,1.075)"
        else:
            zoom = "if(eq(on,1),1.075,max(1.0,zoom-0.00045))"
        x_expr = "iw/2-(iw/zoom/2)+(iw-iw/zoom)*0.10*sin(on/45)"
        y_expr = "ih/2-(ih/zoom/2)+(ih-ih/zoom)*0.08*cos(on/55)"
        filters.append(
            f"[{index}:v]scale=2200:1238,zoompan=z='{zoom}':x='{x_expr}':y='{y_expr}':"
            f"d={frames_per_photo}:s={WIDTH}x{HEIGHT}:fps={FPS},format=yuv420p[v{index}]"
        )

    current = "v0"
    offset = seconds_per_photo - FADE_SECONDS
    transitions = ["fade", "smoothleft", "smoothup", "circleopen", "dissolve"]
    for index in range(1, count):
        output = f"x{index}"
        transition = transitions[(index - 1) % len(transitions)]
        filters.append(
            f"[{current}][v{index}]xfade=transition={transition}:duration={FADE_SECONDS}:"
            f"offset={offset:.3f}[{output}]"
        )
        current = output
        offset += seconds_per_photo - FADE_SECONDS

    audio_index = count
    filters.append(f"[{audio_index}:a]afade=t=in:st=0:d=1.5,afade=t=out:st={max(0, duration - 3):.3f}:d=3[a]")
    command = [str(ffmpeg), "-y", *inputs, "-i", str(audio_path), "-filter_complex", ";".join(filters)]
    command.extend([
        "-map", f"[{current}]", "-map", "[a]", "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(output_path),
    ])
    subprocess.run(command, check=True)


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit("Uso: create_animated_video.py PDF AUDIO FFMPEG OUTPUT")

    pdf_path = Path(sys.argv[1])
    audio_path = Path(sys.argv[2])
    ffmpeg = Path(sys.argv[3])
    output_path = Path(sys.argv[4])
    work_dir = output_path.parent / "video_assets"
    photos_dir = work_dir / "photos"
    slides_dir = work_dir / "slides"
    slides_dir.mkdir(parents=True, exist_ok=True)

    photos = extract_photos(pdf_path, photos_dir)
    if not photos:
        raise RuntimeError("No se encontraron fotografias utilizables en el PDF")

    random.Random(20260618).shuffle(photos)
    for index, photo in enumerate(photos, start=1):
        make_slide(photo, slides_dir / f"slide_{index:03d}.jpg", index)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Fotografias: {len(photos)}")
    print(f"Duracion: {probe_duration(ffmpeg, audio_path):.2f} segundos")
    build_video(ffmpeg, slides_dir, audio_path, output_path, len(photos))
    print(f"Video: {output_path}")


if __name__ == "__main__":
    main()
